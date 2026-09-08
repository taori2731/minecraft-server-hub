import type {
  AdvisoryScanResult,
  CheckStatus,
  DependencyInventory,
  DeveloperCheck,
  LicenseEvidenceReport,
  LicenseReviewState,
} from "./types";

export type SupplyChainReviewStageId = "inventory" | "evidence" | "licenseReview" | "advisories";

export interface SupplyChainReviewStage {
  id: SupplyChainReviewStageId;
  status: CheckStatus;
  target: "#dependency-center-title" | "#license-evidence-title" | "#license-review-title" | "#advisory-title";
  primary: number;
  secondary: number;
}

export interface SupplyChainReadiness {
  status: CheckStatus;
  blockers: number;
  warnings: number;
  stages: SupplyChainReviewStage[];
  inventoryDigest: string;
  advisoryCurrent: boolean;
}

const supplyChainCheckIds = new Set([
  "dependencyLockfiles",
  "dependencyIntegrity",
  "dependencyLicenseMetadata",
  "dependencyReciprocalLicenses",
  "dependencyLicenseEvidence",
  "dependencyAdvisories",
]);

const statusRank: Record<CheckStatus, number> = { pass: 0, warning: 1, fail: 2 };

function worstStatus(statuses: CheckStatus[], fallback: CheckStatus = "warning"): CheckStatus {
  return statuses.reduce<CheckStatus>((worst, status) => statusRank[status] > statusRank[worst] ? status : worst, fallback);
}

function checkStatus(checks: DeveloperCheck[], id: string, fallback: CheckStatus = "warning") {
  return checks.find((check) => check.id === id)?.status ?? fallback;
}

export function buildSupplyChainReadiness(
  inventory: DependencyInventory,
  checks: DeveloperCheck[],
  review: LicenseReviewState,
  evidence?: LicenseEvidenceReport,
  advisory?: AdvisoryScanResult,
): SupplyChainReadiness {
  const digest = inventory.advisoryPreview.requestDigest;
  const evidenceCurrent = evidence?.inventoryDigest === digest;
  const advisoryCurrent = advisory?.requestDigest === digest;
  const relevantChecks = checks.filter((check) => supplyChainCheckIds.has(check.id));
  const blockers = relevantChecks.filter((check) => check.status === "fail").length;
  const warnings = relevantChecks.filter((check) => check.status === "warning").length;
  const stages: SupplyChainReviewStage[] = [
    {
      id: "inventory",
      status: worstStatus([
        checkStatus(checks, "dependencyLockfiles", inventory.generatedFromLockfiles ? "pass" : "fail"),
        checkStatus(checks, "dependencyIntegrity", inventory.totals.insecureSource > 0 ? "fail" : inventory.totals.missingIntegrity > 0 ? "warning" : "pass"),
      ], "pass"),
      target: "#dependency-center-title",
      primary: inventory.totals.packages,
      secondary: inventory.totals.insecureSource + inventory.totals.missingIntegrity,
    },
    {
      id: "evidence",
      status: checkStatus(checks, "dependencyLicenseEvidence", evidenceCurrent ? "pass" : "warning"),
      target: "#license-evidence-title",
      primary: evidenceCurrent ? evidence.summary.complete : 0,
      secondary: evidenceCurrent ? evidence.summary.partial + evidence.summary.missing + evidence.summary.mismatch : review.items.length,
    },
    {
      id: "licenseReview",
      status: worstStatus([
        checkStatus(checks, "dependencyLicenseMetadata", inventory.totals.unknownLicense > 0 ? "warning" : "pass"),
        checkStatus(checks, "dependencyReciprocalLicenses", inventory.totals.reciprocalLicense > 0 ? "warning" : "pass"),
      ], "pass"),
      target: "#license-review-title",
      primary: review.summary.approved + review.summary.restricted,
      secondary: review.summary.pending + review.summary.blocked + review.summary.expired,
    },
    {
      id: "advisories",
      status: checkStatus(checks, "dependencyAdvisories", advisoryCurrent && advisory.complete && advisory.vulnerabilityCount === 0 ? "pass" : "warning"),
      target: "#advisory-title",
      primary: advisoryCurrent ? advisory.queriedPackages : 0,
      secondary: advisoryCurrent ? advisory.vulnerabilityCount : inventory.advisoryPreview.uniquePackages,
    },
  ];
  return {
    status: blockers > 0 ? "fail" : warnings > 0 ? "warning" : "pass",
    blockers,
    warnings,
    stages,
    inventoryDigest: digest,
    advisoryCurrent,
  };
}
