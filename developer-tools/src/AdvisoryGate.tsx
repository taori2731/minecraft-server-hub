import { useEffect, useState } from "react";
import { text, type Locale } from "./locale";
import type { AdvisoryQueryPreview, AdvisoryScanResult } from "./types";

export function AdvisoryGate({ preview, result, locale, isDesktop, busy, error, onScan }: {
  preview: AdvisoryQueryPreview;
  result?: AdvisoryScanResult;
  locale: Locale;
  isDesktop: boolean;
  busy: boolean;
  error: string;
  onScan: () => Promise<void>;
}) {
  const [approved, setApproved] = useState(false);
  useEffect(() => { setApproved(false); }, [preview.requestDigest]);
  return <section className="supply-subsection advisory-gate" aria-labelledby="advisory-title">
    <div className="subsection-heading"><div><span className="kicker">OPT-IN · OSV API</span><h3 id="advisory-title">{text(locale, "advisoryCenter")}</h3></div>{result ? <span className={`result-pill ${result.complete ? "pass" : "warning"}`}>{text(locale, result.complete ? "scanComplete" : "scanIncomplete")}</span> : null}</div>
    <p className="section-copy">{text(locale, "onlineLookupIntro")}</p>
    <div className="advisory-preview">
      <dl><div><dt>{text(locale, "endpoint")}</dt><dd><code>{preview.endpoint}</code></dd></div><div><dt>{text(locale, "uniquePackages")}</dt><dd>{preview.uniquePackages}</dd></div><div><dt>{text(locale, "duplicatesRemoved")}</dt><dd>{preview.duplicatePackages}</dd></div><div><dt>{text(locale, "requestDigest")}</dt><dd><code>{preview.requestDigest}</code></dd></div></dl>
      <div className="transmission-grid"><article className="pass"><strong>✓ {text(locale, "fieldsSent")}</strong><span>{text(locale, "sentFields")}</span></article><article className="safe"><strong>⊘ {text(locale, "fieldsNotSent")}</strong><span>{text(locale, "notSentFields")}</span></article></div>
    </div>
    <label className="consent-row"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>{text(locale, "consentLabel")}</span></label>
    <div className="action-row"><button className="primary-action" type="button" disabled={!isDesktop || !approved || busy || preview.uniquePackages === 0} onClick={() => void onScan()}>{busy ? text(locale, "scanningAdvisories") : text(locale, "runOnlineLookup")}</button><small>{isDesktop ? text(locale, "cacheValid24h") : text(locale, "nativeScanOnly")}</small></div>
    {error ? <p className="inline-error" role="alert">{text(locale, "advisoryFailed")} {error}</p> : null}
    {result ? <div className="advisory-result" aria-live="polite">
      <div className="result-summary"><article><span>{text(locale, "affectedPackages")}</span><strong>{result.affectedPackages}</strong></article><article><span>{text(locale, "vulnerabilities")}</span><strong>{result.vulnerabilityCount}</strong></article><article><span>{text(locale, "scannedAt")}</span><strong>{new Date(result.scannedAt).toLocaleString(locale)}</strong></article></div>
      <small className="cache-note">{text(locale, "cachedResult")} · {text(locale, "cacheValid24h")}</small>
      {result.vulnerabilityCount === 0 ? <p className="clean-result">✓ {text(locale, "noKnownVulnerabilities")}</p> : <div className="finding-list">{result.findings.slice(0, 100).map((finding) => <article key={`${finding.ecosystem}:${finding.name}@${finding.version}:${finding.advisoryId}`}><strong>{finding.advisoryId}</strong><span>{finding.name}@{finding.version}</span><small>{finding.ecosystem} · {finding.componentIds.join(", ")}</small></article>)}</div>}
    </div> : null}
  </section>;
}
