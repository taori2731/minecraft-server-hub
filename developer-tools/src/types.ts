export type CheckStatus = "pass" | "warning" | "fail";

export interface DeveloperCheck {
  id: string;
  status: CheckStatus;
  detail: string;
  technicalDetail: string;
}

export type DependencyEcosystem = "npm" | "cargo";
export type LicenseClass = "permissive" | "reciprocal" | "unknown";
export type DependencyApplicability = "applicable" | "excluded" | "unknown";

export interface DependencyPackageSummary {
  componentId: string;
  ecosystem: DependencyEcosystem;
  name: string;
  version: string;
  direct: boolean;
  development: boolean;
  license: string;
  licenseClass: LicenseClass;
  source: string;
  integrity: string;
  integrityPresent: boolean;
  reason: string;
  hostApplicability: DependencyApplicability;
  applicabilityReason: string;
}

export interface AdvisoryQueryPreview {
  endpoint: string;
  totalPackages: number;
  eligiblePackages: number;
  uniquePackages: number;
  duplicatePackages: number;
  npmPackages: number;
  cargoPackages: number;
  requestDigest: string;
  transmittedFields: Array<"ecosystem" | "name" | "version">;
  includesPaths: false;
  includesSources: false;
  includesLicenses: false;
}

export interface AdvisoryFinding {
  componentIds: string[];
  ecosystem: string;
  name: string;
  version: string;
  advisoryId: string;
  modified: string;
}

export interface AdvisoryScanResult {
  scannedAt: string;
  endpoint: string;
  requestDigest: string;
  queriedPackages: number;
  affectedPackages: number;
  vulnerabilityCount: number;
  complete: boolean;
  findings: AdvisoryFinding[];
}

export type LicensePolicyAction = "allow" | "warn" | "block";
export interface LicensePolicy {
  unknown: LicensePolicyAction;
  reciprocal: LicensePolicyAction;
  vulnerabilities: Exclude<LicensePolicyAction, "allow">;
}

export type LicenseReviewDecision = "approved" | "restricted" | "blocked";
export type LicenseReviewStatus = "pending" | "expired" | LicenseReviewDecision;
export type LicenseReviewValidityDays = 30 | 90 | 180 | 365;

export interface LicenseReviewItem {
  id: string;
  ecosystem: DependencyEcosystem;
  name: string;
  version: string;
  license: string;
  licenseClass: Exclude<LicenseClass, "permissive">;
  source: string;
  integrity: string;
  integrityPresent: boolean;
  direct: boolean;
  development: boolean;
  componentIds: string[];
  reason: string;
}

export interface LicenseReviewRecord {
  itemId: string;
  inventoryDigest: string;
  ecosystem: DependencyEcosystem;
  name: string;
  version: string;
  license: string;
  licenseClass: Exclude<LicenseClass, "permissive">;
  source: string;
  integrity: string;
  componentIds: string[];
  decision: LicenseReviewDecision;
  reviewer: string;
  rationale: string;
  reviewedAt: string;
  expiresAt: string;
}

export interface LicenseReviewDraft {
  decision: LicenseReviewDecision;
  reviewer: string;
  rationale: string;
  validityDays: LicenseReviewValidityDays;
}

export interface LicenseReviewSummary {
  total: number;
  pending: number;
  approved: number;
  restricted: number;
  blocked: number;
  expired: number;
  stale: number;
}

export interface LicenseReviewState {
  inventoryDigest: string;
  items: LicenseReviewItem[];
  records: LicenseReviewRecord[];
  expiredRecords: LicenseReviewRecord[];
  summary: LicenseReviewSummary;
}

export type LicenseLedgerAction = "decision" | "migration" | "reset";

export interface LicenseLedgerHistoryEntry {
  sequence: number;
  action: LicenseLedgerAction;
  itemId: string;
  name: string;
  version: string;
  decision: LicenseReviewDecision | "";
  reviewer: string;
  rationale: string;
  occurredAt: string;
  expiresAt: string;
  eventHash: string;
}

export interface LicenseLedgerSnapshot {
  schemaVersion: number;
  inventoryDigest: string;
  storage: "app-data";
  integrity: "verified";
  eventCount: number;
  expiringSoon: number;
  lastHash: string;
  updatedAt: string;
  records: LicenseReviewRecord[];
  history: LicenseLedgerHistoryEntry[];
}

export type LicenseLedgerBackupRelation = "new" | "incoming-ahead" | "identical" | "current-ahead" | "diverged";

export interface LicenseLedgerExportReceipt {
  path: string;
  eventCount: number;
  lastHash: string;
  sizeBytes: number;
  sha256: string;
}

