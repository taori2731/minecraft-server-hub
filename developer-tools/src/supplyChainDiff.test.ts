import { beforeEach, describe, expect, it } from "vitest";
import type { AdvisoryScanResult, DependencyInventory, DependencyPackageSummary } from "./types";
import { buildSupplyChainSnapshot, compareSupplyChainSnapshots, createSupplyChainDiffExport, readSupplyChainSnapshots, saveSupplyChainSnapshot, SUPPLY_CHAIN_SNAPSHOT_LIMIT } from "./supplyChainDiff";

const digest = "A".repeat(64);
const item = (name: string, version: string, overrides: Partial<DependencyPackageSummary> = {}): DependencyPackageSummary => ({
  componentId: "app-npm", ecosystem: "npm", name, version, direct: true, development: false,
  license: "MIT", licenseClass: "permissive", source: "registry", integrity: "sha512-safe", integrityPresent: true,
  reason: "", hostApplicability: "applicable", applicabilityReason: "runtime", ...overrides,
});
const inventory = (packages: DependencyPackageSummary[]): DependencyInventory => ({
  generatedFromLockfiles: true, lockfiles: [],
  totals: { lockfiles: 1, packages: packages.length, direct: packages.filter((entry) => entry.direct).length, development: packages.filter((entry) => entry.development).length, unknownLicense: packages.filter((entry) => entry.licenseClass === "unknown").length, reciprocalLicense: packages.filter((entry) => entry.licenseClass === "reciprocal").length, insecureSource: 0, missingIntegrity: packages.filter((entry) => !entry.integrityPresent).length },
  packages, reviewPackages: [], advisoryPreview: { endpoint: "https://api.osv.dev/v1/querybatch", totalPackages: packages.length, eligiblePackages: packages.length, uniquePackages: packages.length, duplicatePackages: 0, npmPackages: packages.length, cargoPackages: 0, requestDigest: digest, transmittedFields: ["ecosystem", "name", "version"], includesPaths: false, includesSources: false, includesLicenses: false }, advisoryScan: { checked: false, mode: "offline", reason: "network-consent-required" },
});

describe("supply-chain diff", () => {
  beforeEach(() => localStorage.clear());

  it("stores only normalized privacy-safe package fields", () => {
    const snapshot = buildSupplyChainSnapshot(inventory([item("safe", "1.0.0", { source: "C:\\Users\\person\\secret", integrity: "raw-secret-hash" })]), undefined, "2026-09-01T00:00:00.000Z");
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("Users");
    expect(serialized).not.toContain("raw-secret-hash");
    expect(snapshot.packages[0]).toMatchObject({ name: "safe", integrityPresent: true, advisoryIds: [] });
  });

  it("detects version, license, integrity, advisory, addition, and removal changes deterministically", () => {
    const before = buildSupplyChainSnapshot(inventory([
      item("updated", "1.0.0"), item("removed", "1.0.0"), item("risk", "1.0.0"),
    ]), undefined, "2026-09-01T00:00:00.000Z");
    const advisory: AdvisoryScanResult = { scannedAt: "2026-09-01T01:00:00.000Z", endpoint: "https://api.osv.dev/v1/querybatch", requestDigest: digest, queriedPackages: 3, affectedPackages: 1, vulnerabilityCount: 1, complete: true, findings: [{ ecosystem: "npm", name: "risk", version: "1.0.0", componentIds: ["app-npm"], advisoryId: "OSV-1", modified: "2026-09-01" }] };
    const after = buildSupplyChainSnapshot(inventory([
      item("updated", "2.0.0"), item("added", "1.0.0"), item("risk", "1.0.0", { license: "UNKNOWN", licenseClass: "unknown", integrityPresent: false }),
    ]), advisory, "2026-09-01T01:00:00.000Z");
    const diff = compareSupplyChainSnapshots(before, after);
    expect(diff.summary).toMatchObject({ added: 1, removed: 1, updated: 1, licenseChanges: 1, riskRegressions: 1 });
    expect(diff.riskRegressions[0].reasons).toEqual(["license-risk-increased", "integrity-missing", "advisories-increased"]);
    expect(diff.updated[0]).toMatchObject({ name: "updated", beforeVersion: "1.0.0", afterVersion: "2.0.0" });
  });

  it("keeps at most eight validated generations and ignores malformed storage", () => {
    let snapshots = [] as ReturnType<typeof readSupplyChainSnapshots>;
    for (let index = 0; index < 10; index += 1) {
      const nextInventory = inventory([item(`p${index}`, "1.0.0")]);
      nextInventory.advisoryPreview.requestDigest = index.toString(16).padStart(64, "0");
      snapshots = saveSupplyChainSnapshot(buildSupplyChainSnapshot(nextInventory, undefined, `2026-09-01T00:${String(index).padStart(2, "0")}:00.000Z`), snapshots);
    }
    expect(snapshots).toHaveLength(SUPPLY_CHAIN_SNAPSHOT_LIMIT);
    localStorage.setItem("msh-developer-tools:supply-chain-snapshots:v1", JSON.stringify({ schemaVersion: 1, snapshots: [{ documentType: "bad" }] }));
    expect(readSupplyChainSnapshots()).toEqual([]);
  });

  it("creates a review artifact without source paths or integrity values", () => {
    const before = buildSupplyChainSnapshot(inventory([item("safe", "1.0.0")]), undefined, "2026-09-01T00:00:00.000Z");
    const after = buildSupplyChainSnapshot(inventory([item("safe", "2.0.0")]), undefined, "2026-09-01T01:00:00.000Z");
    const artifact = createSupplyChainDiffExport(compareSupplyChainSnapshots(before, after));
    expect(artifact.filename).toMatch(/supply-chain-diff\.json$/);
    expect(artifact.content).toContain("minecraft-server-hub-supply-chain-diff");
    expect(artifact.content).not.toContain("source\"");
    expect(artifact.content).not.toContain("integrity\"");
  });
});
