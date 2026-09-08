import { useEffect, useState } from "react";
import { developerBackend } from "./developerBackend";
import { releaseEvidenceText } from "./releaseEvidenceLocale";
import type { Locale } from "./locale";
import type { ReleaseEvidenceExportReceipt, ReleaseEvidencePackPreview, ReleaseEvidenceVerification } from "./types";

const shortHash = (value: string) => value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "—";
const size = (value: number, locale: Locale) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1024)} KiB`;

export function ReleaseEvidenceCenter({ locale, workspaceRoot, isDesktop }: { locale: Locale; workspaceRoot: string; isDesktop: boolean }) {
  const t = releaseEvidenceText(locale);
  const [preview, setPreview] = useState<ReleaseEvidencePackPreview>();
  const [verification, setVerification] = useState<ReleaseEvidenceVerification>();
  const [receipt, setReceipt] = useState<ReleaseEvidenceExportReceipt>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"prepare" | "export" | "verify" | "">("");
  const [message, setMessage] = useState("");

  useEffect(() => { setPreview(undefined); setVerification(undefined); setReceipt(undefined); setConfirmed(false); setMessage(""); }, [workspaceRoot]);

  const prepare = async () => {
    setBusy("prepare"); setMessage(""); setReceipt(undefined); setConfirmed(false);
    try { setPreview(await developerBackend.previewReleaseEvidencePack(workspaceRoot)); }
    catch (reason) { setMessage(`${t.failed} ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(""); }
  };
  const exportPack = async () => {
    if (!preview || !confirmed) return;
    setBusy("export"); setMessage("");
    try {
      const next = await developerBackend.exportReleaseEvidencePack(workspaceRoot, preview, true);
      if (next) { setReceipt(next); setMessage(t.exportSuccess.replace("{path}", next.path)); }
      else setMessage(t.canceled);
    } catch (reason) { setMessage(`${t.failed} ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(""); }
  };
  const verify = async () => {
    setBusy("verify"); setMessage("");
    try { const next = await developerBackend.chooseAndVerifyReleaseEvidencePack(workspaceRoot); if (next) setVerification(next); else setMessage(t.canceled); }
    catch (reason) { setMessage(`${t.failed} ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(""); }
  };

  return <section className="panel release-evidence-panel" aria-labelledby="release-evidence-title">
    <div className="panel-heading"><div><span className="kicker">D20 · VERIFIED RELEASE EVIDENCE</span><h2 id="release-evidence-title">{t.title}</h2><p>{t.intro}</p></div><span className="mode-pill">.mshrelease</span></div>
    <div className="release-evidence-privacy"><strong>{t.privacy}</strong></div>
    {!isDesktop ? <p className="empty-state">{t.nativeOnly}</p> : <div className="release-evidence-actions">
      <button type="button" onClick={() => void prepare()} disabled={busy !== ""}>{busy === "prepare" ? t.preparing : preview ? t.refreshPreview : t.prepare}</button>
      <button type="button" className="secondary" onClick={() => void verify()} disabled={busy !== ""}>{busy === "verify" ? t.verifying : t.verify}</button>
    </div>}
    {preview ? <div className="release-evidence-preview">
      <div className="release-evidence-metrics">
        <article><span>{t.version}</span><strong>{preview.projectVersion}</strong></article>
        <article><span>{t.checks}</span><strong>{preview.checkSummary.pass ?? 0} / {preview.checkSummary.warning ?? 0} / {preview.checkSummary.fail ?? 0}</strong></article>
        <article><span>{t.tests}</span><strong>{preview.qualitySummary.passedTests ?? 0} / {preview.qualitySummary.totalTests ?? 0}</strong></article>
        <article><span>{t.licenses}</span><strong>{preview.licenseSummary.complete ?? 0} / {preview.licenseSummary.total ?? 0}</strong></article>
        <article><span>{t.ledger}</span><strong>{preview.ledgerIntegrity} · {preview.ledgerEventCount}</strong></article>
        <article><span>{t.packSize}</span><strong>{size(preview.sizeBytes, locale)}</strong></article>
      </div>
      <div className="release-evidence-digest"><span>{t.digest}</span><code title={preview.payloadSha256}>{shortHash(preview.payloadSha256)}</code></div>
      <div><strong>{t.contents}</strong><div className="evidence-section-list">{preview.sections.map((section) => <span key={section}>✓ {section}</span>)}</div></div>
      {preview.warnings.length ? <p className="warning-text">{t.warningQuality} {preview.warnings.join(", ")}</p> : null}
      <label className="release-evidence-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> <span>{t.confirm}</span></label>
      <button type="button" onClick={() => void exportPack()} disabled={!preview.canExport || !confirmed || busy !== ""}>{busy === "export" ? t.exporting : t.export}</button>
    </div> : null}
    {verification ? <div className={`release-evidence-verification ${verification.integrity}`} role="status">
      <strong>{verification.integrity === "verified" ? t.verified : t.invalid}</strong>
      {verification.error ? <code>{verification.error}</code> : <div className="verification-match-grid">
        {[[t.currentVersion, verification.matchesCurrentVersion], [t.currentInventory, verification.matchesCurrentInventory], [t.currentSource, verification.matchesCurrentSource]].map(([label, matches]) => <span className={matches ? "pass" : "warning"} key={String(label)}> {matches ? "✓" : "!"} {label}: {matches ? t.matches : t.differs}</span>)}
      </div>}
      <code>{shortHash(verification.fileSha256)}</code>
    </div> : null}
    {receipt ? <div className="release-evidence-receipt"><strong>SHA-256</strong><code>{receipt.fileSha256}</code></div> : null}
    {message ? <p className={message.startsWith(t.failed) ? "error-banner" : "success-banner"} role="status">{message}</p> : null}
  </section>;
}
