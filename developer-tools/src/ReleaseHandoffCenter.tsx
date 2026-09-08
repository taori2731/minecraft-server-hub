import { useEffect, useState } from "react";
import { developerBackend } from "./developerBackend";
import type { Locale } from "./locale";
import { releaseHandoffContents, releaseHandoffText, releaseHandoffTrustText } from "./releaseHandoffLocale";
import type { ReleaseHandoffExportReceipt, ReleaseHandoffPreview, ReleaseHandoffVerification } from "./types";

const shortHash = (value: string) => value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "—";
const formatSize = (value: number, locale: Locale) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1024)} KiB`;

export function ReleaseHandoffCenter({ locale, workspaceRoot, isDesktop }: { locale: Locale; workspaceRoot: string; isDesktop: boolean }) {
  const t = releaseHandoffText(locale);
  const trust = releaseHandoffTrustText(locale);
  const contents = releaseHandoffContents(locale);
  const [preview, setPreview] = useState<ReleaseHandoffPreview>();
  const [verification, setVerification] = useState<ReleaseHandoffVerification>();
  const [receipt, setReceipt] = useState<ReleaseHandoffExportReceipt>();
  const [confirmed, setConfirmed] = useState(false);
  const [expectedDigest, setExpectedDigest] = useState("");
  const [busy, setBusy] = useState<"prepare" | "export" | "verify" | "">("");
  const [message, setMessage] = useState("");

  useEffect(() => { setPreview(undefined); setVerification(undefined); setReceipt(undefined); setConfirmed(false); setExpectedDigest(""); setMessage(""); }, [workspaceRoot]);

  const normalizedExpectedDigest = expectedDigest.trim();
  const expectedDigestValid = normalizedExpectedDigest === "" || /^[0-9a-fA-F]{64}$/.test(normalizedExpectedDigest);

  const prepare = async () => {
    setBusy("prepare"); setMessage(""); setReceipt(undefined); setConfirmed(false);
    try { setPreview(await developerBackend.previewReleaseHandoff(workspaceRoot)); }
    catch (reason) { setMessage(`${t.failed} ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(""); }
  };

  const exportPack = async () => {
    if (!preview?.canExport || !confirmed) return;
    setBusy("export"); setMessage("");
    try {
      const next = await developerBackend.exportReleaseHandoff(workspaceRoot, preview, true);
      if (next) { setReceipt(next); setMessage(t.exported.replace("{path}", next.path)); }
      else setMessage(t.canceled);
    } catch (reason) { setMessage(`${t.failed} ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(""); }
  };

  const verify = async () => {
    setBusy("verify"); setMessage("");
    try {
      const next = await developerBackend.chooseAndVerifyReleaseHandoff(workspaceRoot, normalizedExpectedDigest);
      if (next) setVerification(next); else setMessage(t.canceled);
    } catch (reason) { setMessage(`${t.failed} ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(""); }
  };

  const originLabel = verification?.originAssurance === "trustedDigestMatch" ? trust.trustedDigestMatch
    : verification?.originAssurance === "localApprovalMatch" ? trust.localApprovalMatch
      : verification?.originAssurance === "digestMismatch" ? trust.digestMismatch : trust.notEstablished;
  const digestLabel = verification?.expectedDigestStatus === "matches" ? trust.digestMatches
    : verification?.expectedDigestStatus === "differs" ? trust.digestDiffers : trust.digestNotProvided;

  return <section className="panel release-handoff-panel" aria-labelledby="release-handoff-title">
    <div className="panel-heading"><div><span className="kicker">D23 · INDEPENDENT TRUST ANCHOR</span><h2 id="release-handoff-title">{t.title}</h2><p>{t.intro}</p></div><span className="mode-pill">.mshhandoff</span></div>
    <p className="release-handoff-privacy">{t.privacy}</p>
    {!isDesktop ? <p className="empty-state">{t.nativeOnly}</p> : <>
      <div className="release-handoff-trust-input">
        <div><strong>{trust.title}</strong><span>{trust.expectedDigestHint}</span></div>
        <label><span>{trust.expectedDigest}</span><input value={expectedDigest} maxLength={64} spellCheck={false} autoComplete="off" placeholder={trust.expectedDigestPlaceholder} aria-invalid={!expectedDigestValid} onChange={(event) => { setExpectedDigest(event.target.value); setVerification(undefined); }} /></label>
      </div>
      <div className="release-handoff-actions">
        <button type="button" onClick={() => void prepare()} disabled={busy !== ""}>{busy === "prepare" ? t.preparing : preview ? t.refresh : t.prepare}</button>
        <button type="button" className="secondary" onClick={() => void verify()} disabled={busy !== "" || !expectedDigestValid}>{busy === "verify" ? t.verifying : t.verify}</button>
      </div>
    </>}

    {preview ? preview.canExport ? <div className="release-handoff-preview">
      <div className="handoff-verdict pass" role="status"><strong>✓ {t.ready}</strong><span>{t.noPersonalData}</span><span>{t.noPublish}</span></div>
      <div className="release-handoff-metrics">
        <article><span>{t.version}</span><strong>{preview.projectVersion}</strong></article>
        <article><span>{t.approval}</span><strong>#{preview.approvalSequence}</strong></article>
        <article><span>{t.warnings}</span><strong>{preview.warningIds.length}</strong></article>
        <article><span>{t.packSize}</span><strong>{formatSize(preview.sizeBytes, locale)}</strong></article>
      </div>
      <div className="handoff-digests"><div><span>{t.candidateDigest}</span><code title={preview.candidateFingerprint}>{shortHash(preview.candidateFingerprint)}</code></div><div><span>{t.approvalDigest}</span><code title={preview.approvalEventHash}>{shortHash(preview.approvalEventHash)}</code></div><div><span>{t.payloadDigest}</span><code title={preview.payloadSha256}>{shortHash(preview.payloadSha256)}</code></div></div>
      <div><strong>{t.contents}</strong><div className="evidence-section-list">{contents.map((item) => <span key={item}>✓ {item}</span>)}</div></div>
      <label className="release-handoff-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>{t.confirm}</span></label>
      <button type="button" className="primary-action" onClick={() => void exportPack()} disabled={!confirmed || busy !== ""}>{busy === "export" ? t.exporting : t.export}</button>
    </div> : <div className="handoff-verdict fail" role="status"><strong>× {t.approvalRequired}</strong><p>{t.approvalRequiredHint}</p><code>{shortHash(preview.candidateFingerprint)}</code></div> : null}

    {verification ? <div className={`release-handoff-verification ${verification.integrity} ${verification.originAssurance === "digestMismatch" ? "trust-failed" : ""}`} role="status">
      <strong>{verification.integrity === "verified" ? t.verified : t.invalid}</strong>
      {verification.error ? <code>{verification.error}</code> : <div className="handoff-trust-results">
        <span className="pass">✓ {trust.selfIntegrity}: {trust.selfIntegrityPassed}</span>
        <span className={verification.expectedDigestStatus === "matches" ? "pass" : verification.expectedDigestStatus === "differs" ? "fail" : "warning"}>{verification.expectedDigestStatus === "matches" ? "✓" : "!"} {trust.expectedDigest}: {digestLabel}</span>
        <span className={verification.originAssurance === "trustedDigestMatch" || verification.originAssurance === "localApprovalMatch" ? "pass" : verification.originAssurance === "digestMismatch" ? "fail" : "warning"}>{verification.originAssurance === "trustedDigestMatch" || verification.originAssurance === "localApprovalMatch" ? "✓" : "!"} {trust.originAssurance}: {originLabel}</span>
        <span className={verification.matchesCurrentCandidate ? "pass" : "warning"}>{verification.matchesCurrentCandidate ? "✓" : "!"} {t.currentCandidate}: {verification.matchesCurrentCandidate ? t.matches : t.differs}</span>
        <span className={verification.matchesCurrentApproval ? "pass" : "warning"}>{verification.matchesCurrentApproval ? "✓" : "!"} {t.currentApproval}: {verification.matchesCurrentApproval ? t.matches : t.differs}</span>
      </div>}
      <p className="handoff-trust-caveat">{trust.caveat}</p><code>{shortHash(verification.fileSha256)}</code>
    </div> : null}
    {receipt ? <div className="release-handoff-receipt"><strong>SHA-256</strong><code>{receipt.fileSha256}</code></div> : null}
    {message ? <p className={message.startsWith(t.failed) ? "error-banner" : "success-banner"} role="status">{message}</p> : null}
  </section>;
}
