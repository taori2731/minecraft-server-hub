import type {
  AdvisoryScanResult,
  CheckStatus,
  DependencyPackageSummary,
  DeveloperCheck,
  DeveloperInspectionReport,
  LicensePolicy,
  LicensePolicyAction,
  LicenseEvidenceReport,
  LicenseReviewDecision,
  LicenseReviewDraft,
  LicenseReviewItem,
  LicenseReviewRecord,
  LicenseReviewState,
  LicenseReviewValidityDays,
} from "./types";

export const ADVISORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const POLICY_KEY = "msh-developer-tools:supply-chain-policy:v1";
const ADVISORY_CACHE_PREFIX = "msh-developer-tools:advisory-cache:v1:";
const LICENSE_REVIEW_PREFIX = "msh-developer-tools:license-reviews:v1:";
const OSV_QUERY_ENDPOINT = "https://api.osv.dev/v1/querybatch";
const REVIEW_DECISIONS = new Set<LicenseReviewDecision>(["approved", "restricted", "blocked"]);
const REVIEW_VALIDITY_DAYS = new Set<LicenseReviewValidityDays>([30, 90, 180, 365]);
const REVIEW_REGISTER_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_LICENSE_POLICY: LicensePolicy = {
  unknown: "warn",
  reciprocal: "warn",
  vulnerabilities: "block",
};

function policyAction(value: unknown, allowAllowed: boolean): LicensePolicyAction | undefined {
  return value === "warn" || value === "block" || (allowAllowed && value === "allow") ? value : undefined;
}

export function readLicensePolicy(): LicensePolicy {
  try {
    const parsed = JSON.parse(localStorage.getItem(POLICY_KEY) ?? "null") as Partial<LicensePolicy> | null;
    if (!parsed) return DEFAULT_LICENSE_POLICY;
    return {
      unknown: policyAction(parsed.unknown, true) ?? DEFAULT_LICENSE_POLICY.unknown,
      reciprocal: policyAction(parsed.reciprocal, true) ?? DEFAULT_LICENSE_POLICY.reciprocal,
      vulnerabilities: (policyAction(parsed.vulnerabilities, false) as LicensePolicy["vulnerabilities"] | undefined) ?? DEFAULT_LICENSE_POLICY.vulnerabilities,
    };
  } catch {
    return DEFAULT_LICENSE_POLICY;
  }
}

export function saveLicensePolicy(policy: LicensePolicy) {
  try { localStorage.setItem(POLICY_KEY, JSON.stringify(policy)); } catch { /* Storage can be unavailable. */ }
}

