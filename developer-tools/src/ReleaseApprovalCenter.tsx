import { useEffect, useMemo, useState } from "react";
import { developerBackend } from "./developerBackend";
import { releaseApprovalConditionLabel, releaseApprovalText } from "./releaseApprovalLocale";
import { text, type Locale } from "./locale";
import type { ReleaseApprovalPreview, ReleaseApprovalReceipt } from "./types";

const shortHash = (value: string) => value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "—";
const displayActual = (value: string) => /^[a-f\d]{64}$/i.test(value) ? shortHash(value) : value || "—";

export function ReleaseApprovalCenter({ locale, workspaceRoot, isDesktop }: { locale: Locale; workspaceRoot: string; isDesktop: boolean }) {
  const t = releaseApprovalText(locale);
  const [preview, setPreview] = useState<ReleaseApprovalPreview>();
  const [receipt, setReceipt] = useState<ReleaseApprovalReceipt>();
  const [reviewer, setReviewer] = useState("");
  const [rationale, setRationale] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [warningsConfirmed, setWarningsConfirmed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"prepare" | "approve" | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    setPreview(undefined); setReceipt(undefined); setReviewer(""); setRationale("");
    setConfirmationText(""); setWarningsConfirmed(false); setConfirmed(false); setError("");
  }, [workspaceRoot]);

  const recordedExactCandidate = useMemo(() => preview?.ledger.history.some((entry) =>
    entry.projectVersion === preview.projectVersion && entry.candidateFingerprint === preview.candidateFingerprint,
  ) ?? false, [preview]);

  const formValid = Boolean(preview?.canApprove)
    && reviewer.trim().length >= 2 && reviewer.trim().length <= 80
    && rationale.trim().length >= 8 && rationale.trim().length <= 2_000
    && confirmationText.trim() === preview?.expectedConfirmation
    && confirmed && (preview?.warningCount === 0 || warningsConfirmed)
    && !recordedExactCandidate;

  const prepare = async () => {
    setBusy("prepare"); setError(""); setReceipt(undefined); setConfirmationText("");
    setWarningsConfirmed(false); setConfirmed(false);
    try { setPreview(await developerBackend.previewReleaseApproval(workspaceRoot)); }
    catch (reason) { setError(`${t.failed} ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(""); }
  };

  const approve = async () => {
    if (!preview || !formValid) return;
    setBusy("approve"); setError("");
    try {
      const next = await developerBackend.recordReleaseApproval(workspaceRoot, preview, {
        reviewer, rationale, confirmationText, warningsConfirmed, confirmed: true,
      });
      setReceipt(next);
      setPreview((current) => current ? { ...current, ledger: next.ledger } : current);
    } catch (reason) { setError(`${t.failed} ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(""); }
  };

  return <section className="panel release-approval-panel" aria-labelledby="release-approval-title">
    <div className="panel-heading"><div><span className="kicker">D21 · RELEASE DECISION LEDGER</span><h2 id="release-approval-title">{t.title}</h2><p>{t.intro}</p></div><span className="mode-pill">LOCAL · HASH CHAIN</span></div>
    <p className="release-approval-privacy">{t.privacy}</p>
    {!isDesktop ? <p className="empty-state">{t.nativeOnly}</p> : <button type="button" onClick={() => void prepare()} disabled={busy !== ""}>{busy === "prepare" ? t.preparing : preview ? t.refresh : t.prepare}</button>}

    {preview ? <div className="release-approval-preview">
      <div className={`approval-verdict ${preview.canApprove ? "pass" : "fail"}`} role="status">
        <div><span>{preview.canApprove ? "✓" : "×"}</span><strong>{preview.canApprove ? t.ready : t.blocked}</strong></div>
        <dl><div><dt>{t.blockers}</dt><dd>{preview.blockerCount}</dd></div><div><dt>{t.warnings}</dt><dd>{preview.warningCount}</dd></div><div><dt>{text(locale, "projectVersion")}</dt><dd>{preview.projectVersion}</dd></div></dl>
      </div>

      <div className="approval-digests">
        <div><span>{t.evidenceDigest}</span><code title={preview.evidencePayloadSha256}>{shortHash(preview.evidencePayloadSha256)}</code></div>
        <div><span>{t.approvalDigest}</span><code title={preview.approvalDigest}>{shortHash(preview.approvalDigest)}</code></div>
      </div>

      <div className="approval-gates"><header><div><strong>{t.gates}</strong><small>{t.gateIntro}</small></div></header><div role="list">{preview.conditions.map((item) => <article className={item.status} role="listitem" key={item.id}><span>{item.status === "pass" ? "✓" : item.status === "warning" ? "!" : "×"}</span><div><strong>{releaseApprovalConditionLabel(locale, item.id)}</strong><small>{item.source}</small></div><code title={item.actual}>{displayActual(item.actual)}</code></article>)}</div></div>

      {preview.warningCount > 0 ? <p className="approval-warning">{t.warningNotice}</p> : null}
      {preview.canApprove ? <div className="approval-form">
        <label><span>{t.reviewer}</span><input value={reviewer} maxLength={80} onChange={(event) => setReviewer(event.target.value)} placeholder={t.reviewerPlaceholder} autoComplete="off" /></label>
        <label><span>{t.rationale}</span><textarea value={rationale} maxLength={2000} onChange={(event) => setRationale(event.target.value)} placeholder={t.rationalePlaceholder} rows={3} /></label>
        <label><span>{t.phrase}</span><input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder={t.phraseHint.replace("{phrase}", preview.expectedConfirmation)} autoComplete="off" spellCheck={false} /></label>
        {preview.warningCount > 0 ? <label className="approval-check"><input type="checkbox" checked={warningsConfirmed} onChange={(event) => setWarningsConfirmed(event.target.checked)} /><span>{t.warningsConfirm}</span></label> : null}
        <label className="approval-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>{t.confirm}</span></label>
        <button type="button" className="primary-action" disabled={!formValid || busy !== ""} onClick={() => void approve()}>{busy === "approve" ? t.approving : recordedExactCandidate ? t.approved : t.approve}</button>
      </div> : null}

      <section className="approval-ledger" aria-label={t.ledger}><header><div><span className="kicker">AUDIT TRAIL</span><h3>{t.ledger}</h3></div><div><span>{t.eventCount}</span><strong>{preview.ledger.eventCount}</strong></div></header><h4>{t.history}</h4>{preview.ledger.history.length ? <ol>{preview.ledger.history.map((entry) => <li key={entry.eventHash}><div><strong>{entry.projectVersion} · {entry.reviewer}</strong><time>{new Date(entry.approvedAt).toLocaleString(locale)}</time><p>{entry.rationale}</p></div><code title={entry.eventHash}>#{entry.sequence} · {shortHash(entry.eventHash)}</code></li>)}</ol> : <p>{t.noHistory}</p>}</section>
    </div> : null}
    {receipt ? <p className="success-banner" role="status">{t.approved} SHA-256 {shortHash(receipt.event.eventHash)}</p> : null}
    {error ? <p className="error-banner" role="alert">{error}</p> : null}
  </section>;
}
