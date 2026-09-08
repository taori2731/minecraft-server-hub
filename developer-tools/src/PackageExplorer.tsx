import { useDeferredValue, useMemo, useState } from "react";
import { text, type Catalog, type Locale } from "./locale";
import type { DependencyPackageSummary } from "./types";

const PAGE_SIZE = 60;

export function PackageExplorer({ packages, locale }: { packages: DependencyPackageSummary[]; locale: Locale }) {
  const [query, setQuery] = useState("");
  const [component, setComponent] = useState("all");
  const [ecosystem, setEcosystem] = useState("all");
  const [scope, setScope] = useState<"all" | "direct" | "review">("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(locale));
  const components = useMemo(() => [...new Set(packages.map((item) => item.componentId))].sort(), [packages]);
  const filtered = useMemo(() => packages.filter((item) => {
    if (component !== "all" && item.componentId !== component) return false;
    if (ecosystem !== "all" && item.ecosystem !== ecosystem) return false;
    if (scope === "direct" && !item.direct) return false;
    if (scope === "review" && !item.reason) return false;
    if (!deferredQuery) return true;
    return [item.name, item.version, item.license, item.componentId, item.reason].some((value) => value.toLocaleLowerCase(locale).includes(deferredQuery));
  }), [component, deferredQuery, ecosystem, locale, packages, scope]);
  const shown = filtered.slice(0, visible);
  const resultLabel = text(locale, "packageResults").replace("{shown}", String(shown.length)).replace("{total}", String(filtered.length));

  const resetLimit = () => setVisible(PAGE_SIZE);
  return <section className="supply-subsection package-explorer" aria-labelledby="package-explorer-title">
    <div className="subsection-heading"><div><span className="kicker">FULL INVENTORY</span><h3 id="package-explorer-title">{text(locale, "packageExplorer")}</h3></div><small aria-live="polite">{resultLabel}</small></div>
    <div className="package-filters">
      <label className="search-field"><span className="sr-only">{text(locale, "searchPackages")}</span><input type="search" value={query} placeholder={text(locale, "searchPackages")} onChange={(event) => { setQuery(event.target.value); resetLimit(); }} /></label>
      <label><span className="sr-only">{text(locale, "allComponents")}</span><select value={component} onChange={(event) => { setComponent(event.target.value); resetLimit(); }}><option value="all">{text(locale, "allComponents")}</option>{components.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
      <label><span className="sr-only">{text(locale, "allEcosystems")}</span><select value={ecosystem} onChange={(event) => { setEcosystem(event.target.value); resetLimit(); }}><option value="all">{text(locale, "allEcosystems")}</option><option value="npm">npm</option><option value="cargo">crates.io</option></select></label>
      <label><span className="sr-only">{text(locale, "allScopes")}</span><select value={scope} onChange={(event) => { setScope(event.target.value as typeof scope); resetLimit(); }}><option value="all">{text(locale, "scopeAll")}</option><option value="direct">{text(locale, "scopeDirect")}</option><option value="review">{text(locale, "scopeReview")}</option></select></label>
    </div>
    <div className="package-table" role="table" aria-label={text(locale, "packageExplorer")}>
      {shown.map((item, index) => <article role="row" key={`${item.componentId}:${item.ecosystem}:${item.name}@${item.version}:${index}`} className={item.reason ? "warning" : ""}>
        <span className={`ecosystem ${item.ecosystem}`}>{item.ecosystem}</span>
        <div><strong>{item.name}</strong><small>{item.componentId}</small></div>
        <code>{item.version}</code><span>{item.license || text(locale, "unknown")}</span>
        <span className="scope-chip">{item.direct ? text(locale, "direct") : text(locale, "transitive")}</span>
      </article>)}
      {shown.length === 0 ? <p className="empty-state">{text(locale, "noPackageMatches")}</p> : null}
    </div>
    {shown.length < filtered.length ? <button className="secondary-action show-more" type="button" onClick={() => setVisible((value) => value + PAGE_SIZE)}>{text(locale, "showMore")}</button> : null}
  </section>;
}

