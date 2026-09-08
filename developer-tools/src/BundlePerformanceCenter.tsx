import { useState } from "react";
import { readBundleBaseline, saveBundleBaseline } from "./bundlePerformance";
import { bundleText } from "./bundleLocale";
import type { Locale } from "./locale";
import type { BundleAnalysis } from "./types";

const bytes = (value: number, locale: Locale) => new Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte", unitDisplay: "short", maximumFractionDigits: 1 }).format(value / 1024);
const signedDelta = (value: number, baseline: number, locale: Locale, labels: ReturnType<typeof bundleText>) => {
  const delta = value - baseline;
  if (delta === 0) return labels.unchanged;
  return `${delta < 0 ? "−" : "+"}${bytes(Math.abs(delta), locale)} · ${delta < 0 ? labels.improved : labels.increased}`;
};

export function BundlePerformanceCenter({ analysis, locale }: { analysis: BundleAnalysis; locale: Locale }) {
  const labels = bundleText(locale);
  const [baseline, setBaseline] = useState(readBundleBaseline);
  const [saved, setSaved] = useState(false);
  const entry = analysis.chunks.find((chunk) => chunk.entry);
  const largest = analysis.chunks[0];
  const statusLabel = labels[analysis.status];
  const statusTone = analysis.status === "current" && analysis.violations.length === 0 ? "pass" : analysis.status === "invalid" ? "fail" : "warning";
  const store = () => { const next = saveBundleBaseline(analysis); if (next) { setBaseline(next); setSaved(true); } };
  return <section className="panel bundle-center" aria-labelledby="bundle-center-title">
    <div className="panel-heading"><div><span className="kicker">PERFORMANCE BUDGET · D5</span><h2 id="bundle-center-title">{labels.title}</h2><p>{labels.intro}</p></div><span className={`dependency-mode ${statusTone}`}>{statusLabel}</span></div>
    {analysis.status !== "current" ? <div className="bundle-notice warning">{labels.buildRequired}<code>{analysis.reportPath}</code></div> : null}
    <div className="bundle-stats">
      <article><span>{labels.entry}</span><strong>{entry ? bytes(entry.rawBytes, locale) : "—"}</strong><small>{labels.budget}: {bytes(analysis.budgets.entryJavaScriptBytes, locale)}</small></article>
      <article><span>{labels.largest}</span><strong>{largest ? bytes(largest.rawBytes, locale) : "—"}</strong><small>{largest?.fileName ?? "—"}</small></article>
      <article><span>{labels.totalGzip}</span><strong>{bytes(analysis.totals.totalJavaScriptGzipBytes, locale)}</strong><small>{labels.budget}: {bytes(analysis.budgets.totalJavaScriptGzipBytes, locale)}</small></article>
      <article><span>{labels.css}</span><strong>{bytes(analysis.totals.totalCssBytes, locale)}</strong><small>{labels.budget}: {bytes(analysis.budgets.totalCssBytes, locale)}</small></article>
      <article><span>{labels.chunks}</span><strong>{analysis.totals.chunks}</strong><small>{analysis.violations.length === 0 ? labels.within : `${analysis.violations.length} · ${labels.exceeded}`}</small></article>
    </div>
    <div className="bundle-columns">
      <section className="bundle-card"><div className="subsection-heading"><div><span className="kicker">CHUNKS</span><h3>{labels.inventory}</h3></div></div>{analysis.chunks.length === 0 ? <p>{labels.noChunks}</p> : <div className="bundle-chunk-list">{analysis.chunks.slice(0, 10).map((chunk) => <article key={chunk.fileName}><span className={chunk.entry ? "entry" : "lazy"}>{chunk.entry ? labels.entryChunk : labels.lazyChunk}</span><code>{chunk.fileName}</code><strong>{bytes(chunk.rawBytes, locale)}</strong><small>{labels.gzip} {bytes(chunk.gzipBytes, locale)}</small></article>)}</div>}</section>
      <section className="bundle-card"><div className="subsection-heading"><div><span className="kicker">SOURCE WEIGHT</span><h3>{labels.contributors}</h3></div></div><div className="bundle-module-list">{largest?.largestModules.slice(0, 10).map((module) => <article key={module.id}><code>{module.id}</code><strong>{bytes(module.renderedBytes, locale)}</strong></article>)}</div></section>
    </div>
    <div className="bundle-columns">
      <section className="bundle-card baseline-card"><div><span className="kicker">LOCAL ONLY</span><h3>{labels.baseline}</h3></div>{baseline && entry ? <dl><div><dt>{labels.delta} · {labels.entry}</dt><dd>{signedDelta(entry.rawBytes, baseline.entryBytes, locale, labels)}</dd></div><div><dt>{labels.delta} · {labels.totalGzip}</dt><dd>{signedDelta(analysis.totals.totalJavaScriptGzipBytes, baseline.totalGzipBytes, locale, labels)}</dd></div></dl> : <p>{labels.noBaseline}</p>}<button type="button" disabled={analysis.status !== "current" || !entry} onClick={store}>{labels.saveBaseline}</button>{saved ? <small role="status">✓ {labels.baselineSaved}</small> : null}</section>
      <aside className="bundle-card guidance-card"><span className="kicker">ACTIONABLE</span><h3>{labels.suggestion}</h3><p>{labels.suggestionText}</p><dl><div><dt>{labels.generated}</dt><dd>{analysis.generatedAt ? new Date(analysis.generatedAt).toLocaleString(locale) : "—"}</dd></div><div><dt>{labels.sourceChanged}</dt><dd>{analysis.sourceNewestAt ? new Date(analysis.sourceNewestAt).toLocaleString(locale) : "—"}</dd></div><div><dt>{labels.report}</dt><dd><code>{analysis.reportPath}</code></dd></div></dl></aside>
    </div>
  </section>;
}
