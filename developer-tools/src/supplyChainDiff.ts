import type { AdvisoryScanResult, DependencyEcosystem, DependencyInventory, LicenseClass } from "./types";
import { uniqueDependencyPackages } from "./supplyChain";

export const SUPPLY_CHAIN_SNAPSHOT_LIMIT = 8;
const STORAGE_KEY = "msh-developer-tools:supply-chain-snapshots:v1";
const HEX_64 = /^[A-F0-9]{64}$/i;
const MAX_PACKAGES = 10_000;
const MAX_TEXT = 512;

export interface SupplyChainSnapshotPackage {
  ecosystem: DependencyEcosystem;
  name: string;
  version: string;
  license: string;
  licenseClass: LicenseClass;
  direct: boolean;
  development: boolean;
  integrityPresent: boolean;
  componentIds: string[];
  advisoryIds: string[];
}

export interface SupplyChainSnapshot {
  documentType: "minecraft-server-hub-supply-chain-snapshot";
  schemaVersion: 1;
  createdAt: string;
  inventoryDigest: string;
  advisoryChecked: boolean;
  advisoryRequestDigest: string;
  packages: SupplyChainSnapshotPackage[];
  summary: {
    packages: number;
    direct: number;
    development: number;
    unknownLicense: number;
    reciprocalLicense: number;
    missingIntegrity: number;
    affectedPackages: number;
  };
}

export type SupplyChainChangeKind = "added" | "removed" | "updated" | "license" | "risk-regression" | "risk-improvement";

export interface SupplyChainDiffEntry {
  kind: SupplyChainChangeKind;
  ecosystem: DependencyEcosystem;
  name: string;
  beforeVersion: string;
  afterVersion: string;
  beforeLicenseClass: LicenseClass | "";
  afterLicenseClass: LicenseClass | "";
  reasons: string[];
}

export interface SupplyChainDiffResult {
  baseline: SupplyChainSnapshot;
  current: SupplyChainSnapshot;
  added: SupplyChainDiffEntry[];
  removed: SupplyChainDiffEntry[];
  updated: SupplyChainDiffEntry[];
  licenseChanges: SupplyChainDiffEntry[];
  riskRegressions: SupplyChainDiffEntry[];
  riskImprovements: SupplyChainDiffEntry[];
  summary: {
    added: number;
    removed: number;
    updated: number;
    licenseChanges: number;
    riskRegressions: number;
    riskImprovements: number;
    unchanged: number;
  };
}

export interface SupplyChainDiffArtifact {
  documentType: "minecraft-server-hub-supply-chain-diff";
  schemaVersion: 1;
  generatedAt: string;
  privacy: {
    localOnly: true;
    excludesAbsolutePaths: true;
    excludesSources: true;
    excludesIntegrityValues: true;
  };
  baseline: SupplyChainSnapshot;
  current: SupplyChainSnapshot;
  summary: SupplyChainDiffResult["summary"];
  changes: {
    added: SupplyChainDiffEntry[];
    removed: SupplyChainDiffEntry[];
    updated: SupplyChainDiffEntry[];
    licenseChanges: SupplyChainDiffEntry[];
    riskRegressions: SupplyChainDiffEntry[];
    riskImprovements: SupplyChainDiffEntry[];
  };
}

const packageKey = (item: Pick<SupplyChainSnapshotPackage, "ecosystem" | "name" | "version">) => `${item.ecosystem}\u0000${item.name}\u0000${item.version}`;
const lineageKey = (item: Pick<SupplyChainSnapshotPackage, "ecosystem" | "name">) => `${item.ecosystem}\u0000${item.name}`;
const packageSort = (left: SupplyChainSnapshotPackage, right: SupplyChainSnapshotPackage) => left.ecosystem.localeCompare(right.ecosystem) || left.name.localeCompare(right.name) || left.version.localeCompare(right.version);
const entrySort = (left: SupplyChainDiffEntry, right: SupplyChainDiffEntry) => left.ecosystem.localeCompare(right.ecosystem) || left.name.localeCompare(right.name) || left.beforeVersion.localeCompare(right.beforeVersion) || left.afterVersion.localeCompare(right.afterVersion);

