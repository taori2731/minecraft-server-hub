import type { AdvisoryScanResult, DependencyInventory, DeveloperCheck, LicenseEvidenceReport, LicenseReviewState } from "./types";
import type { Locale } from "./locale";
import { buildSupplyChainReadiness } from "./supplyChainReadiness";
import { supplyChainReadinessText } from "./supplyChainReadinessLocale";

export function SupplyChainReadinessCenter({ inventory, checks, review, evidence, advisory, locale }: {
  inventory: DependencyInventory;
  checks: DeveloperCheck[];
  review: LicenseReviewState;
  evidence?: LicenseEvidenceReport;
  advisory?: AdvisoryScanResult;
  locale: Locale;
}) {
  const labels = supplyChainReadinessText(locale);
  const readiness = buildSupplyChainReadiness(inventory, checks, review, evidence, advisory);
  const headline = readiness.status === "pass" ? labels.ready : readiness.status === "fail" ? labels.blocked : labels.review;
  return <section className={`supply-chain-readiness ${readiness.status}`} aria-labelledby="supply-chain-readiness-title">
    <header>
      <div><span className="kicker">D29 · RELEASE REVIEW</span><h3 id="supply-chain-readiness-title">{labels.title}</h3><p>{labels.intro}</p></div>
      <span className={`readiness-verdict ${readiness.status}`}>{readiness.status === "pass" ? "✓" : readiness.status === "fail" ? "×" : "!"} {headline}</span>
    </header>
    <div className="readiness-summary"><article className={readiness.blockers ? "fail" : "pass"}><span>{labels.blockers}</span><strong>{readiness.blockers}</strong></article><article className={readiness.warnings ? "warning" : "pass"}><span>{labels.warnings}</span><strong>{readiness.warnings}</strong></article><article><span>{labels.digest}</span><code>{readiness.inventoryDigest.slice(0, 16)}…</code></article></div>
    <ol className="readiness-stages">
      {readiness.stages.map((stage, index) => <li key={stage.id} className={stage.status}>
        <div className="readiness-stage-index">{index + 1}</div>
        <div className="readiness-stage-copy"><span>{labels.status[stage.status]}</span><strong>{labels.stageTitles[stage.id]}</strong><small>{labels.stageDetails[stage.id]}</small></div>
        <dl><div><dt>{labels.primaryLabels[stage.id]}</dt><dd>{stage.primary}</dd></div><div><dt>{labels.secondaryLabels[stage.id]}</dt><dd>{stage.secondary}</dd></div></dl>
        <a href={stage.target} aria-label={`${labels.open}: ${labels.stageTitles[stage.id]}`}>{labels.open}<span aria-hidden="true">→</span></a>
      </li>)}
    </ol>
    <p className="readiness-privacy">⊘ {labels.privacy}</p>
  </section>;
}
