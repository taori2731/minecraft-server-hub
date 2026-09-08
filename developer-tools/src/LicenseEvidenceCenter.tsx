import { useDeferredValue, useMemo, useState } from "react";
import { cargoApplicabilityReason } from "./cargoApplicabilityLocale";
import { evidenceText } from "./evidenceLocale";
import { licenseAuditText } from "./licenseAuditLocale";
import type { Locale } from "./locale";
import type { DependencyApplicability, LicenseEvidenceIntegrity, LicenseEvidenceItem, LicenseEvidenceReport, LicenseEvidenceStatus } from "./types";

function statusLabel(locale: Locale, status: LicenseEvidenceStatus) {
  const labels = evidenceText(locale);
  if (status === "complete") return labels.statusComplete;
  if (status === "partial") return labels.statusPartial;
  if (status === "mismatch") return labels.statusMismatch;
  return labels.statusMissing;
}

function integrityLabel(locale: Locale, integrity: LicenseEvidenceIntegrity) {
  const labels = evidenceText(locale);
  if (integrity === "verified") return labels.integrityVerified;
  if (integrity === "mismatch") return labels.integrityMismatch;
  return labels.integrityUnavailable;
}

function applicabilityLabel(locale: Locale, applicability: DependencyApplicability) {
  const labels = evidenceText(locale);
  if (applicability === "applicable") return labels.statusApplicable;
  if (applicability === "excluded") return labels.statusExcluded;
  return labels.statusApplicabilityUnknown;
}

function applicabilityReasonLabel(locale: Locale, reason: string) {
  const labels = evidenceText(locale);
  const reasons: Record<string, string> = {
    "npm-no-platform-restriction": labels.reasonNpmNoRestriction,
    "npm-platform-compatible": labels.reasonNpmCompatible,
    "npm-os-excluded": labels.reasonNpmOsExcluded,
    "npm-cpu-excluded": labels.reasonNpmCpuExcluded,
    "npm-os-cpu-excluded": labels.reasonNpmOsCpuExcluded,
    "cargo-lockfile-target-unknown": labels.reasonCargoUnknown,
  };
  return reason.split(",").map((item) => cargoApplicabilityReason(locale, item) ?? reasons[item] ?? item).join(" · ");
}

function reasonLabel(locale: Locale, reason: string) {
  const labels = evidenceText(locale);
  const reasons: Record<string, string> = {
    "local-evidence-complete": labels.reasonComplete,
    "local-manifest-missing": labels.reasonManifestMissing,
    "manifest-version-mismatch": labels.reasonVersionMismatch,
    "manifest-license-mismatch": labels.reasonLicenseMismatch,
    "archive-integrity-mismatch": labels.reasonIntegrityMismatch,
    "license-file-missing": labels.reasonFileMissing,
    "source-header-canonical-license-complete": licenseAuditText(locale).supplemented,
    "unsupported-ecosystem": labels.reasonUnsupported,
  };
  return reasons[reason] ?? reason;
}

function EvidenceItem({ item, locale }: { item: LicenseEvidenceItem; locale: Locale }) {
  const labels = evidenceText(locale);
  const auditLabels = licenseAuditText(locale);
  return <details className={`license-evidence-entry ${item.status}`}>
    <summary>
      <span className={`ecosystem ${item.ecosystem}`}>{item.ecosystem}</span>
      <div><strong>{item.name}</strong><small>{item.version} · {item.componentIds.join(", ")}</small></div>
      <div className="evidence-badges"><span className={`applicability-status ${item.hostApplicability}`}>{applicabilityLabel(locale, item.hostApplicability)}</span><span className={`evidence-status ${item.status}`}>{statusLabel(locale, item.status)}</span></div>
    </summary>
    <div className="evidence-metadata">
      <div><span>{labels.declared}</span><strong>{item.declaredLicense || "NOASSERTION"}</strong></div>
      <div><span>{labels.manifest}</span><strong>{item.manifestLicense || "—"}</strong></div>
      <div><span>{labels.source}</span><strong>{item.manifestSource || "—"}</strong></div>
      <div><span>{labels.integrity}</span><strong className={item.integrity}>{integrityLabel(locale, item.integrity)}</strong></div>
      <div><span>{labels.applicability}</span><strong className={`applicability-value ${item.hostApplicability}`}>{applicabilityLabel(locale, item.hostApplicability)}</strong><small>{applicabilityReasonLabel(locale, item.applicabilityReason)}</small></div>
    </div>
    <p className={`evidence-reason ${item.status}`}>{reasonLabel(locale, item.reason)}</p>
    {item.canonicalLicense ? <div className="canonical-license-evidence"><div><span>{auditLabels.canonicalTitle}</span><strong>{item.canonicalLicense.spdxId}</strong></div><dl><div><dt>{auditLabels.canonicalSource}</dt><dd><code>{item.canonicalLicense.sourceUrl}</code></dd></div><div><dt>{auditLabels.canonicalBundled}</dt><dd><code>{item.canonicalLicense.localResource} · SHA-256 {item.canonicalLicense.sha256.slice(0, 16)}…</code></dd></div></dl></div> : null}
    <div className="evidence-files">
      <h4>{labels.evidenceFiles}</h4>
      {item.files.length > 0 ? item.files.map((file) => <article key={`${file.name}:${file.sha256}`}><div><strong>{file.name}</strong><small>{file.kind} · {new Intl.NumberFormat(locale).format(file.sizeBytes)} B</small></div><code title={file.sha256}>{labels.fileHash}: {file.sha256.slice(0, 16)}…</code></article>) : <p>{labels.noFiles}</p>}
    </div>
  </details>;
}

