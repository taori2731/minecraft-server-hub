import { useEffect, useMemo, useState } from "react";
import { backend, selectMigrationExport } from "../lib/backend";
import { isPalworldServer } from "../lib/gameAdapter";
import { useI18n } from "../lib/i18n";
import { palworldText } from "../lib/palworldLocale";
import type { AutomationSettings, ExtensionCheckReport, RuntimeStatus, ServerProfile, UpdateCenterReport } from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";

interface Props {
  server: ServerProfile;
  status: RuntimeStatus;
  onUpdated: (server: ServerProfile) => void;
  notify: (message: string) => void;
  fail: (message: string) => void;
}

export function OperationsCenterTab({ server, status, onUpdated, notify, fail }: Props) {
  const isPalworld = isPalworldServer(server);
  const { locale } = useI18n();
  const [settings, setSettings] = useState<AutomationSettings>();
  const [conflicts, setConflicts] = useState<ExtensionCheckReport>();
  const [updates, setUpdates] = useState<UpdateCenterReport>();
  const [selectedUpdates, setSelectedUpdates] = useState(new Set<string>());
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    setSettings(undefined); setConflicts(undefined); setUpdates(undefined); setSelectedUpdates(new Set()); setConfirmed(false);
    backend.getAutomationSettings(server.id).then(setSettings).catch((reason) => fail(String(reason)));
  }, [server.id, fail]);

  const saveSettings = async (next: AutomationSettings) => {
    setSettings(next);
    try { setSettings(await backend.saveAutomationSettings(next)); notify("自動運用とWindows通知の設定を保存しました"); }
    catch (reason) { fail(String(reason)); }
  };
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    try { await action(); } catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };
  const exportMigration = () => run("migration", async () => {
    const destination = await selectMigrationExport(`${server.name.replace(/[<>:\"/\\|?*]/g, "-")}.mshmove`);
    if (!destination) return;
    const result = await backend.exportServerMigration(server.id, destination);
    notify(`引っ越しファイルを作成しました（${result.manifest.fileCount}ファイル）`);
  });
  const scanUpdates = () => run("scan-updates", async () => {
    const report = await backend.getUpdateCenter(server.id);
    setUpdates(report);
    setSelectedUpdates(new Set(report.items.filter((item) => item.selectable).map((item) => item.id)));
    setConfirmed(false);
    notify("公式配布元と管理記録から更新候補を確認しました");
  });
  const applyUpdates = () => run("apply-updates", async () => {
    if (!updates || status.state !== "stopped" || !confirmed) return;
    const chosen = updates.items.filter((item) => selectedUpdates.has(item.id));
    if (!chosen.length) return;
    for (const item of chosen) {
      if (item.kind === "server") {
        const report = await backend.checkUpdateSafety(server.id, item.availableVersion, server.serverType);
        const result = await backend.applyServerUpdate({ serverId: server.id, targetMinecraftVersion: item.availableVersion, targetServerType: server.serverType, confirmationName: server.name, acceptWarnings: report.dependencyWarnings.length > 0 });
        onUpdated(result.server);
      } else if (item.kind === "geyser") {
        const crossplay = await backend.crossplayStatus(server.id);
        if (!crossplay.bedrockPort) throw new Error("Geyserの統合版UDPポートを確認できません");
        await backend.installCrossplay({ serverId: server.id, includeFloodgate: crossplay.floodgateInstalled, bedrockPort: crossplay.bedrockPort, acceptWarnings: true });
      } else if (item.projectId && item.versionId && item.extensionKind) {
        await backend.applyManagedExtensionUpdate({ serverId: server.id, projectId: item.projectId, versionId: item.versionId, kind: item.extensionKind });
      }
    }
    setUpdates(await backend.getUpdateCenter(server.id));
    setSelectedUpdates(new Set()); setConfirmed(false);
    notify(`${chosen.length}件をバックアップ後に更新しました`);
  });
  const selectedCount = useMemo(() => [...selectedUpdates].length, [selectedUpdates]);

  return <div className="tab-content operations-center">
    {!isPalworld && <section className="feature-panel migration-panel">
      <header><div><span className="section-kicker">NEW PC MOVE</span><h2>新しいPCへサーバーを引っ越す</h2></div><button className="primary-button" disabled={status.state !== "stopped" || Boolean(busy)} onClick={exportMigration}><Icon name="download" size={18}/>{busy === "migration" ? "作成しています…" : "移行ファイルを作成"}</button></header>
      <p>ワールド、設定、Mod／プラグイン、Javaの必要バージョンを1つの<code>.mshmove</code>ファイルへまとめます。</p>
      <div className="inline-warning"><Icon name="info" size={17}/><span>ログ・トンネル認証情報・トークン・PC固有のJava絶対パスは含めません。新PCではJavaを安全に再選択します。</span></div>
      {status.state !== "stopped" ? <small>作成前にサーバーを安全停止してください。</small> : null}
    </section>}

    <section className="feature-panel automation-panel">
      <header><div><span className="section-kicker">LOCAL AUTOMATION</span><h2>0人になったら安全に自動停止</h2></div><span className={`status-pill ${settings?.autoStopEnabled ? "on" : ""}`}>{settings?.autoStopEnabled ? "有効" : "無効"}</span></header>
      {isPalworld && <p>{palworldText(locale, "automationDescription")}</p>}
      {isPalworld && !server.palworldSettings?.restApiEnabled && <div className="inline-warning">{palworldText(locale, "automationRequiresRest")}</div>}
      {settings ? <div className="automation-grid">
        <label className="switch-row"><input type="checkbox" checked={settings.autoStopEnabled} onChange={(event) => saveSettings({ ...settings, autoStopEnabled: event.target.checked })}/><span><b>自動停止を使う</b><small>起動完了後、プレイヤー0人の時間をRust側で監視します。</small></span></label>
        <label><span>0人になってから</span><select value={settings.idleMinutes} disabled={!settings.autoStopEnabled} onChange={(event) => saveSettings({ ...settings, idleMinutes: Number(event.target.value) })}>{[5, 10, 15, 30, 60, 120].map((minutes) => <option value={minutes} key={minutes}>{minutes}分</option>)}</select></label>
      </div> : <div className="panel-empty compact"><span className="spinner"/><p>設定を読み込んでいます</p></div>}
    </section>

    <section className="feature-panel notification-panel">
      <header><div><span className="section-kicker">WINDOWS · LOCAL ONLY</span><h2>Windows通知</h2></div></header>
      <p>外部サービスを使わず、このPCの通知センターへ表示します。</p>
      {settings ? <div className="notification-options">
        {([['notifyStartup', 'サーバー起動完了'], ['notifyPlayerJoin', 'プレイヤー参加'], ['notifyCrash', 'クラッシュ'], ['notifyBackupFailure', 'バックアップ失敗']] as const).filter(([key]) => !isPalworld || key !== 'notifyBackupFailure').map(([key, label]) => <label key={key}><input type="checkbox" checked={settings[key]} onChange={(event) => saveSettings({ ...settings, [key]: event.target.checked })}/><span>{label}</span></label>)}
      </div> : null}
    </section>

    {!isPalworld && <><section className="feature-panel conflict-panel">
      <header><div><span className="section-kicker">PRE-LAUNCH CHECK</span><h2>Mod・プラグイン競合チェック</h2></div><button className="small-button" disabled={Boolean(busy)} onClick={() => run("conflicts", async () => { const report = await backend.checkExtensionConflicts(server.id); setConflicts(report); notify("拡張機能の事前検査が完了しました"); })}><Icon name="search" size={17}/>{busy === "conflicts" ? "検査中…" : "今すぐ検査"}</button></header>
      {conflicts ? <><div className="check-summary"><b>{conflicts.scannedFiles}件を検査</b><span>配布元管理 {conflicts.managedFiles}件</span><span className={conflicts.blocking ? "danger-text" : "online"}>{conflicts.blocking ? "起動前に修正が必要" : "重大な問題なし"}</span></div><div className="check-items">{conflicts.items.map((item, index) => <article className={item.severity} key={`${item.code}-${index}`}><Icon name={item.severity === "error" ? "close" : item.severity === "warning" ? "info" : "check"} size={18}/><div><strong>{item.title}</strong><p>{item.detail}</p><small>次: {item.nextAction}</small></div></article>)}{!conflicts.items.length ? <div className="panel-empty compact"><p>公開メタデータ上の競合は見つかりませんでした。</p></div> : null}</div><p className="privacy-note">{conflicts.limitation}</p></> : <div className="panel-empty compact"><p>Minecraft版、ローダー、必須依存、重複ID、クライアント側必須Modをローカル検査します。</p></div>}
    </section>

    <section className="feature-panel update-center-panel">
      <header><div><span className="section-kicker">SELECT · BACKUP · APPLY</span><h2>更新センター</h2></div><button className="small-button" disabled={Boolean(busy)} onClick={scanUpdates}><Icon name="refresh" size={17}/>{busy === "scan-updates" ? "確認中…" : "更新候補を確認"}</button></header>
      {updates ? <><div className="update-center-list">{updates.items.map((item) => <label key={item.id} className={!item.selectable ? "disabled" : ""}><input type="checkbox" disabled={!item.selectable} checked={selectedUpdates.has(item.id)} onChange={(event) => setSelectedUpdates((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })}/><div><strong>{item.name}</strong><span>{item.currentVersion} → {item.availableVersion}</span><small>{item.source} · {item.note}</small>{item.requiresClientUpdate ? <em>参加者側の更新も確認</em> : null}</div></label>)}{updates.items.length === 0 ? <div className="panel-empty compact"><p>管理できる更新候補はありません。</p></div> : null}</div>{updates.unmanagedFiles.length ? <details><summary>自動更新しない手動追加ファイル（{updates.unmanagedFiles.length}件）</summary><p>{updates.unmanagedFiles.join("、")}</p></details> : null}<label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/>選択項目、参加者側への影響、バックアップ後の適用を確認しました</label><button className="primary-button" disabled={!selectedCount || !confirmed || status.state !== "stopped" || Boolean(busy)} onClick={applyUpdates}>選択した{selectedCount}件をバックアップして更新</button>{status.state !== "stopped" ? <small>適用前にサーバーを停止してください。</small> : null}<p className="privacy-note">{updates.disclaimer}</p></> : <div className="panel-empty compact"><p>Minecraft／Paper、Mod、プラグイン、Geyserを一画面で確認します。手動追加ファイルは勝手に更新しません。</p></div>}
    </section>
    {busy === "migration" || busy === "apply-updates" ? <OperationOverlay title={busy === "migration" ? "引っ越しファイルを作成しています" : "選択した更新を安全に適用しています"} detail={busy === "migration" ? "安全なファイルだけを収集し、移行情報と一緒に圧縮しています。" : "停止状態を確認し、バックアップと配布元検証後に選択項目だけを更新します。"} stages={busy === "migration" ? ["安全確認", "ファイル収集", "移行ファイル作成"] : ["安全バックアップ", "配布元検証", "選択項目の反映"]}/> : null}</>}
  </div>;
}