export function readAdvisoryCache(requestDigest: string, now = Date.now()): AdvisoryScanResult | undefined {
  if (!requestDigest) return undefined;
  try {
    const parsed = JSON.parse(localStorage.getItem(`${ADVISORY_CACHE_PREFIX}${requestDigest}`) ?? "null") as AdvisoryScanResult | null;
    const scannedAt = Date.parse(parsed?.scannedAt ?? "");
    const age = now - scannedAt;
    const validCounts = [parsed?.queriedPackages, parsed?.affectedPackages, parsed?.vulnerabilityCount].every((value) => Number.isInteger(value) && (value ?? -1) >= 0);
    const validFindings = Array.isArray(parsed?.findings) && parsed.findings.length <= 500 && parsed.findings.every((finding) =>
      Array.isArray(finding.componentIds) && finding.componentIds.every((value) => typeof value === "string")
      && [finding.ecosystem, finding.name, finding.version, finding.advisoryId, finding.modified].every((value) => typeof value === "string"));
    return parsed?.endpoint === OSV_QUERY_ENDPOINT && parsed.requestDigest === requestDigest && typeof parsed.complete === "boolean" && validCounts && validFindings && Number.isFinite(scannedAt) && age >= -5 * 60 * 1000 && age <= ADVISORY_CACHE_TTL_MS ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveAdvisoryCache(result: AdvisoryScanResult) {
  try {
    localStorage.setItem(`${ADVISORY_CACHE_PREFIX}${result.requestDigest}`, JSON.stringify({
      scannedAt: result.scannedAt,
      endpoint: result.endpoint,
      requestDigest: result.requestDigest,
      queriedPackages: result.queriedPackages,
      affectedPackages: result.affectedPackages,
      vulnerabilityCount: result.vulnerabilityCount,
      complete: result.complete,
      findings: result.findings.slice(0, 500),
    } satisfies AdvisoryScanResult));
  } catch { /* The live result remains available in memory. */ }
}

function reviewStorageKey(inventoryDigest: string) {
  return `${LICENSE_REVIEW_PREFIX}${inventoryDigest}`;
}

function stableReviewHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function reviewItemId(item: Pick<DependencyPackageSummary, "ecosystem" | "name" | "version" | "license" | "source" | "integrity">) {
  const metadata = [item.license, item.source, item.integrity].join("\u0000");
  return `${item.ecosystem}:${item.name}@${item.version}:${stableReviewHash(metadata)}`;
}

function reviewRecordMatches(record: LicenseReviewRecord, item: LicenseReviewItem, inventoryDigest: string) {
  return record.inventoryDigest === inventoryDigest
    && record.itemId === item.id
    && record.ecosystem === item.ecosystem
    && record.name === item.name
    && record.version === item.version
    && record.license === item.license
    && record.licenseClass === item.licenseClass
    && record.source === item.source
    && record.integrity === item.integrity
    && record.componentIds.join("\u0000") === item.componentIds.join("\u0000");
}

function validReviewRecord(value: unknown, inventoryDigest: string): value is LicenseReviewRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LicenseReviewRecord>;
  const reviewedAt = Date.parse(record.reviewedAt ?? "");
  const expiresAt = Date.parse(record.expiresAt ?? "");
  const validity = expiresAt - reviewedAt;
  return typeof record.itemId === "string" && record.itemId.length <= 500
    && record.inventoryDigest === inventoryDigest
    && (record.ecosystem === "npm" || record.ecosystem === "cargo")
    && [record.name, record.version, record.license, record.source, record.integrity].every((field) => typeof field === "string" && field.length <= 4096)
    && (record.licenseClass === "unknown" || record.licenseClass === "reciprocal")
    && Array.isArray(record.componentIds) && record.componentIds.length <= 16 && record.componentIds.every((id) => typeof id === "string" && id.length <= 100)
    && REVIEW_DECISIONS.has(record.decision as LicenseReviewDecision)
    && typeof record.reviewer === "string" && record.reviewer.trim().length >= 2 && record.reviewer.length <= 80
    && typeof record.rationale === "string" && record.rationale.trim().length >= 8 && record.rationale.length <= 2000
    && Number.isFinite(reviewedAt) && reviewedAt <= Date.now() + 5 * 60 * 1000
    && Number.isFinite(expiresAt) && validity >= 29 * DAY_MS && validity <= 366 * DAY_MS;
}

function normalizeReviewRecord(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Partial<LicenseReviewRecord>;
  if (typeof record.expiresAt === "string" && record.expiresAt) return record;
  const reviewedAt = Date.parse(record.reviewedAt ?? "");
  if (!Number.isFinite(reviewedAt)) return record;
  return { ...record, expiresAt: new Date(reviewedAt + 180 * DAY_MS).toISOString() };
}

export function buildLicenseReviewItems(packages: DependencyPackageSummary[]): LicenseReviewItem[] {
  const items = new Map<string, LicenseReviewItem>();
  for (const item of packages) {
    if (item.licenseClass === "permissive") continue;
    const id = reviewItemId(item);
    const current = items.get(id);
    if (current) {
      if (!current.componentIds.includes(item.componentId)) current.componentIds.push(item.componentId);
      current.direct ||= item.direct;
      current.development &&= item.development;
      current.integrityPresent ||= item.integrityPresent;
      for (const reason of item.reason.split(",").filter(Boolean)) {
        if (!current.reason.split(",").includes(reason)) current.reason += `${current.reason ? "," : ""}${reason}`;
      }
      continue;
    }
    items.set(id, {
      id,
      ecosystem: item.ecosystem,
      name: item.name,
      version: item.version,
      license: item.license,
      licenseClass: item.licenseClass,
      source: item.source,
      integrity: item.integrity,
      integrityPresent: item.integrityPresent,
      direct: item.direct,
      development: item.development,
      componentIds: [item.componentId],
      reason: item.reason,
    });
  }
  return [...items.values()].map((item) => ({ ...item, componentIds: [...item.componentIds].sort() }))
    .sort((left, right) => Number(right.direct) - Number(left.direct)
      || left.licenseClass.localeCompare(right.licenseClass)
      || left.ecosystem.localeCompare(right.ecosystem)
      || left.name.localeCompare(right.name)
      || left.version.localeCompare(right.version));
}

export function readLicenseReviewRecords(inventoryDigest: string): LicenseReviewRecord[] {
  if (!/^[A-F0-9]{64}$/i.test(inventoryDigest)) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(reviewStorageKey(inventoryDigest)) ?? "null") as { schemaVersion?: unknown; inventoryDigest?: unknown; records?: unknown } | null;
    if ((parsed?.schemaVersion !== 1 && parsed?.schemaVersion !== 2) || parsed.inventoryDigest !== inventoryDigest || !Array.isArray(parsed.records) || parsed.records.length > REVIEW_REGISTER_LIMIT) return [];
    return parsed.records.map(normalizeReviewRecord).filter((record) => validReviewRecord(record, inventoryDigest)).slice(0, REVIEW_REGISTER_LIMIT);
  } catch {
    return [];
  }
}

