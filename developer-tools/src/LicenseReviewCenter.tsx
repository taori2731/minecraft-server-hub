import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Locale } from "./locale";
import { reviewText } from "./reviewLocale";
import { evidenceText } from "./evidenceLocale";
import type { LicenseEvidenceItem, LicenseEvidenceReport, LicenseLedgerBackupPreview, LicenseLedgerExportReceipt, LicenseLedgerRecoveryEntry, LicenseLedgerRecoveryList, LicenseLedgerRestoreReceipt, LicenseLedgerSnapshot, LicenseReviewDecision, LicenseReviewDraft, LicenseReviewItem, LicenseReviewRecord, LicenseReviewState, LicenseReviewStatus, LicenseReviewValidityDays } from "./types";

type StatusFilter = "all" | LicenseReviewStatus;
type ClassFilter = "all" | LicenseReviewItem["licenseClass"];

function decisionLabel(locale: Locale, decision: LicenseReviewStatus) {
  const labels = reviewText(locale);
  if (decision === "approved") return labels.decisionApproved;
  if (decision === "restricted") return labels.decisionRestricted;
  if (decision === "blocked") return labels.decisionBlocked;
  if (decision === "expired") return labels.decisionExpired;
  return labels.decisionPending;
}

function ReviewEditor({ item, record, expired, evidenceItem, locale, busy, onSave, onRemove }: {
  item: LicenseReviewItem;
  record?: LicenseReviewRecord;
  expired: boolean;
  evidenceItem?: LicenseEvidenceItem;
  locale: Locale;
  busy: boolean;
  onSave: (item: LicenseReviewItem, draft: LicenseReviewDraft) => Promise<void> | void;
  onRemove: (itemId: string) => Promise<void> | void;
}) {
  const labels = reviewText(locale);
  const [decision, setDecision] = useState<LicenseReviewDecision | "">(record?.decision ?? "");
  const [reviewer, setReviewer] = useState(record?.reviewer ?? "");
  const [rationale, setRationale] = useState(record?.rationale ?? "");
  const [validityDays, setValidityDays] = useState<LicenseReviewValidityDays>(180);
  const valid = decision !== "" && reviewer.trim().length >= 2 && rationale.trim().length >= 8;
  const fieldId = item.id.replace(/[^A-Za-z0-9_-]/g, "-");
  const evidenceLabels = evidenceText(locale);
  const applicability = evidenceItem
    ? evidenceItem.hostApplicability === "applicable"
      ? evidenceLabels.statusApplicable
      : evidenceItem.hostApplicability === "excluded"
        ? evidenceLabels.statusExcluded
        : evidenceLabels.statusApplicabilityUnknown
    : undefined;
  const collectedEvidence = evidenceItem
    ? `${evidenceItem.status === "complete" ? evidenceLabels.statusComplete : evidenceItem.status === "partial" ? evidenceLabels.statusPartial : evidenceItem.status === "mismatch" ? evidenceLabels.statusMismatch : evidenceLabels.statusMissing} · ${evidenceItem.files.length} ${evidenceLabels.files} · ${applicability}`
    : undefined;
  const evidence = collectedEvidence ?? (item.ecosystem === "npm" ? labels.evidenceNpm : item.license ? labels.evidenceCargo : labels.evidenceMissing);

  const status: LicenseReviewStatus = expired ? "expired" : record?.decision ?? "pending";

  return <details className={`license-review-entry ${status}`}>
    <summary>
      <span className={`ecosystem ${item.ecosystem}`}>{item.ecosystem}</span>
      <div><strong>{item.name}</strong><small>{item.version} · {item.componentIds.join(", ")}</small></div>
      <span className={`review-status ${status}`}>{decisionLabel(locale, status)}</span>
    </summary>
    <div className="review-metadata">
      <div><span>{labels.declaredLicense}</span><strong>{item.license || labels.noAssertion}</strong></div>
      <div><span>{labels.evidence}</span><strong>{evidence}</strong></div>
      <div><span>{labels.scope}</span><strong>{item.direct ? labels.direct : labels.transitive} · {item.development ? labels.development : labels.production}</strong></div>
      <div><span>{labels.components}</span><strong>{item.componentIds.join(", ")}</strong></div>
    </div>
    <div className="review-reason"><span>{item.licenseClass === "unknown" ? labels.reasonUnknown : labels.reasonReciprocal}</span><code>{item.id}</code></div>
    <div className="review-form">
      <label htmlFor={`${fieldId}-decision`}><span>{labels.decision}</span><select id={`${fieldId}-decision`} value={decision} onChange={(event) => setDecision(event.target.value as LicenseReviewDecision | "")}><option value="">{labels.decisionPending}</option><option value="approved">{labels.decisionApproved}</option><option value="restricted">{labels.decisionRestricted}</option><option value="blocked">{labels.decisionBlocked}</option></select></label>
      <label htmlFor={`${fieldId}-reviewer`}><span>{labels.reviewer}</span><input id={`${fieldId}-reviewer`} value={reviewer} maxLength={80} placeholder={labels.reviewerPlaceholder} onChange={(event) => setReviewer(event.target.value)} /></label>
      <label htmlFor={`${fieldId}-validity`}><span>{labels.validity}</span><select id={`${fieldId}-validity`} value={validityDays} onChange={(event) => setValidityDays(Number(event.target.value) as LicenseReviewValidityDays)}><option value={30}>{labels.validity30}</option><option value={90}>{labels.validity90}</option><option value={180}>{labels.validity180}</option><option value={365}>{labels.validity365}</option></select></label>
      <label className="review-rationale" htmlFor={`${fieldId}-rationale`}><span>{labels.rationale}</span><textarea id={`${fieldId}-rationale`} value={rationale} maxLength={2000} rows={3} placeholder={labels.rationalePlaceholder} onChange={(event) => setRationale(event.target.value)} /></label>
    </div>
    <div className="review-actions">
      <small>{labels.validationHint}</small>
      {record ? <button type="button" className="text-button" disabled={busy} onClick={() => void onRemove(item.id)}>{labels.remove}</button> : null}
      <button type="button" className="primary-action" disabled={!valid || busy} onClick={() => decision && void onSave(item, { decision, reviewer, rationale, validityDays })}>{busy ? labels.ledgerLoading : labels.save}</button>
    </div>
    {record ? <p className="review-audit">{labels.lastReviewed}: {new Date(record.reviewedAt).toLocaleString(locale)} · {labels.expires}: {new Date(record.expiresAt).toLocaleString(locale)} · {labels.reviewedBy}: {record.reviewer}</p> : null}
  </details>;
}

