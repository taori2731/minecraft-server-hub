import { text, type Locale } from "./locale";
import type { AdvisoryScanResult, DependencyInventory, DeveloperCheck, LicenseEvidenceReport, LicenseLedgerBackupPreview, LicenseLedgerExportReceipt, LicenseLedgerRecoveryEntry, LicenseLedgerRecoveryList, LicenseLedgerRestoreReceipt, LicenseLedgerSnapshot, LicensePolicy, LicenseReviewDraft, LicenseReviewItem, LicenseReviewState } from "./types";
import type { SupplyChainExportFormat } from "./supplyChain";
import { AdvisoryGate } from "./AdvisoryGate";
import { LicenseReviewCenter } from "./LicenseReviewCenter";
import { LicenseEvidenceCenter } from "./LicenseEvidenceCenter";
import { PackageExplorer } from "./PackageExplorer";
import { SupplyChainControls } from "./SupplyChainControls";
import { SupplyChainReadinessCenter } from "./SupplyChainReadinessCenter";
import { SupplyChainDiffCenter } from "./SupplyChainDiffCenter";

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "pass" | "warning" | "fail" }) {
  return <article className={`dependency-stat${tone ? ` ${tone}` : ""}`}><span>{label}</span><strong>{value}</strong></article>;
}

export function DependencyCenter({ inventory, checks, locale, policy, onPolicyChange, licenseEvidence, licenseEvidenceBusy, licenseEvidenceError, onCollectLicenseEvidence, licenseReviewState, licenseLedger, licenseLedgerBusy, licenseLedgerError, licenseRecoveries, licenseRecoveryError, onRefreshLicenseRecoveries, onExportLicenseRecovery, onSaveLicenseReview, onRemoveLicenseReview, onExportLicenseReviews, onExportLicenseLedger, onChooseLicenseLedgerBackup, onRestoreLicenseLedgerBackup, advisoryResult, advisoryBusy, advisoryError, onScan, isDesktop, onExport, exporting, exportMessage, onVerify, verificationBusy, verificationMessage }: {
  inventory: DependencyInventory;
  checks: DeveloperCheck[];
  locale: Locale;
  policy: LicensePolicy;
  onPolicyChange: (policy: LicensePolicy) => void;
  licenseEvidence?: LicenseEvidenceReport;
  licenseEvidenceBusy: boolean;
  licenseEvidenceError: string;
  onCollectLicenseEvidence: () => Promise<void>;
  licenseReviewState: LicenseReviewState;
  licenseLedger?: LicenseLedgerSnapshot;
  licenseLedgerBusy: boolean;
  licenseLedgerError: string;
  licenseRecoveries?: LicenseLedgerRecoveryList;
  licenseRecoveryError: string;
  onRefreshLicenseRecoveries: () => Promise<LicenseLedgerRecoveryList | undefined>;
  onExportLicenseRecovery: (recovery: LicenseLedgerRecoveryEntry) => Promise<LicenseLedgerExportReceipt | undefined>;
  onSaveLicenseReview: (item: LicenseReviewItem, draft: LicenseReviewDraft) => Promise<void> | void;
  onRemoveLicenseReview: (itemId: string) => Promise<void> | void;
  onExportLicenseReviews: () => Promise<void>;
  onExportLicenseLedger: () => Promise<LicenseLedgerExportReceipt | undefined>;
  onChooseLicenseLedgerBackup: () => Promise<LicenseLedgerBackupPreview | undefined>;
  onRestoreLicenseLedgerBackup: (preview: LicenseLedgerBackupPreview) => Promise<LicenseLedgerRestoreReceipt>;
  advisoryResult?: AdvisoryScanResult;
  advisoryBusy: boolean;
  advisoryError: string;
  onScan: () => Promise<void>;
  isDesktop: boolean;
  onExport: (format: SupplyChainExportFormat) => Promise<void>;
  exporting: boolean;
  exportMessage: string;
  onVerify: () => Promise<void>;
  verificationBusy: boolean;
  verificationMessage: string;
}) {
  const totals = inventory.totals;
  const evidenceReady = licenseEvidence !== undefined
    && licenseEvidence.summary.applicability.actionableGaps === 0
    && licenseEvidence.summary.applicability.unknownGaps === 0
    && licenseEvidence.summary.mismatch === 0;
  return <section className="panel dependency-center" aria-labelledby="dependency-center-title">
    <div className="panel-heading dependency-heading">
      <div><span className="kicker">SUPPLY CHAIN · D29</span><h2 id="dependency-center-title">{text(locale, "dependencyCenter")}</h2><p>{text(locale, "dependencyIntro")}</p></div>
      <span className={`dependency-mode ${inventory.generatedFromLockfiles ? "pass" : "fail"}`}>{inventory.generatedFromLockfiles ? `✓ ${text(locale, "complete")}` : `× ${text(locale, "lockfileMissing")}`}</span>
    </div>

    <SupplyChainReadinessCenter inventory={inventory} checks={checks} review={licenseReviewState} evidence={licenseEvidence} advisory={advisoryResult} locale={locale} />
    <SupplyChainDiffCenter inventory={inventory} advisory={advisoryResult} locale={locale} />

    <div className="dependency-stats">
      <Stat label={text(locale, "lockfiles")} value={`${totals.lockfiles}/${inventory.lockfiles.length}`} tone={inventory.generatedFromLockfiles ? "pass" : "fail"} />
      <Stat label={text(locale, "packages")} value={totals.packages} />
      <Stat label={text(locale, "directDependencies")} value={totals.direct} />
      <Stat label={text(locale, "unknownLicenses")} value={totals.unknownLicense} tone={totals.unknownLicense > 0 ? "warning" : "pass"} />
      <Stat label={text(locale, "reciprocalLicenses")} value={totals.reciprocalLicense} tone={totals.reciprocalLicense > 0 ? "warning" : "pass"} />
      <Stat label={text(locale, "integrityProblems")} value={totals.insecureSource + totals.missingIntegrity} tone={totals.insecureSource > 0 ? "fail" : totals.missingIntegrity > 0 ? "warning" : "pass"} />
    </div>

    <div className="dependency-lockfiles">
      {inventory.lockfiles.map((lockfile) => {
        const licenseCoverage = lockfile.packageCount === 0 ? 0 : Math.round(((lockfile.packageCount - lockfile.unknownLicenseCount) / lockfile.packageCount) * 100);
        return <article key={lockfile.id} className={lockfile.present ? "" : "missing"}>
          <header><span className={`ecosystem ${lockfile.ecosystem}`}>{lockfile.ecosystem}</span><strong>{lockfile.id}</strong><em>{lockfile.present ? `✓ ${text(locale, "complete")}` : `× ${text(locale, "lockfileMissing")}`}</em></header>
          <dl><div><dt>{text(locale, "manifest")}</dt><dd><code>{lockfile.manifestPath}</code></dd></div><div><dt>{text(locale, "lockfile")}</dt><dd><code>{lockfile.lockfilePath}</code></dd></div></dl>
          <div className="lockfile-metrics"><span><b>{lockfile.packageCount}</b>{text(locale, "packages")}</span><span><b>{lockfile.directCount}</b>{text(locale, "direct")}</span><span><b>{licenseCoverage}%</b>{text(locale, "licenseCoverage")}</span></div>
          <div className="license-chips">{lockfile.licenses.map((license) => <span key={license.name}>{license.name}<b>{license.count}</b></span>)}</div>
        </article>;
      })}
    </div>

    <PackageExplorer packages={inventory.packages} locale={locale} />
    <LicenseEvidenceCenter report={licenseEvidence} locale={locale} busy={licenseEvidenceBusy} error={licenseEvidenceError} isDesktop={isDesktop} onCollect={onCollectLicenseEvidence} />
    <LicenseReviewCenter state={licenseReviewState} evidence={licenseEvidence} ledger={licenseLedger} ledgerBusy={licenseLedgerBusy} ledgerError={licenseLedgerError} recoveries={licenseRecoveries} recoveryError={licenseRecoveryError} locale={locale} onSave={onSaveLicenseReview} onRemove={onRemoveLicenseReview} onExport={onExportLicenseReviews} onExportLedger={onExportLicenseLedger} onChooseBackup={onChooseLicenseLedgerBackup} onRestoreBackup={onRestoreLicenseLedgerBackup} onRefreshRecoveries={onRefreshLicenseRecoveries} onExportRecovery={onExportLicenseRecovery} exporting={exporting} exportMessage={exportMessage} />
    <SupplyChainControls locale={locale} policy={policy} onPolicyChange={onPolicyChange} onExport={onExport} exporting={exporting} message={exportMessage} evidenceReady={evidenceReady} isDesktop={isDesktop} onVerify={onVerify} verificationBusy={verificationBusy} verificationMessage={verificationMessage} />
    <AdvisoryGate preview={inventory.advisoryPreview} result={advisoryResult} locale={locale} isDesktop={isDesktop} busy={advisoryBusy} error={advisoryError} onScan={onScan} />
  </section>;
}