export function persistLicenseReviewRecords(inventoryDigest: string, records: LicenseReviewRecord[]) {
  try {
    localStorage.setItem(reviewStorageKey(inventoryDigest), JSON.stringify({
      schemaVersion: 2,
      inventoryDigest,
      records: records.slice(0, REVIEW_REGISTER_LIMIT),
    }));
  } catch { /* The current session keeps the review in memory. */ }
}

export function clearLegacyLicenseReviewRecords(inventoryDigest: string) {
  if (!/^[A-F0-9]{64}$/i.test(inventoryDigest)) return;
  try { localStorage.removeItem(reviewStorageKey(inventoryDigest)); } catch { /* Storage can be unavailable. */ }
}

export function buildLicenseReviewState(packages: DependencyPackageSummary[], records: LicenseReviewRecord[], inventoryDigest: string, now = Date.now()): LicenseReviewState {
  const items = buildLicenseReviewItems(packages);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const matchingRecords = records.filter((record) => {
    const item = itemMap.get(record.itemId);
    return item ? reviewRecordMatches(record, item, inventoryDigest) : false;
  });
  const activeRecords = matchingRecords.filter((record) => Date.parse(record.expiresAt) > now);
  const expiredRecords = matchingRecords.filter((record) => Date.parse(record.expiresAt) <= now);
  const activeIds = new Set(activeRecords.map((record) => record.itemId));
  const counts = { approved: 0, restricted: 0, blocked: 0 };
  for (const record of activeRecords) counts[record.decision] += 1;
  return {
    inventoryDigest,
    items,
    records: activeRecords,
    expiredRecords,
    summary: {
      total: items.length,
      pending: items.length - activeIds.size,
      approved: counts.approved,
      restricted: counts.restricted,
      blocked: counts.blocked,
      expired: expiredRecords.length,
      stale: Math.max(0, records.length - matchingRecords.length),
    },
  };
}

export function upsertLicenseReviewRecord(records: LicenseReviewRecord[], item: LicenseReviewItem, inventoryDigest: string, draft: LicenseReviewDraft, reviewedAt = new Date().toISOString()) {
  const reviewer = draft.reviewer.trim();
  const rationale = draft.rationale.trim();
  if (!REVIEW_DECISIONS.has(draft.decision)) throw new Error("license-review-decision-invalid");
  if (reviewer.length < 2 || reviewer.length > 80) throw new Error("license-review-reviewer-invalid");
  if (rationale.length < 8 || rationale.length > 2000) throw new Error("license-review-rationale-invalid");
  if (!REVIEW_VALIDITY_DAYS.has(draft.validityDays)) throw new Error("license-review-validity-invalid");
  if (!/^[A-F0-9]{64}$/i.test(inventoryDigest)) throw new Error("license-review-digest-invalid");
  const reviewedAtMs = Date.parse(reviewedAt);
  if (!Number.isFinite(reviewedAtMs)) throw new Error("license-review-date-invalid");
  const record: LicenseReviewRecord = {
    itemId: item.id,
    inventoryDigest,
    ecosystem: item.ecosystem,
    name: item.name,
    version: item.version,
    license: item.license,
    licenseClass: item.licenseClass,
    source: item.source,
    integrity: item.integrity,
    componentIds: [...item.componentIds],
    decision: draft.decision,
    reviewer,
    rationale,
    reviewedAt,
    expiresAt: new Date(reviewedAtMs + draft.validityDays * DAY_MS).toISOString(),
  };
  if (!validReviewRecord(record, inventoryDigest)) throw new Error("license-review-record-invalid");
  return [record, ...records.filter((current) => current.itemId !== item.id)].slice(0, REVIEW_REGISTER_LIMIT);
}