export function LicenseReviewCenter({ state, evidence, ledger, ledgerBusy = false, ledgerError = "", recoveries, recoveryError = "", locale, onSave, onRemove, onExport, onExportLedger, onChooseBackup, onRestoreBackup, onRefreshRecoveries, onExportRecovery, exporting, exportMessage }: {
  state: LicenseReviewState;
  evidence?: LicenseEvidenceReport;
  ledger?: LicenseLedgerSnapshot;
  ledgerBusy?: boolean;
  ledgerError?: string;
  recoveries?: LicenseLedgerRecoveryList;
  recoveryError?: string;
  locale: Locale;
  onSave: (item: LicenseReviewItem, draft: LicenseReviewDraft) => Promise<void> | void;
  onRemove: (itemId: string) => Promise<void> | void;
  onExport: () => Promise<void>;
  onExportLedger?: () => Promise<LicenseLedgerExportReceipt | undefined>;
  onChooseBackup?: () => Promise<LicenseLedgerBackupPreview | undefined>;
  onRestoreBackup?: (preview: LicenseLedgerBackupPreview) => Promise<LicenseLedgerRestoreReceipt>;
  onRefreshRecoveries?: () => Promise<LicenseLedgerRecoveryList | undefined>;
  onExportRecovery?: (recovery: LicenseLedgerRecoveryEntry) => Promise<LicenseLedgerExportReceipt | undefined>;
  exporting: boolean;
  exportMessage: string;
}) {
  const labels = reviewText(locale);
  const [query, setQuery] = useState("");
  const [licenseClass, setLicenseClass] = useState<ClassFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [backupPreview, setBackupPreview] = useState<LicenseLedgerBackupPreview | undefined>();
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [maintenanceError, setMaintenanceError] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [localRecoveryError, setLocalRecoveryError] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(locale));
  const records = useMemo(() => new Map([...state.expiredRecords, ...state.records].map((record) => [record.itemId, record])), [state.expiredRecords, state.records]);
  const expiredIds = useMemo(() => new Set(state.expiredRecords.map((record) => record.itemId)), [state.expiredRecords]);
  const evidenceItems = useMemo(() => new Map((evidence?.items ?? []).map((item) => [`${item.ecosystem}\0${item.name}\0${item.version}`, item])), [evidence?.items]);
  const filtered = useMemo(() => state.items.filter((item) => {
    const record = records.get(item.id);
    const itemStatus: LicenseReviewStatus = expiredIds.has(item.id) ? "expired" : record?.decision ?? "pending";
    if (licenseClass !== "all" && item.licenseClass !== licenseClass) return false;
    if (status !== "all" && itemStatus !== status) return false;
    if (!deferredQuery) return true;
    return [item.name, item.version, item.license, item.componentIds.join(" "), record?.reviewer ?? "", record?.rationale ?? ""].some((value) => value.toLocaleLowerCase(locale).includes(deferredQuery));
  }), [deferredQuery, expiredIds, licenseClass, locale, records, state.items, status]);
  const resultLabel = labels.results.replace("{shown}", String(filtered.length)).replace("{total}", String(state.items.length));
  const actionLabel = (action: "decision" | "migration" | "reset") => action === "decision" ? labels.actionDecision : action === "migration" ? labels.actionMigration : labels.actionReset;
  const relationLabel = (relation: LicenseLedgerBackupPreview["relation"]) => ({
    new: labels.relationNew,
    "incoming-ahead": labels.relationForward,
    identical: labels.relationIdentical,
    "current-ahead": labels.relationOlder,
    diverged: labels.relationDiverged,
  })[relation];
  const filename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const formatBytes = (bytes: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024)} KiB`;
  const recoveryRelationLabel = (relation: LicenseLedgerRecoveryEntry["relation"]) => relation === "invalid" ? labels.recoveryIntegrityInvalid : relationLabel(relation);
  const differenceLabel = (kind: LicenseLedgerRecoveryEntry["differences"][number]["kind"]) => kind === "changed" ? labels.diffChanged : kind === "current-only" ? labels.diffCurrentOnly : labels.diffRecoveryOnly;
  const savedDecisionLabel = (decision: LicenseReviewDecision | "") => decision ? decisionLabel(locale, decision) : labels.notPresent;

  useEffect(() => {
    setBackupPreview(undefined);
    setRestoreConfirmed(false);
  }, [ledger?.lastHash]);

  const exportLedger = async () => {
    if (!onExportLedger) return;
    setMaintenanceError("");
    setMaintenanceMessage("");
    try {
      const receipt = await onExportLedger();
      setMaintenanceMessage(receipt
        ? labels.backupExported.replace("{file}", filename(receipt.path)).replace("{sha}", `${receipt.sha256.slice(0, 16)}…`)
        : labels.backupCanceled);
    } catch (reason) {
      setMaintenanceError(`${labels.maintenanceError} ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };
  const chooseBackup = async () => {
    if (!onChooseBackup) return;
    setMaintenanceError("");
    setMaintenanceMessage("");
    setRestoreConfirmed(false);
    try {
      const preview = await onChooseBackup();
      setBackupPreview(preview);
      if (!preview) setMaintenanceMessage(labels.backupCanceled);
    } catch (reason) {
      setBackupPreview(undefined);
      setMaintenanceError(`${labels.maintenanceError} ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };
  const restoreBackup = async () => {
    if (!backupPreview || !onRestoreBackup || !restoreConfirmed) return;
    setMaintenanceError("");
    setMaintenanceMessage("");
    try {
      const receipt = await onRestoreBackup(backupPreview);
      setBackupPreview(undefined);
      setRestoreConfirmed(false);
      setMaintenanceMessage(`${labels.restoreComplete} ${receipt.recoveryCreated ? labels.recoveryCreated.replace("{file}", receipt.recoveryFile) : labels.noRecoveryNeeded}`);
    } catch (reason) {
      setMaintenanceError(`${labels.maintenanceError} ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };
  const refreshRecoveries = async () => {
    if (!onRefreshRecoveries) return;
    setRecoveryMessage("");
    setLocalRecoveryError("");
    try {
      await onRefreshRecoveries();
    } catch (reason) {
      setLocalRecoveryError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const exportRecovery = async (recovery: LicenseLedgerRecoveryEntry) => {
    if (!onExportRecovery) return;
    setRecoveryMessage("");
    setLocalRecoveryError("");
    try {
      const receipt = await onExportRecovery(recovery);
      setRecoveryMessage(receipt
        ? labels.recoveryExported.replace("{file}", filename(receipt.path)).replace("{sha}", `${receipt.sha256.slice(0, 16)}…`)
        : labels.backupCanceled);
    } catch (reason) {
      setLocalRecoveryError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return <section className="supply-subsection license-review-center" aria-labelledby="license-review-title">
    <div className="subsection-heading"><div><span className="kicker">{labels.localOnly}</span><h3 id="license-review-title">{labels.title}</h3><p className="section-copy">{labels.intro}</p></div><button type="button" disabled={exporting} onClick={() => void onExport()}>{labels.export}</button></div>
    <p className="review-export-copy">{labels.exportIntro}</p>
    {ledgerError ? <div className="license-ledger-error" role="alert"><strong>{labels.ledgerUnavailable}</strong><span>{labels.ledgerError}</span><code>{ledgerError}</code></div> : null}
    <div className={`license-ledger-status${ledgerError ? " unavailable" : ""}`} aria-live="polite">
      <div><span>{ledger ? labels.nativeLedger : labels.browserStorage}</span><strong>{ledgerBusy ? labels.ledgerLoading : ledger ? `✓ ${labels.ledgerVerified}` : labels.browserStorage}</strong></div>
      <div><span>{labels.ledgerEvents}</span><strong>{ledger?.eventCount ?? 0}</strong></div>
      <div><span>{labels.expiringSoon}</span><strong>{ledger?.expiringSoon ?? 0}</strong></div>
      <div><span>{labels.lastHash}</span><code>{ledger ? `${ledger.lastHash.slice(0, 16)}…` : "—"}</code></div>
    </div>
    {ledger ? <details className="license-ledger-history"><summary>{labels.historyTitle}<span>{ledger.history.length}</span></summary><p>{labels.historyIntro}</p>{ledger.history.length === 0 ? <p className="empty-state">{labels.noLedgerHistory}</p> : <ol>{ledger.history.slice(0, 12).map((entry) => <li key={`${entry.sequence}:${entry.eventHash}`}><span className={`ledger-action ${entry.action}`}>{actionLabel(entry.action)}</span><div><strong>#{entry.sequence} · {entry.name} {entry.version}</strong><small>{new Date(entry.occurredAt).toLocaleString(locale)}{entry.reviewer ? ` · ${entry.reviewer}` : ""}</small></div><code>{entry.eventHash.slice(0, 12)}…</code></li>)}</ol>}</details> : null}
    <section className="license-ledger-maintenance" aria-labelledby="license-ledger-maintenance-title">
      <div><span className="kicker">VERIFIED BACKUP · D16</span><h4 id="license-ledger-maintenance-title">{labels.ledgerBackupTitle}</h4><p>{labels.ledgerBackupIntro}</p></div>
      <div className="ledger-maintenance-actions"><button type="button" disabled={!ledger || ledgerBusy || !onExportLedger} onClick={() => void exportLedger()}>{labels.exportLedger}</button><button type="button" disabled={!ledger || ledgerBusy || !onChooseBackup} onClick={() => void chooseBackup()}>{labels.verifyBackup}</button></div>
      {maintenanceMessage ? <p className="ledger-maintenance-message" aria-live="polite">{maintenanceMessage}</p> : null}
      {maintenanceError ? <p className="license-ledger-error" role="alert">{maintenanceError}</p> : null}
      {backupPreview ? <div className={`ledger-backup-preview ${backupPreview.canRestore ? "ready" : "blocked"}`}>
        <header><div><span>{labels.backupVerified}</span><strong>{filename(backupPreview.sourcePath)}</strong></div><em>{relationLabel(backupPreview.relation)}</em></header>
        <dl><div><dt>{labels.currentEvents}</dt><dd>{backupPreview.currentEventCount}</dd></div><div><dt>{labels.backupEvents}</dt><dd>{backupPreview.backupEventCount}</dd></div><div><dt>{labels.commonEvents}</dt><dd>{backupPreview.commonEventCount}</dd></div><div><dt>{labels.activeDecisions}</dt><dd>{backupPreview.activeRecords}</dd></div><div><dt>{labels.backupUpdated}</dt><dd>{new Date(backupPreview.updatedAt).toLocaleString(locale)}</dd></div><div><dt>{labels.backupSize}</dt><dd>{formatBytes(backupPreview.sizeBytes)}</dd></div></dl>
        <div className="ledger-backup-hashes"><span>{labels.backupFileHash}</span><code>{backupPreview.backupSha256}</code><span>{labels.lastHash}</span><code>{backupPreview.backupLastHash}</code></div>
        <p className={backupPreview.canRestore ? "restore-ready" : "restore-blocked"}>{backupPreview.canRestore ? labels.restoreReady : labels.restoreBlocked}</p>
        {backupPreview.canRestore ? <div className="ledger-restore-confirmation"><label><input type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} />{labels.restoreConfirm}</label><button type="button" className="danger-action" disabled={!restoreConfirmed || ledgerBusy} onClick={() => void restoreBackup()}>{ledgerBusy ? labels.ledgerLoading : labels.restoreBackup}</button></div> : null}
      </div> : null}
    </section>
    <section className="license-recovery-center" aria-labelledby="license-recovery-title">
      <div className="recovery-center-heading"><div><span className="kicker">RECOVERY HISTORY · D17</span><h4 id="license-recovery-title">{labels.recoveryTitle}</h4><p>{labels.recoveryIntro}</p></div><button type="button" disabled={!ledger || ledgerBusy || !onRefreshRecoveries} onClick={() => void refreshRecoveries()}>{ledgerBusy ? labels.ledgerLoading : labels.refreshRecoveries}</button></div>
      {recoveryMessage ? <p className="ledger-maintenance-message" aria-live="polite">{recoveryMessage}</p> : null}
      {recoveryError || localRecoveryError ? <p className="license-ledger-error" role="alert">{labels.recoveryOperationError} {localRecoveryError || recoveryError}</p> : null}
      {recoveries ? <>
        <div className="recovery-summary"><article><span>{labels.recoveryFiles}</span><strong>{recoveries.totalFiles}</strong></article><article className="pass"><span>{labels.recoveryVerified}</span><strong>{recoveries.verifiedFiles}</strong></article><article className={recoveries.invalidFiles ? "fail" : "pass"}><span>{labels.recoveryInvalid}</span><strong>{recoveries.invalidFiles}</strong></article><article><span>{labels.recoveryStorage}</span><strong>{formatBytes(recoveries.totalSizeBytes)}</strong></article></div>
        {recoveries.truncated || recoveries.totalFiles > recoveries.retentionLimit ? <p className="recovery-retention-warning">{labels.recoveryRetention.replace("{limit}", String(recoveries.retentionLimit))}{recoveries.truncated ? ` ${labels.recoveryTruncated}` : ""}</p> : null}
        {recoveries.entries.length === 0 ? <p className="empty-state recovery-empty">{labels.noRecoveries}</p> : <div className="recovery-list">{recoveries.entries.map((recovery) => <details key={recovery.fileName} className={`recovery-entry ${recovery.integrity}`}>
          <summary><span className={`recovery-integrity ${recovery.integrity}`}>{recovery.integrity === "verified" ? `✓ ${labels.recoveryIntegrityVerified}` : `× ${labels.recoveryIntegrityInvalid}`}</span><div><strong>{recovery.fileName}</strong><small>{recovery.updatedAt ? new Date(recovery.updatedAt).toLocaleString(locale) : recovery.error}</small></div><em>{recoveryRelationLabel(recovery.relation)}</em></summary>
          {recovery.integrity === "verified" ? <div className="recovery-entry-body">
            <dl><div><dt>{labels.recoveryEventCount}</dt><dd>{recovery.eventCount}</dd></div><div><dt>{labels.activeDecisions}</dt><dd>{recovery.activeRecords}</dd></div><div><dt>{labels.differenceCount}</dt><dd>{recovery.differenceCount}</dd></div><div><dt>{labels.backupSize}</dt><dd>{formatBytes(recovery.sizeBytes)}</dd></div></dl>
            <div className="ledger-backup-hashes"><span>{labels.backupFileHash}</span><code>{recovery.sha256}</code><span>{labels.lastHash}</span><code>{recovery.lastHash}</code></div>
            <div className="recovery-differences"><h5>{labels.viewDifferences}</h5>{recovery.differences.length === 0 ? <p>{labels.noDifferences}</p> : <ol>{recovery.differences.map((difference) => <li key={difference.itemId}><span className={`difference-kind ${difference.kind}`}>{differenceLabel(difference.kind)}</span><div><strong>{difference.name} {difference.version}</strong><code>{difference.itemId}</code></div><div className="decision-transition"><span>{labels.currentDecision}: <b>{savedDecisionLabel(difference.currentDecision)}</b></span><span aria-hidden="true">→</span><span>{labels.recoveryDecision}: <b>{savedDecisionLabel(difference.recoveryDecision)}</b></span></div></li>)}</ol>}</div>
            <div className="recovery-actions"><p>{labels.recoveryExportHint}</p><button type="button" disabled={ledgerBusy || !onExportRecovery} onClick={() => void exportRecovery(recovery)}>{labels.exportRecovery}</button></div>
          </div> : <p className="recovery-invalid-reason">{labels.recoveryInvalidReason} <code>{recovery.error}</code></p>}
        </details>)}</div>}
      </> : <p className="empty-state recovery-empty">{ledgerBusy ? labels.ledgerLoading : labels.recoveryNotLoaded}</p>}
    </section>
    {exportMessage ? <p className="export-message" aria-live="polite">{exportMessage}</p> : null}
    <div className="review-summary">
      <article><span>{labels.total}</span><strong>{state.summary.total}</strong></article>
      <article className={state.summary.pending > 0 ? "warning" : "pass"}><span>{labels.pending}</span><strong>{state.summary.pending}</strong></article>
      <article className="pass"><span>{labels.approved}</span><strong>{state.summary.approved}</strong></article>
      <article className={state.summary.restricted > 0 ? "warning" : ""}><span>{labels.restricted}</span><strong>{state.summary.restricted}</strong></article>
      <article className={state.summary.blocked > 0 ? "fail" : ""}><span>{labels.blocked}</span><strong>{state.summary.blocked}</strong></article>
      <article className={state.summary.expired > 0 ? "warning" : ""}><span>{labels.expired}</span><strong>{state.summary.expired}</strong></article>
      <article className={state.summary.stale > 0 ? "warning" : ""}><span>{labels.stale}</span><strong>{state.summary.stale}</strong></article>
    </div>
    {state.summary.stale > 0 ? <p className="stale-review-note">{labels.staleHint}</p> : null}
    <div className="review-filters">
      <label><span className="sr-only">{labels.search}</span><input type="search" value={query} placeholder={labels.search} onChange={(event) => setQuery(event.target.value)} /></label>
      <label><span className="sr-only">{labels.allClasses}</span><select value={licenseClass} onChange={(event) => setLicenseClass(event.target.value as ClassFilter)}><option value="all">{labels.allClasses}</option><option value="unknown">{labels.reasonUnknown}</option><option value="reciprocal">{labels.reasonReciprocal}</option></select></label>
      <label><span className="sr-only">{labels.allStatuses}</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">{labels.allStatuses}</option><option value="pending">{labels.decisionPending}</option><option value="approved">{labels.decisionApproved}</option><option value="restricted">{labels.decisionRestricted}</option><option value="blocked">{labels.decisionBlocked}</option><option value="expired">{labels.decisionExpired}</option></select></label>
      <span className="review-results" aria-live="polite">{resultLabel}</span>
    </div>
    <div className="license-review-list">
      {filtered.map((item) => <ReviewEditor key={`${item.id}:${records.get(item.id)?.reviewedAt ?? "pending"}`} item={item} record={records.get(item.id)} expired={expiredIds.has(item.id)} evidenceItem={evidenceItems.get(`${item.ecosystem}\0${item.name}\0${item.version}`)} locale={locale} busy={ledgerBusy} onSave={onSave} onRemove={onRemove} />)}
      {filtered.length === 0 ? <p className="empty-state">{labels.noMatches}</p> : null}
    </div>
  </section>;
}
