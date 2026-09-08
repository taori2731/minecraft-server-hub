import { beforeEach, describe, expect, it } from "vitest";
import type { AdvisoryScanResult, DeveloperInspectionReport, LicenseEvidenceReport } from "./types";
import { createThirdPartyNoticesExport } from "./thirdPartyNotices";
import { compactEmbeddedReport, hydrateEmbeddedReport } from "./embeddedReport";
import { ADVISORY_CACHE_TTL_MS, DEFAULT_LICENSE_POLICY, applySupplyChainGates, buildLicenseReviewItems, buildLicenseReviewState, createCycloneDx, createDependencyCsv, createLicenseReviewExport, createSpdx, createSupplyChainExport, createWindowsLicenseEvidenceExport, persistLicenseReviewRecords, readAdvisoryCache, readLicensePolicy, readLicenseReviewRecords, removeLicenseReviewRecord, saveAdvisoryCache, saveLicensePolicy, uniqueDependencyPackages, upsertLicenseReviewRecord } from "./supplyChain";

function fixtureReport(): DeveloperInspectionReport {
  const packages = [
    { componentId: "app", ecosystem: "npm" as const, name: "@scope/demo", version: "1.0.0", direct: true, development: false, license: "MIT", licenseClass: "permissive" as const, source: "https://registry.example/demo.tgz", integrity: "sha256-Zml4dHVyZQ==", integrityPresent: true, reason: "", hostApplicability: "applicable" as const, applicabilityReason: "npm-no-platform-restriction" },
    { componentId: "website", ecosystem: "npm" as const, name: "@scope/demo", version: "1.0.0", direct: false, development: true, license: "MIT", licenseClass: "permissive" as const, source: "https://registry.example/demo.tgz", integrity: "sha256-Zml4dHVyZQ==", integrityPresent: true, reason: "", hostApplicability: "applicable" as const, applicabilityReason: "npm-no-platform-restriction" },
    { componentId: "rust", ecosystem: "cargo" as const, name: "unknown-crate", version: "2.0.0", direct: true, development: false, license: "Custom License", licenseClass: "unknown" as const, source: "registry+https://github.com/rust-lang/crates.io-index", integrity: "A".repeat(64), integrityPresent: true, reason: "unknown-license", hostApplicability: "unknown" as const, applicabilityReason: "cargo-lockfile-target-unknown" },
  ];
  return {
    schemaVersion: 6, inspectedAt: "2026-08-31T12:00:00Z", workspaceRoot: "C:/workspace", readOnly: true, expectedVersion: "0.3.2",
    versionSources: [], release: { artifactVersion: "0.3.2", artifactDirectory: "", manifestPath: "", installerPath: "", signaturePath: "", installerSizeBytes: 0, installerSha256: "", manifestVersion: "", downloadUrl: "", publishedAt: "" }, releaseHistory: [],
    dependencyInventory: { generatedFromLockfiles: true, lockfiles: [], totals: { lockfiles: 4, packages: 3, direct: 2, development: 1, unknownLicense: 1, reciprocalLicense: 0, insecureSource: 0, missingIntegrity: 0 }, packages, reviewPackages: [packages[2]], advisoryPreview: { endpoint: "https://api.osv.dev/v1/querybatch", totalPackages: 3, eligiblePackages: 3, uniquePackages: 2, duplicatePackages: 1, npmPackages: 1, cargoPackages: 1, requestDigest: "B".repeat(64), transmittedFields: ["ecosystem", "name", "version"], includesPaths: false, includesSources: false, includesLicenses: false }, advisoryScan: { checked: false, mode: "offline", reason: "network-consent-required" } },
    bundleAnalysis: { status: "missing", reportPath: "dist/bundle-report.json", generatedAt: "", sourceNewestAt: "", budgets: { entryJavaScriptBytes: 0, chunkJavaScriptBytes: 0, totalJavaScriptGzipBytes: 0, totalCssBytes: 0 }, totals: { totalJavaScriptBytes: 0, totalJavaScriptGzipBytes: 0, totalCssBytes: 0, chunks: 0, assets: 0 }, chunks: [], assets: [], violations: [], error: "" },
    qualityEvidence: { status: "missing", reportPath: "artifacts/developer-tools/quality-evidence.json", generatedAt: "", startedAt: "", completedAt: "", durationMs: 0, sourceNewestAt: "", sourceDigest: "", sourceStable: false, requiredStageIds: [], summary: { totalStages: 0, passedStages: 0, failedStages: 0, totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0 }, coverage: { available: false, reportPath: "coverage/quality/coverage-summary.json", lines: { total: 0, covered: 0, skipped: 0, pct: 0 }, statements: { total: 0, covered: 0, skipped: 0, pct: 0 }, functions: { total: 0, covered: 0, skipped: 0, pct: 0 }, branches: { total: 0, covered: 0, skipped: 0, pct: 0 } }, coverageThresholds: { lines: 70, statements: 70, functions: 60, branches: 55 }, coverageViolations: [], stages: [], error: "missing" },
    capabilitySecurity: { status: "verified", capabilityPath: "developer-tools/src-tauri/capabilities/default.json", configurationPath: "developer-tools/src-tauri/tauri.conf.json", capabilityIdentifier: "main-capability", appIdentifier: "local.minecraft-server-hub.developer-tools", windows: ["main"], configuredWindows: ["main"], permissions: ["core:default", "dialog:allow-open", "dialog:allow-save"], allowedPermissions: ["core:default", "dialog:allow-open", "dialog:allow-save"], csp: "default-src 'self'", cspDirectives: [{ name: "default-src", values: ["'self'"] }], issues: [] },
    buildEnvironment: { status: "ready", hostOs: "win32", hostArch: "x64", expectedOs: "win32", expectedArch: "x64", rustTarget: "x86_64-pc-windows-msvc", rustTargetInstalled: true, installedRustTargets: ["x86_64-pc-windows-msvc"], tools: [], issues: [], error: "" },
    remoteFeed: { endpoint: "", checked: false, reachable: false, version: "", downloadUrl: "", error: "" },
    checks: [{ id: "dependencyLicenseMetadata", status: "warning", detail: "1 unknown licenses", technicalDetail: "" }, { id: "dependencyReciprocalLicenses", status: "pass", detail: "0 reciprocal licenses", technicalDetail: "" }, { id: "dependencyAdvisories", status: "warning", detail: "offline-not-run", technicalDetail: "" }], summary: { pass: 1, warning: 2, fail: 0 },
  };
}

