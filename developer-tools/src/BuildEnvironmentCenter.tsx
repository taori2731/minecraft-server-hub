import { buildEnvironmentText } from "./buildEnvironmentLocale";
import type { Locale } from "./locale";
import type { BuildEnvironmentAudit } from "./types";

export function BuildEnvironmentCenter({ audit, locale }: { audit: BuildEnvironmentAudit; locale: Locale }) {
  const labels = buildEnvironmentText(locale);
  const statusLabel = labels[audit.status];
  return <section className="panel build-environment-center" aria-labelledby="build-environment-title">
    <div className="panel-heading"><div><span className="kicker">D27 · LOCAL TOOLCHAIN</span><h2 id="build-environment-title">{labels.title}</h2><p>{labels.intro}</p></div><span className={`dependency-mode ${audit.status === "ready" ? "pass" : "fail"}`}>{audit.status === "ready" ? "✓" : "×"} {statusLabel}</span></div>
    <div className="build-environment-host"><article><span>{labels.host}</span><strong>{audit.hostOs} / {audit.hostArch}</strong></article><article><span>{labels.expected}</span><strong>{audit.expectedOs} / {audit.expectedArch}</strong></article><article><span>{labels.rustTarget}</span><strong>{audit.rustTarget}</strong><small className={audit.rustTargetInstalled ? "pass-text" : "fail-text"}>{audit.rustTargetInstalled ? labels.installed : labels.missing}</small></article></div>
    <div className="build-tool-grid" aria-label={labels.tools}>{audit.tools.map((tool) => <article className={tool.available ? "pass" : "fail"} key={tool.id}><header><strong>{tool.id}</strong><span>{tool.available ? `✓ ${labels.available}` : `× ${labels.unavailable}`}</span></header><dl><div><dt>{labels.version}</dt><dd><code>{tool.version || "—"}</code></dd></div><div><dt>Command</dt><dd><code>{tool.command}</code></dd></div></dl>{tool.error ? <small>{tool.error}</small> : null}</article>)}</div>
    <aside className={audit.issues.length ? "build-environment-issues fail" : "build-environment-issues pass"}><strong>{audit.issues.length ? labels.issues : labels.noIssues}</strong>{audit.issues.length ? <ul>{audit.issues.map((issue) => <li key={issue}><code>{issue}</code></li>)}</ul> : null}<small>{labels.privacy}</small></aside>
  </section>;
}
