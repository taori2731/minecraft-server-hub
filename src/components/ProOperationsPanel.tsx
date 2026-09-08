import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import type { AccentTheme, AppearanceSettings, AuditEntry, IconScale, ModpackProfile, MonitoringSettings, RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { defaultAppearance, normalizeHexColor, readAppearance, storeAppearance } from "../lib/appearance";
import { useI18n } from "../lib/i18n";

type BulkAction = "start" | "stop" | "restart";

const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

async function waitForBulkResult(serverId: string, action: BulkAction): Promise<RuntimeStatus> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const status = await backend.status(serverId);
    if (action === "stop" && status.state === "stopped") return status;
    if (action !== "stop" && status.state === "running") return status;
    if (status.state === "crashed") throw new Error("起動中に異常終了しました。サーバー診断を確認してください");
    if (action !== "stop" && status.state === "stopped") throw new Error("起動処理が完了する前に停止しました。サーバー診断を確認してください");
    await delay(500);
  }
  throw new Error(action === "stop" ? "安全停止の完了を確認できませんでした" : "120秒以内に起動完了を確認できませんでした");
}

const monitoringKey = "server-hub:monitoring:v1";

export const defaultMonitoring: MonitoringSettings = {
  enabled: true,
  cpuWarningPercent: 85,
  memoryWarningPercent: 90,
  minimumTps: 18,
  notifyOnCrash: true,
};

export function readMonitoring(): MonitoringSettings {
  try {
    const value = JSON.parse(localStorage.getItem(monitoringKey) ?? "null") as Partial<MonitoringSettings> | null;
    return {
      enabled: value?.enabled ?? defaultMonitoring.enabled,
      cpuWarningPercent: clamp(value?.cpuWarningPercent, 50, 100, defaultMonitoring.cpuWarningPercent),
      memoryWarningPercent: clamp(value?.memoryWarningPercent, 50, 100, defaultMonitoring.memoryWarningPercent),
      minimumTps: clamp(value?.minimumTps, 5, 20, defaultMonitoring.minimumTps),
      notifyOnCrash: value?.notifyOnCrash ?? defaultMonitoring.notifyOnCrash,
    };
  } catch { return defaultMonitoring; }
}