function advisoryMap(result?: AdvisoryScanResult) {
  const map = new Map<string, Set<string>>();
  if (!result?.complete) return map;
  for (const finding of result.findings) {
    const key = `${finding.ecosystem}\u0000${finding.name}\u0000${finding.version}`;
    const ids = map.get(key) ?? new Set<string>();
    ids.add(finding.advisoryId);
    map.set(key, ids);
  }
  return map;
}

export function buildSupplyChainSnapshot(inventory: DependencyInventory, advisory?: AdvisoryScanResult, createdAt = new Date().toISOString()): SupplyChainSnapshot {
  const advisories = advisory?.requestDigest === inventory.advisoryPreview.requestDigest ? advisoryMap(advisory) : new Map<string, Set<string>>();
  const packages = uniqueDependencyPackages(inventory.packages).map<SupplyChainSnapshotPackage>((item) => ({
    ecosystem: item.ecosystem,
    name: item.name,
    version: item.version,
    license: item.license.slice(0, MAX_TEXT),
    licenseClass: item.licenseClass,
    direct: item.direct,
    development: item.development,
    integrityPresent: item.integrityPresent,
    componentIds: [...item.componentIds].sort().slice(0, 64),
    advisoryIds: [...(advisories.get(packageKey(item)) ?? [])].sort().slice(0, 64),
  })).sort(packageSort);
  return {
    documentType: "minecraft-server-hub-supply-chain-snapshot",
    schemaVersion: 1,
    createdAt,
    inventoryDigest: inventory.advisoryPreview.requestDigest.toUpperCase(),
    advisoryChecked: advisory?.requestDigest === inventory.advisoryPreview.requestDigest && advisory.complete,
    advisoryRequestDigest: advisory?.requestDigest === inventory.advisoryPreview.requestDigest ? advisory.requestDigest.toUpperCase() : "",
    packages,
    summary: {
      packages: packages.length,
      direct: packages.filter((item) => item.direct).length,
      development: packages.filter((item) => item.development).length,
      unknownLicense: packages.filter((item) => item.licenseClass === "unknown").length,
      reciprocalLicense: packages.filter((item) => item.licenseClass === "reciprocal").length,
      missingIntegrity: packages.filter((item) => !item.integrityPresent).length,
      affectedPackages: packages.filter((item) => item.advisoryIds.length > 0).length,
    },
  };
}

function validShortText(value: unknown, allowEmpty = false) {
  return typeof value === "string" && value.length <= MAX_TEXT && (allowEmpty || value.length > 0) && !value.includes("\u0000");
}

function validSnapshotPackage(value: unknown): value is SupplyChainSnapshotPackage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SupplyChainSnapshotPackage>;
  return (item.ecosystem === "npm" || item.ecosystem === "cargo")
    && validShortText(item.name) && validShortText(item.version) && validShortText(item.license, true)
    && (item.licenseClass === "permissive" || item.licenseClass === "reciprocal" || item.licenseClass === "unknown")
    && typeof item.direct === "boolean" && typeof item.development === "boolean" && typeof item.integrityPresent === "boolean"
    && Array.isArray(item.componentIds) && item.componentIds.length <= 64 && item.componentIds.every((entry) => validShortText(entry))
    && Array.isArray(item.advisoryIds) && item.advisoryIds.length <= 64 && item.advisoryIds.every((entry) => validShortText(entry));
}

function validSummary(value: unknown): value is SupplyChainSnapshot["summary"] {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<SupplyChainSnapshot["summary"]>;
  return [summary.packages, summary.direct, summary.development, summary.unknownLicense, summary.reciprocalLicense, summary.missingIntegrity, summary.affectedPackages]
    .every((entry) => Number.isInteger(entry) && (entry ?? -1) >= 0 && (entry ?? MAX_PACKAGES + 1) <= MAX_PACKAGES);
}