beforeEach(() => localStorage.clear());

describe("supply-chain policy and cache", () => {
  it("stores only a validated versioned policy", () => {
    expect(readLicensePolicy()).toEqual(DEFAULT_LICENSE_POLICY);
    saveLicensePolicy({ unknown: "allow", reciprocal: "block", vulnerabilities: "warn" });
    expect(readLicensePolicy()).toEqual({ unknown: "allow", reciprocal: "block", vulnerabilities: "warn" });
    localStorage.setItem("msh-developer-tools:supply-chain-policy:v1", JSON.stringify({ unknown: "invalid", reciprocal: "allow", vulnerabilities: "allow" }));
    expect(readLicensePolicy()).toEqual({ unknown: "warn", reciprocal: "allow", vulnerabilities: "block" });
  });

  it("accepts a matching 24-hour cache and rejects expired or future entries", () => {
    const now = Date.parse("2026-08-31T12:00:00Z");
    const result: AdvisoryScanResult = { scannedAt: new Date(now).toISOString(), endpoint: "https://api.osv.dev/v1/querybatch", requestDigest: "B".repeat(64), queriedPackages: 2, affectedPackages: 0, vulnerabilityCount: 0, complete: true, findings: [] };
    saveAdvisoryCache(result);
    expect(readAdvisoryCache(result.requestDigest, now)?.queriedPackages).toBe(2);
    expect(readAdvisoryCache(result.requestDigest, now + ADVISORY_CACHE_TTL_MS + 1)).toBeUndefined();
    expect(readAdvisoryCache(result.requestDigest, now - 5 * 60 * 1000 - 1)).toBeUndefined();
    localStorage.setItem(`msh-developer-tools:advisory-cache:v1:${result.requestDigest}`, JSON.stringify({ ...result, findings: "not-an-array" }));
    expect(readAdvisoryCache(result.requestDigest, now)).toBeUndefined();
  });

  it("applies local release policy and cached findings without mutating source checks", () => {
    const report = fixtureReport();
    const result: AdvisoryScanResult = { scannedAt: report.inspectedAt, endpoint: report.dependencyInventory.advisoryPreview.endpoint, requestDigest: report.dependencyInventory.advisoryPreview.requestDigest, queriedPackages: 2, affectedPackages: 1, vulnerabilityCount: 2, complete: true, findings: [{ componentIds: ["app"], ecosystem: "npm", name: "@scope/demo", version: "1.0.0", advisoryId: "OSV-TEST", modified: report.inspectedAt }] };
    const gated = applySupplyChainGates(report.checks, report, { unknown: "block", reciprocal: "allow", vulnerabilities: "block" }, result);
    expect(gated.find((check) => check.id === "dependencyLicenseMetadata")?.status).toBe("fail");
    expect(gated.find((check) => check.id === "dependencyAdvisories")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "dependencyLicenseMetadata")?.status).toBe("warning");
  });

  it("adds a local evidence gate and blocks checksum mismatches", () => {
    const report = fixtureReport();
    const digest = report.dependencyInventory.advisoryPreview.requestDigest;
    const base: LicenseEvidenceReport = {
      schemaVersion: 3,
      scannedAt: report.inspectedAt,
      inventoryDigest: digest,
      localOnly: true,
      summary: { total: 1, complete: 1, partial: 0, missing: 0, mismatch: 0, integrityVerified: 1, evidenceFiles: 1, applicability: { applicable: 0, excluded: 0, unknown: 1, actionableGaps: 0, excludedGaps: 0, unknownGaps: 0 } },
      items: [{ ecosystem: "cargo", name: "unknown-crate", version: "2.0.0", componentIds: ["rust"], declaredLicense: "Custom License", manifestLicense: "Custom License", manifestSource: "cargo-registry/Cargo.toml", status: "complete", integrity: "verified", hostApplicability: "unknown", applicabilityReason: "cargo-lockfile-target-unknown", files: [{ name: "LICENSE", kind: "license", sizeBytes: 10, sha256: "C".repeat(64) }], reason: "local-evidence-complete" }],
    };
    expect(applySupplyChainGates(report.checks, report, DEFAULT_LICENSE_POLICY).find((check) => check.id === "dependencyLicenseEvidence")).toMatchObject({ status: "warning", detail: "license-evidence:not-run" });
    expect(applySupplyChainGates(report.checks, report, DEFAULT_LICENSE_POLICY, undefined, undefined, base).find((check) => check.id === "dependencyLicenseEvidence")).toMatchObject({ status: "pass", detail: "license-evidence:complete:1:1:1:1:0" });
    const mismatched: LicenseEvidenceReport = { ...base, summary: { ...base.summary, complete: 0, mismatch: 1 }, items: [{ ...base.items[0], status: "mismatch", integrity: "mismatch", reason: "archive-integrity-mismatch" }] };
    expect(applySupplyChainGates(report.checks, report, DEFAULT_LICENSE_POLICY, undefined, undefined, mismatched).find((check) => check.id === "dependencyLicenseEvidence")).toMatchObject({ status: "fail", detail: "license-evidence:coverage:0:0:0:1:0:0:0" });
    const excludedMissing: LicenseEvidenceReport = { ...base, summary: { ...base.summary, complete: 0, missing: 1, integrityVerified: 0, evidenceFiles: 0, applicability: { applicable: 0, excluded: 1, unknown: 0, actionableGaps: 0, excludedGaps: 1, unknownGaps: 0 } }, items: [{ ...base.items[0], ecosystem: "npm", status: "missing", integrity: "unavailable", hostApplicability: "excluded", applicabilityReason: "npm-os-excluded", files: [], reason: "local-manifest-missing" }] };
    expect(applySupplyChainGates(report.checks, report, DEFAULT_LICENSE_POLICY, undefined, undefined, excludedMissing).find((check) => check.id === "dependencyLicenseEvidence")).toMatchObject({ status: "pass", detail: "license-evidence:complete:1:0:0:0:1" });
    const unknownMissing: LicenseEvidenceReport = { ...excludedMissing, summary: { ...excludedMissing.summary, applicability: { applicable: 0, excluded: 0, unknown: 1, actionableGaps: 0, excludedGaps: 0, unknownGaps: 1 } }, items: [{ ...excludedMissing.items[0], ecosystem: "cargo", hostApplicability: "unknown", applicabilityReason: "cargo-lockfile-target-unknown" }] };
    expect(applySupplyChainGates(report.checks, report, DEFAULT_LICENSE_POLICY, undefined, undefined, unknownMissing).find((check) => check.id === "dependencyLicenseEvidence")).toMatchObject({ status: "warning", detail: "license-evidence:coverage:0:0:1:0:0:1:0" });
  });
});