export function removeLicenseReviewRecord(records: LicenseReviewRecord[], itemId: string, inventoryDigest: string) {
  if (!/^[A-F0-9]{64}$/i.test(inventoryDigest)) throw new Error("license-review-digest-invalid");
  return records.filter((record) => record.itemId !== itemId);
}

function statusForPolicy(count: number, action: LicensePolicyAction): CheckStatus {
  if (count === 0 || action === "allow") return "pass";
  return action === "block" ? "fail" : "warning";
}

function reviewedLicenseGate(licenseClass: LicenseReviewItem["licenseClass"], rawCount: number, action: LicensePolicyAction, state?: LicenseReviewState) {
  if (rawCount === 0) return { status: "pass" as const, detail: `license-review:${licenseClass}:0:0:0:0:0` };
  if (!state) return { status: statusForPolicy(rawCount, action), detail: "" };
  const records = new Map(state.records.map((record) => [record.itemId, record]));
  const items = state.items.filter((item) => item.licenseClass === licenseClass);
  let approved = 0;
  let restricted = 0;
  let blocked = 0;
  for (const item of items) {
    const decision = records.get(item.id)?.decision;
    if (decision === "approved") approved += 1;
    if (decision === "restricted") restricted += 1;
    if (decision === "blocked") blocked += 1;
  }
  const pending = Math.max(0, items.length - approved - restricted - blocked);
  const status: CheckStatus = blocked > 0
    ? "fail"
    : pending > 0
      ? action === "block" ? "fail" : "warning"
      : restricted > 0 ? "warning" : "pass";
  return { status, detail: `license-review:${licenseClass}:${items.length}:${pending}:${approved}:${restricted}:${blocked}` };
}

export function applySupplyChainGates(
  checks: DeveloperCheck[],
  report: DeveloperInspectionReport,
  policy: LicensePolicy,
  advisoryResult?: AdvisoryScanResult,
  licenseReviewState?: LicenseReviewState,
  licenseEvidence?: LicenseEvidenceReport,
): DeveloperCheck[] {
  const totals = report.dependencyInventory.totals;
  const digest = report.dependencyInventory.advisoryPreview.requestDigest;
  const gated = checks.map((check) => {
    if (check.id === "dependencyLicenseMetadata") {
      const gate = reviewedLicenseGate("unknown", totals.unknownLicense, policy.unknown, licenseReviewState);
      return { ...check, ...gate };
    }
    if (check.id === "dependencyReciprocalLicenses") {
      const gate = reviewedLicenseGate("reciprocal", totals.reciprocalLicense, policy.reciprocal, licenseReviewState);
      return { ...check, ...gate };
    }
    if (check.id !== "dependencyAdvisories" || advisoryResult?.requestDigest !== digest) return check;
    const status: CheckStatus = !advisoryResult.complete
      ? "warning"
      : advisoryResult.vulnerabilityCount === 0
        ? "pass"
        : policy.vulnerabilities === "block" ? "fail" : "warning";
    const detail = !advisoryResult.complete
      ? "scan-incomplete"
      : advisoryResult.vulnerabilityCount === 0
        ? `scan-clean:${advisoryResult.queriedPackages}`
        : `scan-findings:${advisoryResult.vulnerabilityCount}:${advisoryResult.affectedPackages}`;
    return {
      ...check,
      status,
      detail,
      technicalDetail: advisoryResult.findings.slice(0, 100).map((item) => `${item.ecosystem}:${item.name}@${item.version} · ${item.advisoryId}`).join("\n"),
    };
  });
  const evidenceCheck: DeveloperCheck = licenseEvidence?.inventoryDigest === digest
    ? (() => {
      const gaps = licenseEvidence.items.filter((item) => item.status === "missing" || item.status === "partial");
      const actionableGaps = gaps.filter((item) => item.hostApplicability === "applicable").length;
      const excludedGaps = gaps.filter((item) => item.hostApplicability === "excluded").length;
      const unknownGaps = gaps.filter((item) => item.hostApplicability === "unknown").length;
      const needsReview = actionableGaps > 0 || unknownGaps > 0;
      return {
        id: "dependencyLicenseEvidence",
        status: licenseEvidence.summary.mismatch > 0 ? "fail" : needsReview ? "warning" : "pass",
        detail: licenseEvidence.summary.mismatch > 0 || needsReview
          ? `license-evidence:coverage:${licenseEvidence.summary.complete}:${licenseEvidence.summary.partial}:${licenseEvidence.summary.missing}:${licenseEvidence.summary.mismatch}:${actionableGaps}:${unknownGaps}:${excludedGaps}`
          : `license-evidence:complete:${licenseEvidence.summary.total}:${licenseEvidence.summary.complete}:${licenseEvidence.summary.evidenceFiles}:${licenseEvidence.summary.integrityVerified}:${excludedGaps}`,
        technicalDetail: licenseEvidence.items
          .filter((item) => item.status === "mismatch" || ((item.status === "missing" || item.status === "partial") && item.hostApplicability !== "excluded"))
          .slice(0, 100)
          .map((item) => `${item.ecosystem}:${item.name}@${item.version} · ${item.hostApplicability} · ${item.applicabilityReason} · ${item.reason}`)
          .join("\n"),
      } satisfies DeveloperCheck;
    })()
    : { id: "dependencyLicenseEvidence", status: "warning", detail: "license-evidence:not-run", technicalDetail: "local-only" };
  return [...gated.filter((check) => check.id !== evidenceCheck.id), evidenceCheck];
}