export function isSupplyChainSnapshot(value: unknown): value is SupplyChainSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<SupplyChainSnapshot>;
  const createdAt = Date.parse(snapshot.createdAt ?? "");
  return snapshot.documentType === "minecraft-server-hub-supply-chain-snapshot" && snapshot.schemaVersion === 1
    && Number.isFinite(createdAt) && createdAt <= Date.now() + 5 * 60 * 1000
    && typeof snapshot.inventoryDigest === "string" && HEX_64.test(snapshot.inventoryDigest)
    && typeof snapshot.advisoryChecked === "boolean"
    && typeof snapshot.advisoryRequestDigest === "string" && (snapshot.advisoryRequestDigest === "" || HEX_64.test(snapshot.advisoryRequestDigest))
    && Array.isArray(snapshot.packages) && snapshot.packages.length <= MAX_PACKAGES && snapshot.packages.every(validSnapshotPackage)
    && validSummary(snapshot.summary) && snapshot.summary.packages === snapshot.packages.length;
}

export function readSupplyChainSnapshots(): SupplyChainSnapshot[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { schemaVersion?: unknown; snapshots?: unknown } | null;
    if (value?.schemaVersion !== 1 || !Array.isArray(value.snapshots)) return [];
    return value.snapshots.filter(isSupplyChainSnapshot).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, SUPPLY_CHAIN_SNAPSHOT_LIMIT);
  } catch {
    return [];
  }
}

function writeSnapshots(snapshots: SupplyChainSnapshot[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, snapshots: snapshots.slice(0, SUPPLY_CHAIN_SNAPSHOT_LIMIT) })); } catch { /* Current UI state remains usable. */ }
}

export function saveSupplyChainSnapshot(snapshot: SupplyChainSnapshot, current = readSupplyChainSnapshots()) {
  if (!isSupplyChainSnapshot(snapshot)) throw new Error("supply-chain-snapshot-invalid");
  const next = [snapshot, ...current.filter((item) => item.createdAt !== snapshot.createdAt)].slice(0, SUPPLY_CHAIN_SNAPSHOT_LIMIT);
  writeSnapshots(next);
  return next;
}

export function removeSupplyChainSnapshot(createdAt: string, current = readSupplyChainSnapshots()) {
  const next = current.filter((item) => item.createdAt !== createdAt);
  writeSnapshots(next);
  return next;
}

function entry(kind: SupplyChainChangeKind, before: SupplyChainSnapshotPackage | undefined, after: SupplyChainSnapshotPackage | undefined, reasons: string[]): SupplyChainDiffEntry {
  const source = after ?? before;
  if (!source) throw new Error("supply-chain-diff-empty-entry");
  return { kind, ecosystem: source.ecosystem, name: source.name, beforeVersion: before?.version ?? "", afterVersion: after?.version ?? "", beforeLicenseClass: before?.licenseClass ?? "", afterLicenseClass: after?.licenseClass ?? "", reasons };
}

const riskRank: Record<LicenseClass, number> = { permissive: 0, reciprocal: 1, unknown: 2 };

function comparePair(before: SupplyChainSnapshotPackage, after: SupplyChainSnapshotPackage, result: SupplyChainDiffResult) {
  if (before.version !== after.version) result.updated.push(entry("updated", before, after, ["version-changed"]));
  if (before.licenseClass !== after.licenseClass || before.license !== after.license) {
    result.licenseChanges.push(entry("license", before, after, [before.licenseClass !== after.licenseClass ? "license-class-changed" : "license-expression-changed"]));
  }
  const regressions: string[] = [];
  const improvements: string[] = [];
  if (riskRank[after.licenseClass] > riskRank[before.licenseClass]) regressions.push("license-risk-increased");
  if (riskRank[after.licenseClass] < riskRank[before.licenseClass]) improvements.push("license-risk-decreased");
  if (before.integrityPresent && !after.integrityPresent) regressions.push("integrity-missing");
  if (!before.integrityPresent && after.integrityPresent) improvements.push("integrity-restored");
  if (after.advisoryIds.length > before.advisoryIds.length) regressions.push("advisories-increased");
  if (after.advisoryIds.length < before.advisoryIds.length) improvements.push("advisories-decreased");
  if (regressions.length > 0) result.riskRegressions.push(entry("risk-regression", before, after, regressions));
  if (improvements.length > 0) result.riskImprovements.push(entry("risk-improvement", before, after, improvements));
}