describe("supply-chain exports", () => {
  it("deduplicates components while retaining component membership", () => {
    const merged = uniqueDependencyPackages(fixtureReport().dependencyInventory.packages);
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.name === "@scope/demo")?.componentIds).toEqual(["app", "website"]);
  });

  it("creates CycloneDX 1.7, SPDX 2.3, and audit CSV documents", () => {
    const report = fixtureReport();
    const cyclone = createCycloneDx(report);
    const spdx = createSpdx(report);
    const csv = createDependencyCsv(report);
    expect(cyclone).toMatchObject({ bomFormat: "CycloneDX", specVersion: "1.7", version: 1 });
    expect(cyclone.components).toHaveLength(2);
    expect(spdx).toMatchObject({ spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0" });
    expect(spdx.packages).toHaveLength(2);
    expect(JSON.stringify(cyclone)).not.toContain("C:/workspace");
    expect(csv).toContain('"component","ecosystem","name","version"');
    expect(csv.split("\r\n")).toHaveLength(5);
    expect(createSupplyChainExport(report, "cyclonedx").filename).toMatch(/\.cdx\.json$/);
    expect(createSupplyChainExport(report, "spdx").filename).toMatch(/\.spdx\.json$/);
    expect(createSupplyChainExport(report, "csv").mime).toContain("text/csv");
  });

  it("exports a Windows x64 evidence manifest without absolute paths or file contents", () => {
    const report = fixtureReport();
    const digest = report.dependencyInventory.advisoryPreview.requestDigest;
    const evidence: LicenseEvidenceReport = {
      schemaVersion: 3,
      scannedAt: report.inspectedAt,
      inventoryDigest: digest,
      localOnly: true,
      summary: { total: 2, complete: 1, partial: 1, missing: 0, mismatch: 0, integrityVerified: 1, evidenceFiles: 1, applicability: { applicable: 1, excluded: 1, unknown: 0, actionableGaps: 0, excludedGaps: 1, unknownGaps: 0 } },
      items: [
        { ecosystem: "cargo", name: "playit-ipc", version: "1.0.10", componentIds: ["app-cargo"], declaredLicense: "", manifestLicense: "", manifestSource: "cargo-git-checkout/packages/playit-ipc/Cargo.toml", status: "complete", integrity: "verified", hostApplicability: "applicable", applicabilityReason: "cargo-metadata-windows-x64-applicable", files: [{ name: "LICENSE.txt", kind: "license", sizeBytes: 1274, sha256: "C".repeat(64) }], reason: "local-evidence-complete" },
        { ecosystem: "cargo", name: "libredox", version: "0.1.21", componentIds: ["app-cargo"], declaredLicense: "MIT", manifestLicense: "MIT", manifestSource: "cargo-registry/Cargo.toml", status: "partial", integrity: "unavailable", hostApplicability: "excluded", applicabilityReason: "cargo-metadata-windows-x64-excluded", files: [], reason: "license-file-missing" },
      ],
    };
    const artifact = createWindowsLicenseEvidenceExport(report, evidence, "2026-09-01T00:00:00.000Z");
    const document = JSON.parse(artifact.content);
    expect(artifact.filename).toMatch(/windows-x64-license-evidence\.json$/);
    expect(document).toMatchObject({ documentType: "minecraft-server-hub-windows-x64-license-evidence", schemaVersion: 2, inventoryDigest: digest, localOnly: true, target: { rustTarget: "x86_64-pc-windows-msvc" } });
    expect(document.evidence.applicable[0]).toMatchObject({ name: "playit-ipc", integrity: "verified", manifestSource: "cargo-git-checkout/packages/playit-ipc/Cargo.toml" });
    expect(document.evidence.excluded[0]).toMatchObject({ name: "libredox", hostApplicability: "excluded" });
    expect(artifact.content).not.toContain("C:/workspace");
    expect(artifact.content).not.toContain("fixture git license terms");
    expect(createSupplyChainExport(report, "windowsEvidence", evidence).filename).toMatch(/windows-x64-license-evidence\.json$/);
    expect(() => createSupplyChainExport(report, "windowsEvidence")).toThrow("license-evidence-not-current");
    expect(() => createWindowsLicenseEvidenceExport(report, { ...evidence, inventoryDigest: "D".repeat(64) })).toThrow("license-evidence-not-current");

    const supplemented: LicenseEvidenceReport = {
      ...evidence,
      summary: { ...evidence.summary, total: 1, complete: 1, partial: 0, evidenceFiles: 1, applicability: { applicable: 1, excluded: 0, unknown: 0, actionableGaps: 0, excludedGaps: 0, unknownGaps: 0 } },
      items: [{
        ecosystem: "cargo", name: "selectors", version: "0.36.1", componentIds: ["app-cargo", "developer-cargo"], declaredLicense: "MPL-2.0", manifestLicense: "MPL-2.0", manifestSource: "cargo-registry/Cargo.toml", status: "complete", integrity: "verified", hostApplicability: "applicable", applicabilityReason: "cargo-metadata-windows-x64-applicable", files: [{ name: "lib.rs", kind: "license-header", sizeBytes: 643, sha256: "E".repeat(64) }], canonicalLicense: { spdxId: "MPL-2.0", sourceUrl: "https://www.mozilla.org/media/MPL/2.0/index.f75d2927d3c1.txt", localResource: "embedded/MPL-2.0.txt", sizeBytes: 16726, sha256: "3F3D9E0024B1921B067D6F7F88DEB4A60CBE7A78E76C64E3F1D7FC3B779B9D04" }, reason: "source-header-canonical-license-complete",
      }],
    };
    const notices = createThirdPartyNoticesExport(report, supplemented);
    expect(notices.filename).toMatch(/windows-x64-third-party-notices\.md$/);
    expect(notices.content).toContain("minecraft-server-hub-third-party-notices schema=1");
    expect(notices.content).toContain("| cargo | selectors | 0.36.1 | MPL-2.0 |");
    expect(notices.content).toContain("Mozilla Public License Version 2.0");
    expect(notices.content).toContain("3F3D9E0024B1921B067D6F7F88DEB4A60CBE7A78E76C64E3F1D7FC3B779B9D04");
    expect(() => createThirdPartyNoticesExport(report, { ...supplemented, inventoryDigest: "D".repeat(64) })).toThrow("license-evidence-not-current");
    expect(() => createThirdPartyNoticesExport(report, { ...supplemented, summary: { ...supplemented.summary, applicability: { ...supplemented.summary.applicability, actionableGaps: 1 } } })).toThrow("license-evidence-incomplete");
  });
});