export function summarizeChecks(checks: DeveloperCheck[]): Record<CheckStatus, number> {
  return checks.reduce<Record<CheckStatus, number>>((summary, check) => {
    summary[check.status] += 1;
    return summary;
  }, { pass: 0, warning: 0, fail: 0 });
}

interface MergedPackage extends DependencyPackageSummary {
  componentIds: string[];
}

export function uniqueDependencyPackages(packages: DependencyPackageSummary[]): MergedPackage[] {
  const result = new Map<string, MergedPackage>();
  for (const item of packages) {
    const key = `${item.ecosystem}\u0000${item.name}\u0000${item.version}`;
    const current = result.get(key);
    if (current) {
      if (!current.componentIds.includes(item.componentId)) current.componentIds.push(item.componentId);
      current.direct ||= item.direct;
      current.development ||= item.development;
      if (!current.license && item.license) current.license = item.license;
      if (!current.integrity && item.integrity) current.integrity = item.integrity;
      current.integrityPresent ||= item.integrityPresent;
    } else {
      result.set(key, { ...item, componentIds: [item.componentId] });
    }
  }
  return [...result.values()].sort((left, right) => left.ecosystem.localeCompare(right.ecosystem) || left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

function packagePurl(item: DependencyPackageSummary) {
  const name = item.name.split("/").map(encodeURIComponent).join("/");
  return `pkg:${item.ecosystem === "cargo" ? "cargo" : "npm"}/${name}@${encodeURIComponent(item.version)}`;
}

function uuidFromDigest(digest: string) {
  const source = digest.toLowerCase().replace(/[^a-f0-9]/g, "").padEnd(32, "0").slice(0, 32).split("");
  source[12] = "5";
  source[16] = (["8", "9", "a", "b"])[Number.parseInt(source[16], 16) % 4];
  const value = source.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function integrityHash(item: DependencyPackageSummary): { alg: string; content: string } | undefined {
  if (item.ecosystem === "cargo" && /^[a-f0-9]{64}$/i.test(item.integrity)) return { alg: "SHA-256", content: item.integrity.toUpperCase() };
  const sri = item.integrity.match(/^sha(256|384|512)-(.+)$/i);
  if (!sri) return undefined;
  try {
    const bytes = Uint8Array.from(atob(sri[2]), (character) => character.charCodeAt(0));
    return { alg: `SHA-${sri[1]}`, content: [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase() };
  } catch {
    return undefined;
  }
}

function licenseValue(license: string) {
  if (!license || /^(?:SEE LICENSE|NOASSERTION|UNKNOWN|UNLICENSED)$/i.test(license)) return undefined;
  if (/\s(?:AND|OR|WITH)\s|[()]/i.test(license)) return { expression: license };
  return /^[A-Za-z0-9][A-Za-z0-9-.+]*$/.test(license) ? { license: { id: license } } : { license: { name: license } };
}

export function createCycloneDx(report: DeveloperInspectionReport) {
  const packages = uniqueDependencyPackages(report.dependencyInventory.packages);
  const rootRef = `pkg:generic/minecraft-server-hub@${encodeURIComponent(report.expectedVersion)}`;
  const components = packages.map((item) => {
    const hash = integrityHash(item);
    const license = licenseValue(item.license);
    return {
      type: "library",
      "bom-ref": packagePurl(item),
      group: item.ecosystem === "npm" && item.name.startsWith("@") ? item.name.split("/")[0] : undefined,
      name: item.name,
      version: item.version,
      purl: packagePurl(item),
      hashes: hash ? [hash] : undefined,
      licenses: license ? [license] : undefined,
      properties: [
        { name: "msh:components", value: item.componentIds.join(",") },
        { name: "msh:direct", value: String(item.direct) },
        { name: "msh:development", value: String(item.development) },
        { name: "msh:license-class", value: item.licenseClass },
      ],
    };
  });
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: `urn:uuid:${uuidFromDigest(report.dependencyInventory.advisoryPreview.requestDigest)}`,
    version: 1,
    metadata: {
      timestamp: report.inspectedAt,
      tools: { components: [{ type: "application", name: "Minecraft Server Hub Developer Tools", version: "0.3.1" }] },
      component: { type: "application", "bom-ref": rootRef, name: "Minecraft Server Hub", version: report.expectedVersion },
    },
    components,
    dependencies: [
      { ref: rootRef, dependsOn: packages.filter((item) => item.direct).map(packagePurl) },
      ...packages.map((item) => ({ ref: packagePurl(item), dependsOn: [] })),
    ],
  };
}

function spdxId(index: number) { return `SPDXRef-Package-${index + 1}`; }

export function createSpdx(report: DeveloperInspectionReport) {
  const packages = uniqueDependencyPackages(report.dependencyInventory.packages);
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `Minecraft Server Hub ${report.expectedVersion} dependencies`,
    documentNamespace: `https://minecraft-server-hub.local/spdx/${uuidFromDigest(report.dependencyInventory.advisoryPreview.requestDigest)}`,
    creationInfo: { created: report.inspectedAt, creators: ["Tool: Minecraft Server Hub Developer Tools-0.3.1"] },
    packages: packages.map((item, index) => {
      const hash = integrityHash(item);
      return {
        SPDXID: spdxId(index),
        name: item.name,
        versionInfo: item.version,
        downloadLocation: /^https:\/\//i.test(item.source) ? item.source : "NOASSERTION",
        filesAnalyzed: false,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: item.license || "NOASSERTION",
        copyrightText: "NOASSERTION",
        checksums: hash ? [{ algorithm: hash.alg.replace("-", ""), checksumValue: hash.content }] : undefined,
        externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: packagePurl(item) }],
        comment: `Components: ${item.componentIds.join(", ")}; direct=${item.direct}; development=${item.development}`,
      };
    }),
    relationships: packages.map((_item, index) => ({ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: spdxId(index) })),
  };
}

