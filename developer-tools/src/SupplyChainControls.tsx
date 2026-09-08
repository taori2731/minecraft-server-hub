import { text, type Locale } from "./locale";
import type { LicensePolicy, LicensePolicyAction } from "./types";
import type { SupplyChainExportFormat } from "./supplyChain";
import { windowsEvidenceText } from "./windowsEvidenceLocale";
import { licenseAuditText } from "./licenseAuditLocale";

const actions: LicensePolicyAction[] = ["allow", "warn", "block"];

function PolicySelect({ label, value, locale, allow, onChange }: { label: string; value: LicensePolicyAction; locale: Locale; allow: boolean; onChange: (value: LicensePolicyAction) => void }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value as LicensePolicyAction)}>{actions.filter((action) => allow || action !== "allow").map((action) => <option value={action} key={action}>{text(locale, action === "allow" ? "policyAllow" : action === "warn" ? "policyWarn" : "policyBlock")}</option>)}</select></label>;
}

export function SupplyChainControls({ locale, policy, onPolicyChange, onExport, exporting, message, evidenceReady, isDesktop, onVerify, verificationBusy, verificationMessage }: {
  locale: Locale;
  policy: LicensePolicy;
  onPolicyChange: (policy: LicensePolicy) => void;
  onExport: (format: SupplyChainExportFormat) => Promise<void>;
  exporting: boolean;
  message: string;
  evidenceReady: boolean;
  isDesktop: boolean;
  onVerify: () => Promise<void>;
  verificationBusy: boolean;
  verificationMessage: string;
}) {
  const evidenceCopy = windowsEvidenceText(locale);
  const auditCopy = licenseAuditText(locale);
  return <div className="supply-controls-grid">
    <section className="supply-subsection policy-card" aria-labelledby="policy-title"><span className="kicker">LOCAL POLICY</span><h3 id="policy-title">{text(locale, "licensePolicy")}</h3><p className="section-copy">{text(locale, "policyIntro")}</p><div className="policy-grid">
      <PolicySelect label={text(locale, "policyUnknown")} value={policy.unknown} locale={locale} allow onChange={(unknown) => onPolicyChange({ ...policy, unknown })} />
      <PolicySelect label={text(locale, "policyReciprocal")} value={policy.reciprocal} locale={locale} allow onChange={(reciprocal) => onPolicyChange({ ...policy, reciprocal })} />
      <PolicySelect label={text(locale, "policyVulnerabilities")} value={policy.vulnerabilities} locale={locale} allow={false} onChange={(vulnerabilities) => onPolicyChange({ ...policy, vulnerabilities: vulnerabilities as LicensePolicy["vulnerabilities"] })} />
    </div></section>
    <section className="supply-subsection export-card" aria-labelledby="exports-title"><span className="kicker">SBOM · AUDIT</span><h3 id="exports-title">{text(locale, "exports")}</h3><p className="section-copy">{text(locale, "exportsIntro")}</p><div className="export-actions"><button type="button" disabled={exporting} onClick={() => void onExport("cyclonedx")}>{text(locale, "exportCycloneDx")}</button><button type="button" disabled={exporting} onClick={() => void onExport("spdx")}>{text(locale, "exportSpdx")}</button><button type="button" disabled={exporting} onClick={() => void onExport("csv")}>{text(locale, "exportCsv")}</button><button type="button" disabled={exporting || !evidenceReady} onClick={() => void onExport("windowsEvidence")}>{evidenceCopy.exportButton}</button><button type="button" disabled={exporting || !evidenceReady} onClick={() => void onExport("notices")}>{auditCopy.notices}</button><button type="button" disabled={!isDesktop || verificationBusy} onClick={() => void onVerify()}>{verificationBusy ? auditCopy.verifying : auditCopy.verify}</button></div><p className={`evidence-export-note ${evidenceReady ? "ready" : "waiting"}`}>{evidenceReady ? auditCopy.noticesReady : auditCopy.noticesUnavailable}</p>{message ? <p className="export-message" aria-live="polite">{message}</p> : null}{verificationMessage ? <p className="verification-message" aria-live="polite">{verificationMessage}</p> : null}</section>
  </div>;
}
