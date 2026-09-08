import { useMemo, useState } from "react";
import type { AdvisoryScanResult, DependencyInventory } from "./types";
import type { Locale } from "./locale";
import { developerBackend } from "./developerBackend";
import {
  buildSupplyChainSnapshot,
  compareSupplyChainSnapshots,
  createSupplyChainDiffExport,
  readSupplyChainSnapshots,
  removeSupplyChainSnapshot,
  saveSupplyChainSnapshot,
  type SupplyChainChangeKind,
  type SupplyChainDiffEntry,
} from "./supplyChainDiff";
import { supplyChainDiffText } from "./supplyChainDiffLocale";

type DiffFilter = "all" | SupplyChainChangeKind;
const filters: DiffFilter[] = ["all", "risk-regression", "updated", "added", "removed", "license", "risk-improvement"];

function displayVersion(entry: SupplyChainDiffEntry) {
  if (entry.beforeVersion && entry.afterVersion && entry.beforeVersion !== entry.afterVersion) return `${entry.beforeVersion} → ${entry.afterVersion}`;
  return entry.afterVersion || entry.beforeVersion || "—";
}

export function SupplyChainDiffCenter({ inventory, advisory, locale }: { inventory: DependencyInventory; advisory?: AdvisoryScanResult; locale: Locale }) {
  const t = supplyChainDiffText(locale);
  const current = useMemo(() => buildSupplyChainSnapshot(inventory, advisory), [inventory, advisory]);
  const [snapshots, setSnapshots] = useState(readSupplyChainSnapshots);
  const [selectedAt, setSelectedAt] = useState(() => snapshots[0]?.createdAt ?? "");
  const [filter, setFilter] = useState<DiffFilter>("all");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const baseline = snapshots.find((item) => item.createdAt === selectedAt) ?? snapshots[0];
  const diff = useMemo(() => baseline ? compareSupplyChainSnapshots(baseline, current) : undefined, [baseline, current]);
  const entries = useMemo(() => {
    if (!diff) return [];
    const groups: Record<SupplyChainChangeKind, SupplyChainDiffEntry[]> = { added: diff.added, removed: diff.removed, updated: diff.updated, license: diff.licenseChanges, "risk-regression": diff.riskRegressions, "risk-improvement": diff.riskImprovements };
    return filter === "all" ? filters.slice(1).flatMap((kind) => groups[kind as SupplyChainChangeKind]) : groups[filter];
  }, [diff, filter]);
  const count = (kind: DiffFilter) => {
    if (!diff) return 0;
    if (kind === "all") return diff.summary.added + diff.summary.removed + diff.summary.updated + diff.summary.licenseChanges + diff.summary.riskRegressions + diff.summary.riskImprovements;
    return kind === "license" ? diff.summary.licenseChanges : kind === "risk-regression" ? diff.summary.riskRegressions : kind === "risk-improvement" ? diff.summary.riskImprovements : diff.summary[kind];
  };
  const saveCurrent = () => {
    const next = saveSupplyChainSnapshot(current, snapshots);
    setSnapshots(next); setSelectedAt(current.createdAt); setMessage(t.saved);
  };
  const removeCurrentBaseline = () => {
    if (!baseline || !window.confirm(`${t.remove}?`)) return;
    const next = removeSupplyChainSnapshot(baseline.createdAt, snapshots);
    setSnapshots(next); setSelectedAt(next[0]?.createdAt ?? ""); setMessage("");
  };
  const exportDiff = async () => {
    if (!diff) return;
    setBusy(true); setMessage("");
    try {
      const artifact = createSupplyChainDiffExport(diff);
      const path = await developerBackend.exportSupplyChainReport(artifact.filename, artifact.mime, artifact.content);
      setMessage(path ? t.exported.replace("{path}", path) : t.canceled);
    } catch (reason) {
      setMessage(`${t.failed} ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally { setBusy(false); }
  };
  return <section className="supply-chain-diff" aria-labelledby="supply-chain-diff-title">
    <header>
      <div><span className="kicker">D29 · LOCAL DIFF HISTORY</span><h3 id="supply-chain-diff-title">{t.title}</h3><p>{t.intro}</p></div>
      <button type="button" onClick={saveCurrent}>{t.saveBaseline}</button>
    </header>
    <p className="supply-chain-diff-privacy">⊘ {t.privacy}</p>
    {!current.advisoryChecked ? <p className="supply-chain-diff-advisory">! {t.advisoryPending}</p> : null}
    {baseline && diff ? <>
      <div className="supply-chain-diff-selection">
        <label><span>{t.baseline}</span><select aria-label={t.baseline} value={baseline.createdAt} onChange={(event) => setSelectedAt(event.target.value)}>{snapshots.map((item) => <option value={item.createdAt} key={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale)} · {item.inventoryDigest.slice(0, 12)}…</option>)}</select></label>
        <dl><div><dt>{t.createdAt}</dt><dd>{new Date(baseline.createdAt).toLocaleString(locale)}</dd></div><div><dt>{t.packages}</dt><dd>{baseline.summary.packages} → {current.summary.packages}</dd></div><div><dt>Digest</dt><dd><code>{baseline.inventoryDigest.slice(0, 10)}… → {current.inventoryDigest.slice(0, 10)}…</code></dd></div></dl>
        <button type="button" className="danger-quiet" onClick={removeCurrentBaseline}>{t.remove}</button>
      </div>
      <div className="supply-chain-diff-filters" role="group" aria-label={t.changes}>{filters.map((kind) => <button type="button" className={`${filter === kind ? "active" : ""}${kind === "risk-regression" && count(kind) > 0 ? " danger" : ""}`} onClick={() => setFilter(kind)} key={kind}><span>{kind === "all" ? t.all : t.categories[kind]}</span><strong>{count(kind)}</strong></button>)}</div>
      <div className="supply-chain-diff-list" role="list">{entries.slice(0, 100).map((entry, index) => <article role="listitem" className={entry.kind} key={`${entry.kind}:${entry.ecosystem}:${entry.name}:${entry.beforeVersion}:${entry.afterVersion}:${index}`}><span className={`ecosystem ${entry.ecosystem}`}>{entry.ecosystem}</span><div><strong>{entry.name}</strong><small>{entry.reasons.map((reason) => t.reasons[reason] ?? reason).join(" · ")}</small></div><code>{displayVersion(entry)}</code><em>{t.categories[entry.kind]}</em></article>)}{entries.length === 0 ? <p>{t.noChanges}</p> : null}</div>
      <div className="supply-chain-diff-actions"><button type="button" onClick={() => void exportDiff()} disabled={busy}>{busy ? t.exporting : t.export}</button>{message ? <span role="status">{message}</span> : null}</div>
    </> : <div className="supply-chain-diff-empty"><strong>{t.noBaseline}</strong><p>{t.noBaselineHint}</p>{message ? <span role="status">{message}</span> : null}</div>}
  </section>;
}