function csvCell(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export function createDependencyCsv(report: DeveloperInspectionReport) {
  const rows = [["component", "ecosystem", "name", "version", "direct", "development", "license", "licenseClass", "source", "integrityPresent"]];
  for (const item of report.dependencyInventory.packages) rows.push([item.componentId, item.ecosystem, item.name, item.version, String(item.direct), String(item.development), item.license, item.licenseClass, item.source, String(item.integrityPresent)]);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function createLicenseReviewExport(report: DeveloperInspectionReport, state: LicenseReviewState, generatedAt = new Date().toISOString()) {
  const records = new Map(state.records.map((record) => [record.itemId, record]));
  const expiredRecords = new Map(state.expiredRecords.map((record) => [record.itemId, record]));
  const document = {
    documentType: "minecraft-server-hub-license-review-register",
    schemaVersion: 2,
    generatedAt,
    applicationVersion: report.expectedVersion,
    inventoryDigest: state.inventoryDigest,
    summary: state.summary,
    reviews: state.items.map((item) => {
      const record = records.get(item.id);
      const expiredRecord = expiredRecords.get(item.id);
      const auditRecord = record ?? expiredRecord;
      return {
        itemId: item.id,
        ecosystem: item.ecosystem,
        name: item.name,
        version: item.version,
        declaredLicense: item.license || "NOASSERTION",
        licenseClass: item.licenseClass,
        components: item.componentIds,
        direct: item.direct,
        developmentOnly: item.development,
        source: item.source,
        integrity: item.integrity,
        status: record?.decision ?? (expiredRecord ? "expired" : "pending"),
        decision: auditRecord?.decision ?? "",
        reviewer: auditRecord?.reviewer ?? "",
        rationale: auditRecord?.rationale ?? "",
        reviewedAt: auditRecord?.reviewedAt ?? "",
        expiresAt: auditRecord?.expiresAt ?? "",
      };
    }),
  };
  return {
    filename: `minecraft-server-hub-${report.expectedVersion}-license-review.json`,
    mime: "application/json;charset=utf-8",
    content: `${JSON.stringify(document, null, 2)}\n`,
  };
}

function windowsEvidenceItem(item: LicenseEvidenceReport["items"][number]) {
  return {
    ecosystem: item.ecosystem,
    name: item.name,
    version: item.version,
    components: [...item.componentIds].sort((left, right) => left.localeCompare(right, "en")),
    declaredLicense: item.declaredLicense || "NOASSERTION",
    manifestLicense: item.manifestLicense || "NOASSERTION",
    manifestSource: item.manifestSource,
    status: item.status,
    integrity: item.integrity,
    hostApplicability: item.hostApplicability,
    applicabilityReason: item.applicabilityReason,
    reason: item.reason,
    canonicalLicense: item.canonicalLicense,
    files: [...item.files]
      .sort((left, right) => left.name.localeCompare(right.name, "en") || left.sha256.localeCompare(right.sha256, "en"))
      .map((file) => ({ name: file.name, kind: file.kind, sizeBytes: file.sizeBytes, sha256: file.sha256 })),
  };
}

export function createWindowsLicenseEvidenceExport(report: DeveloperInspectionReport, evidence: LicenseEvidenceReport, generatedAt = new Date().toISOString()) {
  const digest = report.dependencyInventory.advisoryPreview.requestDigest;
  if (!digest || evidence.inventoryDigest !== digest) throw new Error("license-evidence-not-current");
  const items = [...evidence.items].sort((left, right) =>
    left.ecosystem.localeCompare(right.ecosystem, "en")
    || left.name.localeCompare(right.name, "en")
    || left.version.localeCompare(right.version, "en"));
  const group = (applicability: LicenseEvidenceReport["items"][number]["hostApplicability"]) =>
    items.filter((item) => item.hostApplicability === applicability).map(windowsEvidenceItem);
  const inventory = report.dependencyInventory.packages;
  const document = {
    documentType: "minecraft-server-hub-windows-x64-license-evidence",
    schemaVersion: 2,
    generatedAt,
    applicationVersion: report.expectedVersion,
    inventoryDigest: digest,
    localOnly: true,
    target: { os: "windows", architecture: "x86_64", rustTarget: "x86_64-pc-windows-msvc" },
    inventoryScope: {
      packageEntries: inventory.length,
      applicable: inventory.filter((item) => item.hostApplicability === "applicable").length,
      excluded: inventory.filter((item) => item.hostApplicability === "excluded").length,
      unknown: inventory.filter((item) => item.hostApplicability === "unknown").length,
    },
    summary: evidence.summary,
    evidence: {
      applicable: group("applicable"),
      excluded: group("excluded"),
      unknown: group("unknown"),
    },
  };
  return {
    filename: `minecraft-server-hub-${report.expectedVersion}-windows-x64-license-evidence.json`,
    mime: "application/json;charset=utf-8",
    content: `${JSON.stringify(document, null, 2)}\n`,
  };
}

export type SupplyChainExportFormat = "cyclonedx" | "spdx" | "csv" | "windowsEvidence" | "notices";
export function createSupplyChainExport(report: DeveloperInspectionReport, format: SupplyChainExportFormat, evidence?: LicenseEvidenceReport) {
  const base = `minecraft-server-hub-${report.expectedVersion}`;
  if (format === "csv") return { filename: `${base}-dependencies.csv`, mime: "text/csv;charset=utf-8", content: createDependencyCsv(report) };
  if (format === "windowsEvidence") {
    if (!evidence) throw new Error("license-evidence-not-current");
    return createWindowsLicenseEvidenceExport(report, evidence);
  }
  if (format === "notices") {
    throw new Error("notices-require-dynamic-export");
  }
  const document = format === "cyclonedx" ? createCycloneDx(report) : createSpdx(report);
  return {
    filename: `${base}-${format === "cyclonedx" ? "bom.cdx" : "sbom.spdx"}.json`,
    mime: "application/json;charset=utf-8",
    content: `${JSON.stringify(document, null, 2)}\n`,
  };
}