export interface LicenseLedgerBackupPreview {
  inventoryDigest: string;
  sourcePath: string;
  relation: LicenseLedgerBackupRelation;
  canRestore: boolean;
  reason: string;
  currentEventCount: number;
  backupEventCount: number;
  commonEventCount: number;
  activeRecords: number;
  expiringSoon: number;
  currentLastHash: string;
  backupLastHash: string;
  backupSha256: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
}

export interface LicenseLedgerRestoreReceipt {
  snapshot: LicenseLedgerSnapshot;
  recoveryCreated: boolean;
  recoveryFile: string;
}

export type LicenseLedgerRecoveryIntegrity = "verified" | "invalid";
export type LicenseLedgerRecoveryRelation = LicenseLedgerBackupRelation | "invalid";
export type LicenseLedgerRecoveryDifferenceKind = "changed" | "current-only" | "recovery-only";

export interface LicenseLedgerRecordDifference {
  itemId: string;
  name: string;
  version: string;
  kind: LicenseLedgerRecoveryDifferenceKind;
  currentDecision: LicenseReviewDecision | "";
  recoveryDecision: LicenseReviewDecision | "";
}

export interface LicenseLedgerRecoveryEntry {
  fileName: string;
  integrity: LicenseLedgerRecoveryIntegrity;
  error: string;
  relation: LicenseLedgerRecoveryRelation;
  commonEventCount: number;
  eventCount: number;
  activeRecords: number;
  expiringSoon: number;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
  sha256: string;
  lastHash: string;
  differenceCount: number;
  differences: LicenseLedgerRecordDifference[];
}

export interface LicenseLedgerRecoveryList {
  inventoryDigest: string;
  generatedAt: string;
  totalFiles: number;
  returnedFiles: number;
  verifiedFiles: number;
  invalidFiles: number;
  totalSizeBytes: number;
  retentionLimit: number;
  truncated: boolean;
  entries: LicenseLedgerRecoveryEntry[];
}

export type LicenseEvidenceStatus = "complete" | "partial" | "missing" | "mismatch";
export type LicenseEvidenceIntegrity = "verified" | "unavailable" | "mismatch";

export interface LicenseEvidenceFile {
  name: string;
  kind: "license" | "license-header" | "notice" | "copying" | "authors" | "other";
  sizeBytes: number;
  sha256: string;
}

export interface CanonicalLicenseEvidence {
  spdxId: string;
  sourceUrl: string;
  localResource: string;
  sizeBytes: number;
  sha256: string;
}

export interface LicenseEvidenceItem {
  ecosystem: DependencyEcosystem;
  name: string;
  version: string;
  componentIds: string[];
  declaredLicense: string;
  manifestLicense: string;
  manifestSource: string;
  status: LicenseEvidenceStatus;
  integrity: LicenseEvidenceIntegrity;
  hostApplicability: DependencyApplicability;
  applicabilityReason: string;
  files: LicenseEvidenceFile[];
  canonicalLicense?: CanonicalLicenseEvidence;
  reason: string;
}

export interface LicenseEvidenceReport {
  schemaVersion: 3;
  scannedAt: string;
  inventoryDigest: string;
  localOnly: true;
  summary: {
    total: number;
    complete: number;
    partial: number;
    missing: number;
    mismatch: number;
    integrityVerified: number;
    evidenceFiles: number;
    applicability: {
      applicable: number;
      excluded: number;
      unknown: number;
      actionableGaps: number;
      excludedGaps: number;
      unknownGaps: number;
    };
  };
  items: LicenseEvidenceItem[];
}

export interface SupplyChainReportVerification {
  documentType: "minecraft-server-hub-windows-x64-license-evidence";
  schemaVersion: 1 | 2;
  inventoryDigest: string;
  target: "x86_64-pc-windows-msvc";
  applicable: number;
  excluded: number;
  unknown: number;
  sizeBytes: number;
  sha256: string;
}

export interface DependencyLockfileSummary {
  id: string;
  ecosystem: DependencyEcosystem;
  manifestPath: string;
  lockfilePath: string;
  present: boolean;
  packageCount: number;
  directCount: number;
  developmentCount: number;
  unknownLicenseCount: number;
  reciprocalLicenseCount: number;
  insecureSourceCount: number;
  missingIntegrityCount: number;
  licenses: Array<{ name: string; count: number }>;
}

export interface DependencyInventory {
  generatedFromLockfiles: boolean;
  lockfiles: DependencyLockfileSummary[];
  totals: {
    lockfiles: number;
    packages: number;
    direct: number;
    development: number;
    unknownLicense: number;
    reciprocalLicense: number;
    insecureSource: number;
    missingIntegrity: number;
  };
  packages: DependencyPackageSummary[];
  reviewPackages: DependencyPackageSummary[];
  advisoryPreview: AdvisoryQueryPreview;
  advisoryScan: {
    checked: boolean;
    mode: "offline" | "network";
    reason: string;
  };
}