export function LicenseEvidenceCenter({ report, locale, busy, error, isDesktop, onCollect }: {
  report?: LicenseEvidenceReport;
  locale: Locale;
  busy: boolean;
  error: string;
  isDesktop: boolean;
  onCollect: () => Promise<void>;
}) {
  const labels = evidenceText(locale);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | LicenseEvidenceStatus>("all");
  const [applicability, setApplicability] = useState<"all" | DependencyApplicability>("all");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(locale));
  const filtered = useMemo(() => (report?.items ?? []).filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    if (applicability !== "all" && item.hostApplicability !== applicability) return false;
    if (!deferredQuery) return true;
    return [item.name, item.version, item.declaredLicense, item.manifestLicense, item.componentIds.join(" "), item.applicabilityReason, item.files.map((file) => file.name).join(" ")]
      .some((value) => value.toLocaleLowerCase(locale).includes(deferredQuery));
  }), [applicability, deferredQuery, locale, report?.items, status]);
  const resultLabel = labels.results.replace("{shown}", String(filtered.length)).replace("{total}", String(report?.summary.total ?? 0));

  return <section className="supply-subsection license-evidence-center" aria-labelledby="license-evidence-title">
    <div className="subsection-heading"><div><span className="kicker">{labels.localOnly}</span><h3 id="license-evidence-title">{labels.title}</h3><p className="section-copy">{labels.intro}</p></div><button type="button" className="primary-action" disabled={!isDesktop || busy} title={isDesktop ? undefined : labels.desktopOnly} onClick={() => void onCollect()}>{busy ? labels.scanning : labels.scan}</button></div>
    <p className="evidence-boundary">✓ {labels.localBoundary}</p>
    {error ? <p className="evidence-error" role="alert">{error}</p> : null}
    {!report ? <div className="evidence-not-run"><strong>{labels.notRunTitle}</strong><p>{isDesktop ? labels.notRunBody : labels.desktopOnly}</p></div> : <>
      <div className="evidence-summary">
        <article><span>{labels.total}</span><strong>{report.summary.total}</strong></article>
        <article className="pass"><span>{labels.complete}</span><strong>{report.summary.complete}</strong></article>
        <article className={report.summary.partial > 0 ? "warning" : "pass"}><span>{labels.partial}</span><strong>{report.summary.partial}</strong></article>
        <article className={report.summary.missing > 0 ? "warning" : "pass"}><span>{labels.missing}</span><strong>{report.summary.missing}</strong></article>
        <article className={report.summary.mismatch > 0 ? "fail" : "pass"}><span>{labels.mismatch}</span><strong>{report.summary.mismatch}</strong></article>
        <article><span>{labels.verifiedArchives}</span><strong>{report.summary.integrityVerified}</strong></article>
        <article><span>{labels.files}</span><strong>{report.summary.evidenceFiles}</strong></article>
        <article className={report.summary.applicability.actionableGaps > 0 ? "warning" : "pass"}><span>{labels.applicableGaps}</span><strong>{report.summary.applicability.actionableGaps}</strong></article>
        <article className={report.summary.applicability.unknownGaps > 0 ? "warning" : "pass"}><span>{labels.unknownGaps}</span><strong>{report.summary.applicability.unknownGaps}</strong></article>
        <article><span>{labels.excludedGaps}</span><strong>{report.summary.applicability.excludedGaps}</strong></article>
      </div>
      <p className="evidence-collected-at">{labels.collectedAt}: {new Date(report.scannedAt).toLocaleString(locale)}</p>
      <div className="evidence-filters">
        <label><span className="sr-only">{labels.search}</span><input type="search" value={query} placeholder={labels.search} onChange={(event) => setQuery(event.target.value)} /></label>
        <label><span className="sr-only">{labels.allStatuses}</span><select value={status} onChange={(event) => setStatus(event.target.value as "all" | LicenseEvidenceStatus)}><option value="all">{labels.allStatuses}</option><option value="complete">{labels.statusComplete}</option><option value="partial">{labels.statusPartial}</option><option value="missing">{labels.statusMissing}</option><option value="mismatch">{labels.statusMismatch}</option></select></label>
        <label><span className="sr-only">{labels.allApplicability}</span><select value={applicability} onChange={(event) => setApplicability(event.target.value as "all" | DependencyApplicability)}><option value="all">{labels.allApplicability}</option><option value="applicable">{labels.statusApplicable}</option><option value="excluded">{labels.statusExcluded}</option><option value="unknown">{labels.statusApplicabilityUnknown}</option></select></label>
        <span className="evidence-results" aria-live="polite">{resultLabel}</span>
      </div>
      <div className="license-evidence-list">{filtered.map((item) => <EvidenceItem key={`${item.ecosystem}:${item.name}:${item.version}:${item.status}`} item={item} locale={locale} />)}{filtered.length === 0 ? <p className="empty-state">{labels.noMatches}</p> : null}</div>
    </>}
  </section>;
}