describe("version-bound license review register", () => {
  it("requires an attributable rationale and ignores stale metadata", () => {
    const report = fixtureReport();
    const digest = report.dependencyInventory.advisoryPreview.requestDigest;
    const item = buildLicenseReviewItems(report.dependencyInventory.packages)[0];
    expect(item).toMatchObject({ name: "unknown-crate", licenseClass: "unknown", componentIds: ["rust"] });
    const pendingState = buildLicenseReviewState(report.dependencyInventory.packages, [], digest);
    expect(applySupplyChainGates(report.checks, report, { unknown: "allow", reciprocal: "allow", vulnerabilities: "block" }, undefined, pendingState).find((check) => check.id === "dependencyLicenseMetadata")?.status).toBe("warning");
    expect(() => upsertLicenseReviewRecord([], item, digest, { decision: "approved", reviewer: "A", rationale: "short", validityDays: 180 })).toThrow("license-review-reviewer-invalid");

    const records = upsertLicenseReviewRecord([], item, digest, { decision: "approved", reviewer: "Release team", rationale: "Checked the package manifest and distribution obligations.", validityDays: 180 }, "2026-08-31T12:00:00Z");
    persistLicenseReviewRecords(digest, records);
    expect(readLicenseReviewRecords(digest)).toEqual(records);
    const state = buildLicenseReviewState(report.dependencyInventory.packages, records, digest);
    expect(state.summary).toMatchObject({ total: 1, pending: 0, approved: 1, stale: 0 });
    const gated = applySupplyChainGates(report.checks, report, { unknown: "warn", reciprocal: "warn", vulnerabilities: "block" }, undefined, state);
    expect(gated.find((check) => check.id === "dependencyLicenseMetadata")).toMatchObject({ status: "pass", detail: "license-review:unknown:1:0:1:0:0" });

    const expiredState = buildLicenseReviewState(report.dependencyInventory.packages, records, digest, Date.parse("2027-03-01T00:00:00Z"));
    expect(expiredState.summary).toMatchObject({ pending: 1, approved: 0, expired: 1 });
    expect(expiredState.expiredRecords[0]).toMatchObject({ reviewer: "Release team", expiresAt: "2027-02-27T12:00:00.000Z" });
    expect(applySupplyChainGates(report.checks, report, { unknown: "warn", reciprocal: "warn", vulnerabilities: "block" }, undefined, expiredState).find((check) => check.id === "dependencyLicenseMetadata")?.status).toBe("warning");

    const changedPackages = report.dependencyInventory.packages.map((entry) => entry.name === item.name ? { ...entry, license: "Different License" } : entry);
    expect(buildLicenseReviewState(changedPackages, records, digest).summary).toMatchObject({ pending: 1, approved: 0, stale: 1 });
    const cleared = removeLicenseReviewRecord(records, item.id, digest);
    expect(cleared).toEqual([]);
    persistLicenseReviewRecords(digest, cleared);
    expect(readLicenseReviewRecords(digest)).toEqual([]);
  });

  it("exports current and pending decisions without workspace paths", () => {
    const report = fixtureReport();
    const digest = report.dependencyInventory.advisoryPreview.requestDigest;
    const state = buildLicenseReviewState(report.dependencyInventory.packages, [], digest);
    const artifact = createLicenseReviewExport(report, state, "2026-08-31T12:30:00Z");
    const document = JSON.parse(artifact.content);
    expect(artifact.filename).toMatch(/license-review\.json$/);
    expect(document).toMatchObject({ documentType: "minecraft-server-hub-license-review-register", schemaVersion: 2, inventoryDigest: digest });
    expect(document.reviews[0]).toMatchObject({ name: "unknown-crate", status: "pending" });
    expect(artifact.content).not.toContain("C:/workspace");
  });
});

describe("embedded report payload", () => {
  it("round-trips the full package inventory with a smaller tuple payload", () => {
    const report = fixtureReport();
    const payload = compactEmbeddedReport(report);
    const restored = hydrateEmbeddedReport(payload);
    expect(payload.report.dependencyInventory.packages).toEqual([]);
    expect(restored.dependencyInventory.packages).toEqual(report.dependencyInventory.packages);
    expect(JSON.stringify(payload).length).toBeLessThan(JSON.stringify(report).length);
  });
});