function clamp(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function statusFor(server: ServerProfile, statuses: Record<string, RuntimeStatus>): RuntimeStatus {
  return statuses[server.id] ?? {
    state: "stopped", playerCount: 0, maxPlayers: server.settings.maxPlayers, memoryUsedMib: 0,
    uptimeSeconds: 0, address: `localhost:${server.port}`, cpuPercent: 0, tps: null,
    tpsSupported: server.serverType === "paper" || server.serverType === "vanilla", pingLatencyMs: null,
  };
}

export function monitoringWarnings(servers: ServerProfile[], statuses: Record<string, RuntimeStatus>, settings: MonitoringSettings) {
  if (!settings.enabled) return [];
  return servers.flatMap((server) => {
    const status = statusFor(server, statuses);
    const values: string[] = [];
    const memoryPercent = server.maxMemoryMib > 0 ? status.memoryUsedMib / server.maxMemoryMib * 100 : 0;
    if (settings.notifyOnCrash && status.state === "crashed") values.push(`${server.name}: サーバーが異常終了しました`);
    if (status.state === "running" && status.cpuPercent >= settings.cpuWarningPercent) values.push(`${server.name}: Java CPU ${status.cpuPercent.toFixed(0)}%`);
    if (status.state === "running" && memoryPercent >= settings.memoryWarningPercent) values.push(`${server.name}: メモリ ${memoryPercent.toFixed(0)}%`);
    if (status.state === "running" && status.tps != null && status.tps < settings.minimumTps) values.push(`${server.name}: TPS ${status.tps.toFixed(1)}`);
    return values;
  });
}

export function ProOperationsPanel({
  servers,
  statuses,
  selectedServerId,
  onStatusesChanged,
  onAppearanceChanged,
  notify,
  fail,
}: {
  servers: ServerProfile[];
  statuses: Record<string, RuntimeStatus>;
  selectedServerId?: string;
  onStatusesChanged: (values: Record<string, RuntimeStatus>) => void;
  onAppearanceChanged: (settings: AppearanceSettings) => void;
  notify: (message: string) => void;
  fail: (message: string) => void;
}) {
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(selectedServerId ? [selectedServerId] : []));
  const [busy, setBusy] = useState("");
  const [bulkResults, setBulkResults] = useState<string[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditQuery, setAuditQuery] = useState("");
  const deferredAuditQuery = useDeferredValue(auditQuery.trim().toLocaleLowerCase("ja"));
  const [profiles, setProfiles] = useState<ModpackProfile[]>([]);
  const [appearance, setAppearance] = useState<AppearanceSettings>(readAppearance);
  const [customAccentDraft, setCustomAccentDraft] = useState(() => readAppearance().customAccent);
  const [monitoring, setMonitoring] = useState<MonitoringSettings>(readMonitoring);

  useEffect(() => {
    let active = true;
    const historyRequests = servers.map((server) => backend.auditLog(server.id).then((items) => items.map((item) => ({ ...item, detail: `${server.name} · ${item.detail}` }))));
    Promise.all([Promise.all(historyRequests), backend.listModpackProfiles()]).then(([history, nextProfiles]) => {
      if (!active) return;
      setAudit(history.flat().sort((left, right) => right.at.localeCompare(left.at)));
      setProfiles(nextProfiles);
    }).catch((reason) => active && fail(String(reason)));
    return () => { active = false; };
  }, [servers, fail]);

  const warnings = useMemo(() => monitoringWarnings(servers, statuses, monitoring), [servers, statuses, monitoring]);
  const filteredAudit = useMemo(() => {
    if (!deferredAuditQuery) return audit;
    return audit.filter((entry) => `${entry.actor} ${entry.action} ${entry.detail}`.toLocaleLowerCase("ja").includes(deferredAuditQuery));
  }, [audit, deferredAuditQuery]);

  const toggleServer = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const runBulk = async (action: BulkAction) => {
    const targets = servers.filter((server) => selectedIds.has(server.id));
    if (targets.length === 0) return;
    const label = action === "start" ? "起動" : action === "stop" ? "安全停止" : "再起動";
    if (!await confirmDanger(`${targets.length}台のサーバーを順番に${label}しますか？\n処理中のサーバーは対象から安全に除外します。`)) return;
    setBusy(action);
    setBulkResults([]);
    const changed: Record<string, RuntimeStatus> = {};
    const results: string[] = [];
    for (const server of targets) {
      const state = statusFor(server, statuses).state;
      const applicable = action === "start" ? state === "stopped" || state === "crashed" : action === "stop" ? state === "running" : state === "running";
      if (!applicable) { results.push(`${server.name}: 状態が${state}のため対象外`); continue; }
      try {
        setBulkResults([...results, `${server.name}: ${label}を確認中…`]);
        if (action === "start") await backend.start(server.id);
        if (action === "stop") await backend.stop(server.id);
        if (action === "restart") await backend.restart(server.id);
        changed[server.id] = await waitForBulkResult(server.id, action);
        results.push(`${server.name}: ${label}完了（${changed[server.id].state}）`);
      } catch (reason) { results.push(`${server.name}: 失敗 - ${String(reason)}`); }
      setBulkResults([...results]);
    }
    onStatusesChanged(changed);
    setBulkResults(results);
    setBusy("");
    notify(`一括${label}を処理しました（${results.filter((value) => value.includes(`${label}完了`)).length}/${targets.length}台）`);
  };

  const saveAppearance = (next: AppearanceSettings) => {
    try {
      storeAppearance(next);
      setAppearance(next);
      setCustomAccentDraft(next.customAccent);
      onAppearanceChanged(next);
    } catch {
      fail(t("appearanceStorageError"));
    }
  };

  const applyCustomAccent = () => {
    const customAccent = normalizeHexColor(customAccentDraft);
    if (!customAccent) {
      fail(t("invalidThemeColor"));
      return;
    }
    saveAppearance({ ...appearance, accent: "custom", customAccent });
    notify(t("customColorApplied"));
  };

  const saveMonitoring = (next: MonitoringSettings) => {
    setMonitoring(next);
    localStorage.setItem(monitoringKey, JSON.stringify(next));
    window.dispatchEvent(new Event("server-hub:monitoring-settings-changed"));
  };

  const runningCount = servers.filter((server) => statusFor(server, statuses).state === "running").length;
  const playerCount = servers.reduce((sum, server) => sum + statusFor(server, statuses).playerCount, 0);

  return <div className="pro-operations">
    <div className="pro-summary-grid">
      <article><span>登録サーバー</span><strong>{servers.length}</strong><small>起動中 {runningCount}台</small></article>
      <article><span>参加中</span><strong>{playerCount}</strong><small>全サーバー合計</small></article>
      <article><span>監視警告</span><strong>{warnings.length}</strong><small>{monitoring.enabled ? "ローカル監視中" : "監視停止中"}</small></article>
      <article><span>保存構成</span><strong>{profiles.length}</strong><small>Modパックプロファイル</small></article>
    </div>

    <section className="pro-card" aria-labelledby="bulk-title"><header><div><span className="section-kicker">FLEET CONTROL</span><h4 id="bulk-title">複数サーバーの一括操作</h4></div><button className="small-button" type="button" onClick={() => setSelectedIds(new Set(selectedIds.size === servers.length ? [] : servers.map((server) => server.id)))}>{selectedIds.size === servers.length ? "選択解除" : "すべて選択"}</button></header>
      <div className="bulk-server-list">{servers.map((server) => { const status = statusFor(server, statuses); return <label key={server.id}><input type="checkbox" checked={selectedIds.has(server.id)} onChange={() => toggleServer(server.id)} /><span><b>{server.name}</b><small>{server.serverType} / {server.minecraftVersion}</small></span><em className={`status-label ${status.state}`}><i />{status.state}</em></label>; })}</div>
      <div className="bulk-actions"><button className="primary-button" disabled={Boolean(busy) || selectedIds.size === 0} onClick={() => runBulk("start")}><Icon name="play" size={17} />一括起動</button><button className="secondary-button" disabled={Boolean(busy) || selectedIds.size === 0} onClick={() => runBulk("stop")}><Icon name="stop" size={17} />一括安全停止</button><button className="secondary-button" disabled={Boolean(busy) || selectedIds.size === 0} onClick={() => runBulk("restart")}><Icon name="refresh" size={17} />一括再起動</button></div>
      {bulkResults.length ? <div className="bulk-results" role="status">{bulkResults.map((result) => <small key={result}>{result}</small>)}</div> : null}
    </section>

    <section className="pro-card" aria-labelledby="monitor-title"><header><div><span className="section-kicker">LOCAL ALERTS</span><h4 id="monitor-title">高度な監視とアプリ内通知</h4></div><label className="switch-label"><input type="checkbox" checked={monitoring.enabled} onChange={(event) => saveMonitoring({ ...monitoring, enabled: event.target.checked })} />監視する</label></header>
      <div className="monitor-settings-grid"><label><span>CPU警告</span><input aria-label="CPU警告しきい値" type="number" min={50} max={100} value={monitoring.cpuWarningPercent} onChange={(event) => saveMonitoring({ ...monitoring, cpuWarningPercent: clamp(Number(event.target.value), 50, 100, 85) })} /><small>%以上</small></label><label><span>メモリ警告</span><input aria-label="メモリ警告しきい値" type="number" min={50} max={100} value={monitoring.memoryWarningPercent} onChange={(event) => saveMonitoring({ ...monitoring, memoryWarningPercent: clamp(Number(event.target.value), 50, 100, 90) })} /><small>%以上</small></label><label><span>TPS警告</span><input aria-label="TPS警告しきい値" type="number" min={5} max={20} step={0.5} value={monitoring.minimumTps} onChange={(event) => saveMonitoring({ ...monitoring, minimumTps: clamp(Number(event.target.value), 5, 20, 18) })} /><small>未満</small></label><label className="crash-alert"><input type="checkbox" checked={monitoring.notifyOnCrash} onChange={(event) => saveMonitoring({ ...monitoring, notifyOnCrash: event.target.checked })} />異常終了を通知</label></div>
      <div className="monitor-alert-list">{warnings.map((warning) => <p key={warning}><Icon name="info" size={16} />{warning}</p>)}{warnings.length === 0 ? <p className="monitor-ok"><Icon name="check" size={16} />現在のしきい値を超えたサーバーはありません</p> : null}</div><p className="privacy-note">監視値と通知設定はこのPC内だけで処理します。外部サービスへ自動送信しません。</p>
    </section>

    <section className="pro-card" aria-labelledby="history-title"><header><div><span className="section-kicker">AUDIT TRAIL</span><h4 id="history-title">長期操作履歴</h4></div><span className="record-count">{filteredAudit.length}件</span></header><input className="audit-search" aria-label="操作履歴を検索" value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="サーバー名・管理者・操作で検索" />
      <div className="audit-list pro-audit-list">{filteredAudit.slice(0, 300).map((entry) => <div key={`${entry.id}-${entry.detail}`}><time>{new Date(entry.at).toLocaleString("ja-JP")}</time><b>{entry.actor}</b><span>{entry.action}</span><small>{entry.detail}</small></div>)}{filteredAudit.length === 0 ? <p>条件に一致する履歴はありません。</p> : null}</div><p className="privacy-note">起動・停止・設定変更などの操作履歴をサーバー別にこのPC内へ保存します。</p>
    </section>

    <section className="pro-card" aria-labelledby="profiles-title"><header><div><span className="section-kicker">MODPACK LIBRARY</span><h4 id="profiles-title">Modパック構成の保存・共有</h4></div><span className="record-count">{profiles.length}件</span></header>{profiles.length ? <div className="pro-profile-list">{profiles.slice(0, 6).map((profile) => <article key={profile.id}><b>{profile.name}</b><small>{profile.minecraftVersion} · {profile.loader}</small><span>Mod {profile.mods.length} / Plugin {profile.plugins.length} / Datapack {profile.datapacks.length}</span></article>)}</div> : <div className="panel-empty compact"><p>安全ツールから現在のMod構成を保存すると、ここへ表示されます。</p></div>}<p className="privacy-note">共有JSONにはパスワード、認証トークン、ワールドデータを含めません。保存・複製・差分・インポート・エクスポートは安全ツールで利用できます。</p></section>

    <section className="pro-card" aria-labelledby="appearance-title"><header><div><span className="section-kicker">APPEARANCE</span><h4 id="appearance-title">追加テーマ・アイコン</h4></div></header><div className="appearance-options"><fieldset><legend>アクセント</legend>{(["emerald", "amethyst", "ocean", "copper"] as Exclude<AccentTheme, "custom">[]).map((accent) => <button type="button" aria-pressed={appearance.accent === accent} className={`accent-choice ${accent} ${appearance.accent === accent ? "selected" : ""}`} key={accent} onClick={() => saveAppearance({ ...appearance, accent })}><i />{{ emerald: "エメラルド", amethyst: "アメジスト", ocean: "オーシャン", copper: "銅" }[accent]}</button>)}</fieldset><fieldset><legend>アイコン表示</legend>{(["comfortable", "compact"] as IconScale[]).map((iconScale) => <button type="button" aria-pressed={appearance.iconScale === iconScale} className={appearance.iconScale === iconScale ? "selected" : ""} key={iconScale} onClick={() => saveAppearance({ ...appearance, iconScale })}><Icon name={iconScale === "comfortable" ? "plugin" : "check"} size={18} />{iconScale === "comfortable" ? "見やすい" : "コンパクト"}</button>)}</fieldset></div><div className="custom-accent-settings"><div><strong>{t("customColor")}</strong><small>{t("customColorHelp")}</small></div><label className="custom-color-picker"><span>{t("themeColor")}</span><input aria-label={t("themeColor")} type="color" value={normalizeHexColor(customAccentDraft) ?? defaultAppearance.customAccent} onChange={(event) => setCustomAccentDraft(event.target.value.toUpperCase())} /></label><label className="custom-color-code"><span>{t("colorCode")}</span><input aria-label={t("colorCode")} value={customAccentDraft} maxLength={7} spellCheck={false} onChange={(event) => setCustomAccentDraft(event.target.value)} /></label><button className="primary-button" type="button" disabled={!normalizeHexColor(customAccentDraft)} onClick={applyCustomAccent}>{t("applyColor")}</button></div></section>
  </div>;
}
