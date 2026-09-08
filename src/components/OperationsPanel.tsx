import { useEffect, useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import type { BackupInfo, PcDiagnosis, RuntimeStatus, ServerDiagnosisReport, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";

const gib = (mib: number) => `${(mib / 1024).toFixed(1)} GiB`;
const size = (bytes: number) => bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

export function OperationsPanel({ server, status, onUpdated, notify, fail }: { server: ServerProfile; status: RuntimeStatus; onUpdated: (server: ServerProfile) => void; notify: (message: string) => void; fail: (message: string) => void }) {
  const [diagnosis, setDiagnosis] = useState<PcDiagnosis>();
  const [serverDiagnosis, setServerDiagnosis] = useState<ServerDiagnosisReport>();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState("");
  const [backupName, setBackupName] = useState("manual");

  const refreshBackups = () => backend.listBackups(server.id).then(setBackups).catch((reason) => fail(String(reason)));
  useEffect(() => { setDiagnosis(undefined); setServerDiagnosis(undefined); refreshBackups(); }, [server.id]);

  const diagnose = async () => {
    setBusy("diagnose");
    try { setDiagnosis(await backend.diagnose(server.id)); notify("PC診断が完了しました（結果は外部送信されません）"); }
    catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };
  const diagnoseServer = async () => {
    setBusy("server-diagnose");
    try { setServerDiagnosis(await backend.analyzeServer(server.id)); notify("サーバー診断が完了しました（ログは外部送信されません）"); }
    catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };
  const applyRecommendation = async () => {
    if (!diagnosis || status.state !== "stopped") return;
    const message = `推奨設定を「${server.name}」へ反映しますか？\n\nメモリ ${gib(diagnosis.recommendedMemoryMib)} / 最大${diagnosis.recommendedPlayers}人 / 描画${diagnosis.recommendedViewDistance} / シミュレーション${diagnosis.recommendedSimulationDistance}\n\n変更前バックアップを自動作成します。`;
    if (!await confirmDanger(message)) return;
    setBusy("apply-recommendation");
    try {
      const updated = await backend.updateSettings(server.id, {
        ...server.settings,
        maxPlayers: diagnosis.recommendedPlayers,
        viewDistance: diagnosis.recommendedViewDistance,
        simulationDistance: diagnosis.recommendedSimulationDistance,
      }, diagnosis.recommendedMemoryMib, server.port);
      onUpdated(updated);
      notify("変更前バックアップを作成し、推奨設定を反映しました");
    } catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };
  const backup = async () => {
    setBusy("backup");
    try { await backend.createBackup(server.id, backupName.trim() || "manual"); await refreshBackups(); notify("手動バックアップを作成しました"); }
    catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };
  const restore = async (item: BackupInfo) => {
    if (!await confirmDanger(`「${item.id}」を復元しますか？\n現在の状態は復元直前バックアップとして自動保存されます。`)) return;
    setBusy(item.id);
    try { await backend.restoreBackup(server.id, item.id); await refreshBackups(); notify("バックアップを復元しました"); }
    catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };
  const verify = async (item: BackupInfo) => {
    setBusy(`verify:${item.id}`);
    try { const valid = await backend.verifyBackup(server.id, item.id); await refreshBackups(); notify(valid ? "バックアップの整合性を確認しました" : "バックアップが破損しています"); }
    catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };
  const remove = async (item: BackupInfo) => {
    if (!await confirmDanger(`「${item.id}」を削除しますか？\nこのバックアップは元に戻せません。`)) return;
    setBusy(`delete:${item.id}`);
    try { await backend.deleteBackup(server.id, item.id); await refreshBackups(); notify("バックアップを削除しました"); }
    catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };

  return <div className="operations-grid">
    <section className="feature-panel server-diagnosis-panel">
      <header><div><span className="section-kicker">BEGINNER HELP</span><h2>サーバー診断</h2></div><button className="small-button" type="button" onClick={diagnoseServer} disabled={Boolean(busy)}><Icon name="search" size={17} />{busy === "server-diagnose" ? "解析中…" : serverDiagnosis ? "再診断" : "原因を調べる"}</button></header>
      {!serverDiagnosis ? <div className="panel-empty compact"><p>起動ファイル、Java、EULA、ポート、メモリ、空き容量、Mod依存関係、最新ログをこのPC内だけで確認します。</p></div> : null}
      {serverDiagnosis?.healthy && serverDiagnosis.issues.length === 0 ? <p className="diagnosis-ok"><Icon name="check" size={18} />大きな問題は見つかりませんでした。</p> : null}
      {serverDiagnosis?.issues.map((item) => <details className={`diagnosis-issue ${item.severity}`} key={item.id} open={item.severity === "error"}><summary><span>{item.severity === "error" ? "要対応" : "確認"}</span><strong>{item.whatHappened}</strong></summary><div><p><b>影響</b>{item.impact}</p><p><b>推定原因</b>{item.likelyCause}</p><div><b>次に試す操作</b><ol>{item.nextActions.map((action) => <li key={action}>{action}</li>)}</ol></div>{item.suggestRestore ? <p className="restore-suggestion">変更前の検証済みバックアップへ戻すこともできます。</p> : null}{item.relatedLogs.length ? <details className="technical-logs"><summary>関連ログ（伏せ字済み）</summary><pre>{item.relatedLogs.join("\n")}</pre></details> : null}</div></details>)}
      {serverDiagnosis ? <p className="privacy-note">{serverDiagnosis.redactionNote}</p> : null}
    </section>
    <section className="feature-panel diagnosis-panel">
      <header><div><span className="section-kicker">LOCAL ONLY</span><h2>PC診断と推奨設定</h2></div><button className="small-button" type="button" onClick={diagnose} disabled={Boolean(busy)}><Icon name="refresh" size={17} />{busy === "diagnose" ? "診断中…" : diagnosis ? "再診断" : "PCを診断"}</button></header>
      {diagnosis ? <>
        <div className="diagnosis-facts">
          <div><span>CPU</span><strong>{diagnosis.cpuName}</strong><small>{`${diagnosis.physicalCores}コア / ${diagnosis.logicalThreads}スレッド · 使用率 ${diagnosis.cpuUsagePercent.toFixed(0)}%`}</small></div>
          <div><span>メモリ</span><strong>{gib(diagnosis.memoryAvailableMib)} 空き</strong><small>合計 {gib(diagnosis.memoryTotalMib)}</small></div>
          <div><span>GPU</span><strong>{diagnosis.gpuName}</strong><small>{diagnosis.os}</small></div>
          <div><span>保存先</span><strong>{diagnosis.storageKind}</strong><small>{diagnosis.storageAvailable ? `空き ${diagnosis.storageFreeGib} GiB` : "空き容量を取得できません"}</small></div>
        </div>
        <div className="recommendation-strip"><div><span>推奨メモリ</span><b>{gib(diagnosis.recommendedMemoryMib)}</b></div><div><span>推奨人数の目安</span><b>{diagnosis.recommendedPlayers}人</b></div><div><span>描画 / シミュレーション</span><b>{diagnosis.recommendedViewDistance} / {diagnosis.recommendedSimulationDistance}</b></div></div>
        <button className="secondary-button recommendation-apply-button" type="button" onClick={applyRecommendation} disabled={status.state !== "stopped" || Boolean(busy)}><Icon name="check" size={17} />{busy === "apply-recommendation" ? "バックアップ・反映中…" : "推奨値を設定へ反映"}</button>
        {status.state !== "stopped" ? <p className="inline-warning"><Icon name="info" size={17} />反映するにはサーバーを停止してください。</p> : null}
        {diagnosis.warnings.map((warning) => <p className="inline-warning" key={warning}><Icon name="info" size={17} />{warning}</p>)}
        <p className="privacy-note">{diagnosis.privacyNote}</p>
        <p className="capacity-note">実際の上限は、Mod、ワールド、チャンク生成、装置、プラグイン、回線、ストレージ、プレイヤーの行動によって変わります。表示人数は目安であり、動作を保証するものではありません。</p>
      </> : <div className="panel-empty"><Icon name="memory" size={32} /><p>このPCのCPU・メモリ・Java・保存先をローカルで調べ、余裕を残した推奨値を計算します。</p></div>}
    </section>

    <section className="feature-panel backup-panel">
      <header><div><span className="section-kicker">SAFETY</span><h2>バックアップ</h2></div><div className="panel-actions"><button className="small-button" type="button" onClick={() => backend.openBackupFolder(server.id)}><Icon name="folder" size={17} />保存先</button><button className="small-button" type="button" onClick={backup} disabled={status.state !== "stopped" || Boolean(busy)}><Icon name="download" size={17} />{busy === "backup" ? "作成中…" : "手動作成"}</button></div></header>
      {status.state !== "stopped" ? <p className="inline-warning"><Icon name="info" size={17} />整合性のため、安全停止してからバックアップします。</p> : null}
      <label className="backup-name"><span>バックアップ名</span><input value={backupName} maxLength={30} placeholder="例: Mod追加前" onChange={(event) => setBackupName(event.target.value.replace(/[^a-zA-Z0-9_-]/g, "-"))}/></label>
      <div className="backup-list">
        {backups.slice(0, 5).map((item) => <div className="backup-row" key={item.id}><span><strong>{item.id}</strong><small>{item.minecraftVersion} · {size(item.sizeBytes)} · <b className={item.valid ? "backup-valid" : "backup-invalid"}>{item.valid ? "整合性OK" : "要確認"}</b></small><small>{item.extensionSummary}</small></span><div className="backup-actions"><button className="small-button" type="button" disabled={Boolean(busy)} onClick={() => verify(item)}>検証</button><button className="small-button" type="button" disabled={status.state !== "stopped" || Boolean(busy) || !item.valid} onClick={() => restore(item)}>復元</button><button className="icon-button danger" aria-label="バックアップを削除" type="button" disabled={Boolean(busy)} onClick={() => remove(item)}><Icon name="trash" size={17} /></button></div></div>)}
        {backups.length === 0 ? <div className="panel-empty compact"><p>バックアップはまだありません。設定や拡張機能の変更前にも自動作成します。</p></div> : null}
      </div>
    </section>
    {busy ? <OperationOverlay
      title={busy === "diagnose" ? "PCを診断しています" : busy === "server-diagnose" ? "起動失敗の原因を調べています" : busy === "backup" ? "バックアップを作成しています" : busy.startsWith("verify:") ? "バックアップを検証しています" : busy.startsWith("delete:") ? "バックアップを削除しています" : busy === "apply-recommendation" ? "推奨設定を反映しています" : "バックアップを復元しています"}
      detail="ファイルと状態を確認しています。大きなワールドでは完了まで時間がかかる場合があります。"
      stages={busy === "diagnose" || busy === "server-diagnose" ? ["情報収集", "問題分析", "結果作成"] : ["対象確認", "整合性確認", "処理完了"]}
    /> : null}
  </div>;
}
