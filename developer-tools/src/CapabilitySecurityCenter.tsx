import { capabilitySecurityText } from "./capabilitySecurityLocale";
import type { Locale } from "./locale";
import type { CapabilitySecurityAudit } from "./types";

export function CapabilitySecurityCenter({ audit, locale }: { audit: CapabilitySecurityAudit; locale: Locale }) {
  const labels = capabilitySecurityText(locale);
  const status = labels[audit.status];
  return <section className="panel capability-security-center" aria-labelledby="capability-security-title">
    <div className="panel-heading"><div><span className="kicker">D26 · LEAST PRIVILEGE</span><h2 id="capability-security-title">{labels.title}</h2><p>{labels.intro}</p></div><span className={`dependency-mode ${audit.status === "verified" ? "pass" : "fail"}`}>{audit.status === "verified" ? "✓" : "×"} {status}</span></div>
    <div className="capability-security-stats"><article><span>{labels.permissions}</span><strong>{audit.permissions.length}</strong></article><article><span>{labels.capabilityWindows}</span><strong>{audit.windows.length}</strong></article><article><span>{labels.configuredWindows}</span><strong>{audit.configuredWindows.length}</strong></article><article><span>{labels.directives}</span><strong>{audit.cspDirectives.length}</strong></article></div>
    <div className="capability-security-grid">
      <article><h3>{labels.permissions}</h3><ul>{audit.permissions.map((permission) => <li key={permission}><code>{permission}</code><span>✓ {labels.allowed}</span></li>)}</ul></article>
      <article><h3>{labels.directives}</h3><ul>{audit.cspDirectives.map((directive) => <li key={directive.name}><code>{directive.name}</code><small>{directive.values.join(" ")}</small></li>)}</ul></article>
      <article><h3>{labels.identities}</h3><dl><div><dt>{labels.capabilityId}</dt><dd><code>{audit.capabilityIdentifier || "—"}</code></dd></div><div><dt>{labels.appId}</dt><dd><code>{audit.appIdentifier || "—"}</code></dd></div></dl></article>
      <article><h3>{labels.sourceFiles}</h3><code>{audit.capabilityPath}</code><code>{audit.configurationPath}</code></article>
    </div>
    <aside className={audit.issues.length ? "capability-issues fail" : "capability-issues pass"}><strong>{audit.issues.length ? labels.issues : labels.noIssues}</strong>{audit.issues.length ? <ul>{audit.issues.map((issue) => <li key={issue}><code>{issue}</code></li>)}</ul> : null}<small>{labels.readOnly}</small></aside>
  </section>;
}