export function compareSupplyChainSnapshots(baseline: SupplyChainSnapshot, current: SupplyChainSnapshot): SupplyChainDiffResult {
  if (!isSupplyChainSnapshot(baseline) || !isSupplyChainSnapshot(current)) throw new Error("supply-chain-diff-snapshot-invalid");
  const result: SupplyChainDiffResult = { baseline, current, added: [], removed: [], updated: [], licenseChanges: [], riskRegressions: [], riskImprovements: [], summary: { added: 0, removed: 0, updated: 0, licenseChanges: 0, riskRegressions: 0, riskImprovements: 0, unchanged: 0 } };
  const beforeExact = new Map(baseline.packages.map((item) => [packageKey(item), item]));
  const afterExact = new Map(current.packages.map((item) => [packageKey(item), item]));
  const matchedBefore = new Set<string>();
  const matchedAfter = new Set<string>();
  for (const [key, before] of beforeExact) {
    const after = afterExact.get(key);
    if (!after) continue;
    matchedBefore.add(key); matchedAfter.add(key); comparePair(before, after, result);
    if (before.license === after.license && before.licenseClass === after.licenseClass && before.integrityPresent === after.integrityPresent && before.advisoryIds.join("\u0000") === after.advisoryIds.join("\u0000")) result.summary.unchanged += 1;
  }
  const unmatchedBefore = baseline.packages.filter((item) => !matchedBefore.has(packageKey(item)));
  const unmatchedAfter = current.packages.filter((item) => !matchedAfter.has(packageKey(item)));
  const lineages = new Set([...unmatchedBefore.map(lineageKey), ...unmatchedAfter.map(lineageKey)]);
  for (const lineage of lineages) {
    const before = unmatchedBefore.filter((item) => lineageKey(item) === lineage).sort(packageSort);
    const after = unmatchedAfter.filter((item) => lineageKey(item) === lineage).sort(packageSort);
    const pairs = Math.min(before.length, after.length);
    for (let index = 0; index < pairs; index += 1) comparePair(before[index], after[index], result);
    for (const item of before.slice(pairs)) result.removed.push(entry("removed", item, undefined, ["package-removed"]));
    for (const item of after.slice(pairs)) {
      result.added.push(entry("added", undefined, item, ["package-added"]));
      const risks = [item.licenseClass !== "permissive" ? "new-license-risk" : "", !item.integrityPresent ? "new-integrity-gap" : "", item.advisoryIds.length > 0 ? "new-affected-package" : ""].filter(Boolean);
      if (risks.length > 0) result.riskRegressions.push(entry("risk-regression", undefined, item, risks));
    }
  }
  for (const list of [result.added, result.removed, result.updated, result.licenseChanges, result.riskRegressions, result.riskImprovements]) list.sort(entrySort);
  result.summary = { added: result.added.length, removed: result.removed.length, updated: result.updated.length, licenseChanges: result.licenseChanges.length, riskRegressions: result.riskRegressions.length, riskImprovements: result.riskImprovements.length, unchanged: result.summary.unchanged };
  return result;
}

export function createSupplyChainDiffExport(diff: SupplyChainDiffResult) {
  const artifact: SupplyChainDiffArtifact = {
    documentType: "minecraft-server-hub-supply-chain-diff",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: { localOnly: true, excludesAbsolutePaths: true, excludesSources: true, excludesIntegrityValues: true },
    baseline: diff.baseline,
    current: diff.current,
    summary: diff.summary,
    changes: { added: diff.added, removed: diff.removed, updated: diff.updated, licenseChanges: diff.licenseChanges, riskRegressions: diff.riskRegressions, riskImprovements: diff.riskImprovements },
  };
  return { filename: `minecraft-server-hub-${diff.current.inventoryDigest.slice(0, 12).toLowerCase()}-supply-chain-diff.json`, mime: "application/json;charset=utf-8", content: `${JSON.stringify(artifact, null, 2)}\n` };
}