export interface BundleModuleSummary {
  id: string;
  renderedBytes: number;
}

export interface BundleChunkSummary {
  fileName: string;
  name: string;
  entry: boolean;
  dynamicEntry: boolean;
  rawBytes: number;
  gzipBytes: number;
  imports: string[];
  dynamicImports: string[];
  moduleCount: number;
  largestModules: BundleModuleSummary[];
}

export interface BundleAnalysis {
  status: "current" | "stale" | "missing" | "invalid";
  reportPath: string;
  generatedAt: string;
  sourceNewestAt: string;
  budgets: {
    entryJavaScriptBytes: number;
    chunkJavaScriptBytes: number;
    totalJavaScriptGzipBytes: number;
    totalCssBytes: number;
  };
  totals: {
    totalJavaScriptBytes: number;
    totalJavaScriptGzipBytes: number;
    totalCssBytes: number;
    chunks: number;
    assets: number;
  };
  chunks: BundleChunkSummary[];
  assets: Array<{ fileName: string; rawBytes: number; gzipBytes: number }>;
  violations: Array<{ id: string; actualBytes: number; budgetBytes: number; fileName: string }>;
  error: string;
}

export interface QualityCoverageMetric {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

export interface QualityStageEvidence {
  id: string;
  kind: string;
  command: string;
  status: "pass" | "fail";
  exitCode: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  tests: { total: number; passed: number; failed: number; skipped: number };
  outputTail: string;
}

export interface QualityEvidenceAnalysis {
  status: "current" | "stale" | "missing" | "invalid" | "failed";
  reportPath: string;
  generatedAt: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sourceNewestAt: string;
  sourceDigest: string;
  sourceStable: boolean;
  requiredStageIds: string[];
  summary: {
    totalStages: number;
    passedStages: number;
    failedStages: number;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
  };
  coverage: {
    available: boolean;
    reportPath: string;
    lines: QualityCoverageMetric;
    statements: QualityCoverageMetric;
    functions: QualityCoverageMetric;
    branches: QualityCoverageMetric;
  };
  coverageThresholds: { lines: number; statements: number; functions: number; branches: number };
  coverageViolations: Array<{ id: string; actual: number; threshold: number }>;
  stages: QualityStageEvidence[];
  error: string;
}

export interface CapabilitySecurityAudit {
  status: "verified" | "missing" | "invalid" | "violation";
  capabilityPath: string;
  configurationPath: string;
  capabilityIdentifier: string;
  appIdentifier: string;
  windows: string[];
  configuredWindows: string[];
  permissions: string[];
  allowedPermissions: string[];
  csp: string;
  cspDirectives: Array<{ name: string; values: string[] }>;
  issues: string[];
}

export interface BuildEnvironmentTool {
  id: "node" | "npm" | "rustc" | "cargo" | "rustup";
  command: string;
  available: boolean;
  version: string;
  output: string;
  error: string;
}

export interface BuildEnvironmentAudit {
  status: "ready" | "incomplete" | "unsupported";
  hostOs: string;
  hostArch: string;
  expectedOs: "win32";
  expectedArch: "x64";
  rustTarget: string;
  rustTargetInstalled: boolean;
  installedRustTargets: string[];
  tools: BuildEnvironmentTool[];
  issues: string[];
  error: string;
}

export interface DeveloperInspectionReport {
  schemaVersion: number;
  inspectedAt: string;
  workspaceRoot: string;
  readOnly: boolean;
  expectedVersion: string;
  versionSources: Array<{ id: string; path: string; value: string }>;
  release: {
    artifactVersion: string;
    artifactDirectory: string;
    manifestPath: string;
    installerPath: string;
    signaturePath: string;
    installerSizeBytes: number;
    installerSha256: string;
    manifestVersion: string;
    downloadUrl: string;
    publishedAt: string;
  };
  releaseHistory: Array<{
    version: string;
    manifestPath: string;
    installerPath: string;
    installerSizeBytes: number;
    installerSha256: string;
    downloadUrl: string;
    publishedAt: string;
    signatureValid: boolean;
    integrityError: string;
  }>;
  dependencyInventory: DependencyInventory;
  bundleAnalysis: BundleAnalysis;
  qualityEvidence: QualityEvidenceAnalysis;
  capabilitySecurity: CapabilitySecurityAudit;
  buildEnvironment: BuildEnvironmentAudit;
  remoteFeed: {
    endpoint: string;
    checked: boolean;
    reachable: boolean;
    version: string;
    downloadUrl: string;
    error: string;
  };
  checks: DeveloperCheck[];
  summary: Record<CheckStatus, number>;
}

export interface InspectionHistoryEntry {
  inspectedAt: string;
  expectedVersion: string;
  artifactVersion: string;
  pass: number;
  warning: number;
  fail: number;
  statuses: Record<string, CheckStatus>;
}

export interface InspectionChange {
  id: string;
  before?: CheckStatus;
  after: CheckStatus;
}

export interface ReleaseEvidencePackPreview {
  generatedAt: string;
  projectVersion: string;
  inventoryDigest: string;
  sourceDigest: string;
  payloadSha256: string;
  sizeBytes: number;
  sections: string[];
  warnings: string[];
  checkSummary: Record<CheckStatus, number>;
  qualitySummary: { totalStages?: number; passedStages?: number; totalTests?: number; passedTests?: number };
  licenseSummary: { total?: number; complete?: number; missing?: number; mismatch?: number; evidenceFiles?: number };
  ledgerIntegrity: string;
  ledgerEventCount: number;
  canExport: boolean;
}

export interface ReleaseEvidenceExportReceipt {
  path: string;
  generatedAt: string;
  projectVersion: string;
  payloadSha256: string;
  fileSha256: string;
  sizeBytes: number;
}

export interface ReleaseEvidenceVerification {
  integrity: "verified" | "invalid";
  error: string;
  generatedAt: string;
  projectVersion: string;
  inventoryDigest: string;
  sourceDigest: string;
  payloadSha256: string;
  fileSha256: string;
  sizeBytes: number;
  sectionCount: number;
  matchesCurrentVersion: boolean;
  matchesCurrentInventory: boolean;
  matchesCurrentSource: boolean;
  warnings: string[];
}

export type ReleaseApprovalConditionStatus = "pass" | "warning" | "fail";

export interface ReleaseApprovalCondition {
  id: string;
  status: ReleaseApprovalConditionStatus;
  actual: string;
  source: string;
}

export interface ReleaseApprovalHistoryEntry {
  sequence: number;
  projectVersion: string;
  evidencePayloadSha256: string;
  candidateFingerprint: string;
  approvalDigest: string;
  installerSha256: string;
  reviewer: string;
  rationale: string;
  approvedAt: string;
  warningIds: string[];
  eventHash: string;
}

export interface ReleaseApprovalLedgerSnapshot {
  integrity: "verified";
  eventCount: number;
  lastHash: string;
  updatedAt: string;
  history: ReleaseApprovalHistoryEntry[];
}

export interface ReleaseApprovalPreview {
  generatedAt: string;
  projectVersion: string;
  evidencePayloadSha256: string;
  candidateFingerprint: string;
  approvalDigest: string;
  installerSha256: string;
  expectedConfirmation: string;
  conditions: ReleaseApprovalCondition[];
  blockerCount: number;
  warningCount: number;
  canApprove: boolean;
  ledger: ReleaseApprovalLedgerSnapshot;
}

export interface ReleaseApprovalReceipt {
  event: ReleaseApprovalHistoryEntry;
  ledger: ReleaseApprovalLedgerSnapshot;
}

export interface ReleaseHandoffPreview {
  generatedAt: string;
  status: "ready" | "approvalRequired";
  projectVersion: string;
  candidateFingerprint: string;
  evidencePayloadSha256: string;
  installerSha256: string;
  approvalSequence: number;
  approvalEventHash: string;
  approvedAt: string;
  warningIds: string[];
  ledgerEventCount: number;
  ledgerLastHash: string;
  payloadSha256: string;
  sizeBytes: number;
  containsPersonalData: boolean;
  canExport: boolean;
}

export interface ReleaseHandoffExportReceipt {
  path: string;
  generatedAt: string;
  projectVersion: string;
  candidateFingerprint: string;
  approvalEventHash: string;
  payloadSha256: string;
  fileSha256: string;
  sizeBytes: number;
}

export interface ReleaseHandoffVerification {
  integrity: "verified" | "invalid";
  error: string;
  generatedAt: string;
  projectVersion: string;
  candidateFingerprint: string;
  approvalEventHash: string;
  payloadSha256: string;
  fileSha256: string;
  sizeBytes: number;
  containsPersonalData: boolean;
  matchesCurrentCandidate: boolean;
  matchesCurrentApproval: boolean;
  expectedDigestStatus: "notProvided" | "matches" | "differs";
  originAssurance: "notEstablished" | "trustedDigestMatch" | "localApprovalMatch" | "digestMismatch";
  warnings: string[];
}

export interface DeveloperUpdateInfo {
  configured: boolean;
  currentVersion: string;
  available: boolean;
  version?: string;
  notes?: string;
  publishedAt?: string;
  endpoint: string;
}

export interface DeveloperUpdateProgress {
  phase: "downloading" | "verifying";
  downloadedBytes: number;
  totalBytes?: number;
}
