import type { LogEntry, RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { OperationsPanel } from "./OperationsPanel";
import { NextStepsCard } from "./NextStepsCard";
import type { TabId } from "../types";
import { AccessLogPanel } from "./AccessLogPanel";

interface Props {
  server: ServerProfile;
  status: RuntimeStatus;
  logs: LogEntry[];
  onCopyAddress: () => void;
  onOpenFolder: () => void;
  notify: (message: string) => void;
  fail: (message: string) => void;
  onUpdated: (server: ServerProfile) => void;
  onNavigate?: (tab: TabId) => void;
  onInvite?: () => void;
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}時間 ${minutes}分` : `${minutes}分`;
}

export function OverviewTab({ server, status, logs, onCopyAddress, onOpenFolder, notify, fail, onUpdated, onNavigate = () => undefined, onInvite = () => undefined }: Props) {
  const memoryManagedByWindows = server.maxMemoryMib <= 0;
  const memoryRatio = memoryManagedByWindows ? 0 : Math.min(100, Math.round((status.memoryUsedMib / server.maxMemoryMib) * 100));
  const running = status.state === "running";
  const tpsValue = !running ? "—" : status.tps == null ? status.tpsSupported ? "計測中" : "非対応" : status.tps.toFixed(1);
  const tpsDetail = !running ? "サーバー起動後に監視を開始します" : status.tps == null
    ? status.tpsSupported ? "起動後、約10秒ごとに自動取得" : "このサーバー種類には標準TPSコマンドがありません"
    : status.tps < 18 ? "低下中：描画距離やチャンク生成を確認" : "良好・約10秒ごとに更新";
  const latency = status.pingLatencyMs == null ? running ? "計測中" : "—" : status.pingLatencyMs === 0 ? "<1 ms" : `${status.pingLatencyMs} ms`;
  return (
    <div className="tab-content overview-content">
      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-label"><Icon name="server" /><span>サーバーアドレス</span></div>
          <strong>{status.address}</strong>
          <button className="small-button" type="button" onClick={onCopyAddress}><Icon name="clipboard" size={17} />コピー</button>
        </article>
        <article className="metric-card">
          <div className="metric-label"><Icon name="users" /><span>プレイヤー</span></div>
          <strong>{status.playerCount} / {status.maxPlayers}</strong>
          <small className={status.state === "running" ? "online" : ""}><i />{status.state === "running" ? "オンライン" : "サーバー停止中"}</small>
        </article>
        <article className="metric-card">
          <div className="metric-label"><Icon name="memory" /><span>使用メモリ</span></div>
          <strong>{(status.memoryUsedMib / 1024).toFixed(1)} GB / {memoryManagedByWindows ? "Windows管理" : `${(server.maxMemoryMib / 1024).toFixed(0)} GB`}</strong>
          <div className="meter" role="progressbar" aria-label="使用メモリ" aria-valuenow={memoryRatio} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${memoryRatio}%` }} /></div>
        </article>
        <article className="metric-card">
          <div className="metric-label"><Icon name="clock" /><span>起動時間</span></div>
          <strong>{formatUptime(status.uptimeSeconds)}</strong>
          <small>{status.state === "running" ? "安全停止でワールドを保存します" : "まだ起動していません"}</small>
        </article>
      </div>
      <section className="monitor-strip" aria-label="負荷監視">
        <div><span>TPS</span><strong>{tpsValue}</strong><small>{tpsDetail}</small></div>
        <div><span>Java CPU</span><strong>{status.cpuPercent.toFixed(0)}%</strong><small>{status.cpuPercent > 85 ? "高負荷：装置・モブ・Modを確認" : "Javaプロセスの使用率"}</small></div>
        <div><span>メモリ圧力</span><strong>{memoryManagedByWindows ? "—" : `${memoryRatio}%`}</strong><small>{memoryManagedByWindows ? "WindowsとBDSが自動管理" : memoryRatio > 90 ? "割り当てとMod構成を見直してください" : "設定した上限に対する割合"}</small></div>
        <div><span>ローカル応答</span><strong>{latency}</strong><small>チャンク数はMinecraft共通APIがないため非表示</small></div>
      </section>

      <div className="overview-detail-grid">
      <section className="recent-panel">
        <header><h2>最近のログ</h2><button className="small-button" type="button" onClick={onOpenFolder}><Icon name="folder" size={17} />ワールドフォルダーを開く</button></header>
        <div className="recent-log-list">
          {logs.slice(-6).reverse().map((entry, index) => <div className="recent-log-row" data-no-translate key={`${entry.timestamp}-${index}`}><time>{entry.timestamp}</time><b className={entry.level.toLowerCase()}>{entry.level}</b><span>{entry.message}</span></div>)}
          {logs.length === 0 ? <div className="empty-log">サーバーを起動すると、ここに最近のログが表示されます。</div> : null}
        </div>
      </section>
      <NextStepsCard key={server.id} server={server} onNavigate={onNavigate} onInvite={onInvite}/>
      </div>
      <OperationsPanel server={server} status={status} onUpdated={onUpdated} notify={notify} fail={fail} />
      <AccessLogPanel serverId={server.id} state={status.state}/>
    </div>
  );
}
