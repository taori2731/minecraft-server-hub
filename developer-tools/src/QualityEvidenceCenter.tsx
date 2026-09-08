import { useEffect, useState } from "react";
import type { Locale } from "./locale";
import { qualityLabels } from "./qualityLocale";
import { loadQualityHistory, recordQualityHistory } from "./qualityHistory";
import type { QualityEvidenceAnalysis } from "./types";

const number = (value: number, locale: Locale, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
const date = (value: string, locale: Locale) => value ? new Date(value).toLocaleString(locale) : "—";
const seconds = (value: number, locale: Locale) => number(value / 1_000, locale, 1);

export function QualityEvidenceCenter({ analysis, locale }: { analysis: QualityEvidenceAnalysis; locale: Locale }) {
  const labels = qualityLabels[locale];
  const [history, setHistory] = useState(loadQualityHistory);
  useEffect(() => { setHistory(recordQualityHistory(analysis)); }, [analysis.generatedAt, analysis.sourceDigest, analysis.status]);
  const statusLabel = labels[analysis.status];
  const statusTone = analysis.status === "current" ? analysis.coverageViolations.length > 0 ? "warning" : "pass"
    : ["failed", "invalid"].includes(analysis.status) ? "fail" : "warning";
  const coverage = [
    { id: "lines", label: labels.lines, metric: analysis.coverage.lines, threshold: analysis.coverageThresholds.lines },
    { id: "statements", label: labels.statements, metric: analysis.coverage.statements, threshold: analysis.coverageThresholds.statements },
    { id: "functions", label: labels.functions, metric: analysis.coverage.functions, threshold: analysis.coverageThresholds.functions },
    { id: "branches", label: labels.branches, metric: analysis.coverage.branches, threshold: analysis.coverageThresholds.branches },
  ];
  return <section className="panel quality-center" aria-labelledby="quality-center-title">
    <div className="panel-heading"><div><span className="kicker">VERIFIED QUALITY · D25</span><h2 id="quality-center-title">{labels.title}</h2><p>{labels.intro}</p></div><span className={`dependency-mode ${statusTone}`}>{statusLabel}</span></div>
    {analysis.status !== "current" ? <div className={`quality-notice ${statusTone}`}><div><strong>{labels.runRequired}</strong><span>{labels.commandHint}</span></div><code>npm run quality:verify</code></div> : null}
    {analysis.status === "current" && analysis.coverageViolations.length > 0 ? <div className="quality-notice warning"><strong>{labels.coverageGaps}</strong><span>{analysis.coverageViolations.map((item) => `${item.id} ${number(item.actual, locale, 1)}% / ${number(item.threshold, locale)}%`).join(" · ")}</span></div> : null}
    <div className="quality-stats">
      <article><span>{labels.stages}</span><strong>{analysis.summary.passedStages} / {analysis.summary.totalStages}</strong><small className={analysis.summary.failedStages > 0 ? "fail" : "pass"}>{analysis.summary.failedStages > 0 ? `${analysis.summary.failedStages} ${labels.failedLabel}` : labels.passed}</small></article>
      <article><span>{labels.tests}</span><strong>{number(analysis.summary.passedTests, locale)} / {number(analysis.summary.totalTests, locale)}</strong><small>{analysis.summary.skippedTests} {labels.skipped}</small></article>
      <article><span>{labels.duration}</span><strong>{seconds(analysis.durationMs, locale)} {labels.seconds}</strong><small>{date(analysis.completedAt, locale)}</small></article>
      <article><span>{labels.lineCoverage}</span><strong>{analysis.coverage.available ? `${number(analysis.coverage.lines.pct, locale, 1)}%` : "—"}</strong><small>{labels.target}: {analysis.coverageThresholds.lines}%</small></article>
      <article><span>{labels.sourceIntegrity}</span><strong className={analysis.sourceStable ? "pass" : "fail"}>{analysis.sourceStable ? labels.verified : labels.changed}</strong><small><code>{analysis.sourceDigest ? analysis.sourceDigest.slice(0, 12) : "—"}</code></small></article>
    </div>
    <div className="quality-columns">
      <section className="quality-card"><div className="subsection-heading"><div><span className="kicker">COVERAGE TARGETS</span><h3>{labels.coverage}</h3></div></div>{analysis.coverage.available ? <div className="coverage-list">{coverage.map((item) => <article className={item.metric.pct >= item.threshold ? "pass" : "warning"} key={item.id}><div><strong>{item.label}</strong><span>{number(item.metric.covered, locale)} / {number(item.metric.total, locale)}</span></div><div className="coverage-meter" role="progressbar" aria-label={item.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.metric.pct}><i style={{ width: `${Math.min(100, item.metric.pct)}%` }} /></div><small>{number(item.metric.pct, locale, 1)}% · {labels.target} {item.threshold}%{item.metric.pct < item.threshold ? ` · ${labels.gap} ${number(item.threshold - item.metric.pct, locale, 1)}%` : ""}</small></article>)}</div> : <p>{labels.coverageUnavailable}</p>}</section>
      <section className="quality-card"><div className="subsection-heading"><div><span className="kicker">EVIDENCE INTEGRITY</span><h3>{labels.freshness}</h3></div></div><dl className="quality-details"><div><dt>{labels.generated}</dt><dd>{date(analysis.generatedAt, locale)}</dd></div><div><dt>{labels.newestSource}</dt><dd>{date(analysis.sourceNewestAt, locale)}</dd></div><div><dt>{labels.sourceStable}</dt><dd className={analysis.sourceStable ? "pass" : "fail"}>{analysis.sourceStable ? labels.verified : labels.changed}</dd></div><div><dt>{labels.digest}</dt><dd><code>{analysis.sourceDigest || "—"}</code></dd></div><div><dt>{labels.report}</dt><dd><code>{analysis.reportPath}</code></dd></div></dl></section>
    </div>
    <section className="quality-card quality-stage-card"><div className="subsection-heading"><div><span className="kicker">LOCAL COMMAND EVIDENCE</span><h3>{labels.stageEvidence}</h3></div></div><div className="quality-stage-list">{analysis.stages.map((stage) => <article className={stage.status} key={stage.id}><span className="stage-status" aria-hidden="true">{stage.status === "pass" ? "✓" : "×"}</span><div><strong>{labels.stageNames[stage.id] ?? stage.id}</strong><code>{stage.command}</code><small>{seconds(stage.durationMs, locale)} {labels.seconds} · {stage.tests.total > 0 ? `${stage.tests.passed}/${stage.tests.total} ${labels.tests}${stage.tests.skipped > 0 ? ` · ${stage.tests.skipped} ${labels.skipped}` : ""}` : labels.noTests}</small>{stage.status === "fail" && stage.outputTail ? <details><summary>{labels.output}</summary><pre>{stage.outputTail}</pre></details> : null}</div></article>)}</div></section>
    <section className="quality-card quality-history-card"><div className="subsection-heading"><div><span className="kicker">LOCAL TREND · V1</span><h3>{labels.history}</h3><p>{labels.historyIntro}</p></div></div>{history.length > 0 ? <div className="quality-history-list">{history.map((item) => <article key={item.generatedAt}><time>{date(item.generatedAt, locale)}</time><strong>{item.passedStages}/{item.totalStages} · {item.passedTests}/{item.totalTests}</strong><span>{labels.lines} {number(item.lines, locale, 1)}% · {labels.branches} {number(item.branches, locale, 1)}%</span><small>{seconds(item.durationMs, locale)} {labels.seconds} · <code>{item.sourceDigest.slice(0, 8)}</code></small></article>)}</div> : <p>{labels.noHistory}</p>}</section>
  </section>;
}
