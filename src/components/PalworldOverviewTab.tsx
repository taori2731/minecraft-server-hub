import { useEffect, useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import type { BackupInfo, RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";
import { useI18n } from "../lib/i18n";
import { palworldText } from "../lib/palworldLocale";
import { serverManagerText } from "../lib/serverManagerLocale";
import { AccessLogPanel } from "./AccessLogPanel";

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
}

function metric(value: number | undefined, suffix = "") {
  return value == null ? "—" : `${value.toFixed(Number.isInteger(value) ? 0 : 1)}${suffix}`;
}

export function PalworldOverviewTab({ server, status, onCopyAddress, notify, fail }: {
  server: ServerProfile;
  status: RuntimeStatus;
  onCopyAddress: () => void;
  notify: (message: string) => void;
  fail: (message: string) => void;
}) {
  const { locale, t } = useI18n();
  const pw = (key: Parameters<typeof palworldText>[1]) => palworldText(locale, key);
  const sm = (key: Parameters<typeof serverManagerText>[1], values?: Record<string, string>) => serverManagerText(locale, key, values);
  const [saving, setSaving] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupBusy, setBackupBusy] = useState("");
  const runtime = status.palworld;
  const running = status.state === "running";
  const apiReachable = Boolean(running && runtime?.apiReachable);
  const refreshBackups = () => backend.listBackups(server.id).then(setBackups).catch((reason) => fail(String(reason)));
  useEffect(() => { void refreshBackups(); }, [server.id]);

  const saveWorld = async () => {
    setSaving(true);
    try {
      await backend.savePalworldWorld(server.id);
      notify(pw("saveSucceeded"));
    } catch (reason) {
      fail(String(reason));
    } finally {
      setSaving(false);
    }
  };
  const createBackup = async () => { setBackupBusy("create"); try { await backend.createBackup(server.id, "manual"); await refreshBackups(); notify(sm("backupCreated")); } catch (reason) { fail(String(reason)); } finally { setBackupBusy(""); } };
  const restoreBackup = async (item: BackupInfo) => { const name = item.displayName || item.id; if (!await confirmDanger(sm("restoreConfirm", { name }))) return; setBackupBusy(item.id); try { await backend.restoreBackup(server.id, item.id); await refreshBackups(); notify(sm("backupRestored")); } catch (reason) { fail(String(reason)); } finally { setBackupBusy(""); } };
  const deleteBackup = async (item: BackupInfo) => { const name = item.displayName || item.id; if (!await confirmDanger(sm("deleteBackupConfirm", { name }))) return; setBackupBusy(item.id); try { await backend.deleteBackup(server.id, item.id); await refreshBackups(); notify(sm("backupDeleted")); } catch (reason) { fail(String(reason)); } finally { setBackupBusy(""); } };

  return <div className="tab-content overview-content palworld-overview-content">
    <section className={`feature-panel palworld-rest-banner ${apiReachable ? "ready" : ""}`}>
      <div><span className="section-kicker">PALWORLD · LOCAL REST API</span><h2>{apiReachable ? pw("monitoringTitle") : running ? pw("statusPreparing") : pw("statusStopped")}</h2><p>{pw("restLocalOnlyDescription")} {pw("playerIpHidden")}</p></div>
      <button className="primary-button" type="button" disabled={!apiReachable || saving} onClick={saveWorld}><Icon name="download" size={17} />{saving ? pw("saveInProgress") : pw("saveWorld")}</button>
    </section>

    <div className="metric-grid">
      <article className="metric-card"><div className="metric-label"><Icon name="server" /><span>UDP</span></div><strong>{status.address}</strong><button className="small-button" type="button" onClick={onCopyAddress}><Icon name="clipboard" size={17} />{pw("copyAddress")}</button></article>
      <article className="metric-card"><div className="metric-label"><Icon name="users" /><span>{t("players")}</span></div><strong>{status.playerCount} / {status.maxPlayers}</strong><small className={running ? "online" : ""}><i />{running ? t("running") : t("stopped")}</small></article>
      <article className="metric-card"><div className="metric-label"><Icon name="memory" /><span>RAM</span></div><strong>{(status.memoryUsedMib / 1024).toFixed(1)} GiB</strong><small>PalServer.exe</small></article>
      <article className="metric-card"><div className="metric-label"><Icon name="clock" /><span>{pw("uptime")}</span></div><strong>{formatUptime(status.uptimeSeconds)}</strong><small>{running ? pw("safeShutdownDescription") : pw("statusStopped")}</small></article>
    </div>

    <section className="monitor-strip palworld-monitor-strip" aria-label={pw("monitoringTitle")}>
      <div><span>{pw("serverFps")}</span><strong>{running ? metric(runtime?.serverFps) : "—"}</strong><small>REST API</small></div>
      <div><span>{pw("frameTime")}</span><strong>{running ? metric(runtime?.serverFrameTimeMs, " ms") : "—"}</strong><small>REST API</small></div>
      <div><span>{pw("baseCamps")}</span><strong>{running ? metric(runtime?.baseCampCount) : "—"}</strong><small>REST API</small></div>
      <div><span>{pw("worldDays")}</span><strong>{running ? metric(runtime?.worldDays) : "—"}</strong><small>REST API</small></div>
    </section>

    <section className="feature-panel palworld-runtime-info">
      <header><div><span className="section-kicker">RUNTIME · PALWORLD</span><h2>{pw("monitoringTitle")}</h2></div><span className={`status-pill ${apiReachable ? "on" : ""}`}>{apiReachable ? pw("statusRunning") : pw("statusStopped")}</span></header>
      <div className="palworld-download-facts">
        <article><span>{pw("versionLabel")}</span><strong data-no-translate>{runtime?.version || server.minecraftVersion || "—"}</strong></article>
        <article><span>{pw("serverLabel")}</span><strong>{runtime?.serverName || server.name}</strong></article>
        <article><span>World GUID</span><strong data-no-translate>{runtime?.worldGuid ? "••••••••" : "—"}</strong></article>
      </div>
    </section>
    <section className="feature-panel palworld-backup-panel" id="server-backups"><header><div><span className="section-kicker">PALWORLD · BACKUP</span><h2>{sm("backups")}</h2></div><div className="panel-actions"><button className="small-button" onClick={() => backend.openBackupFolder(server.id)}><Icon name="folder" size={16}/>{sm("backupLocation")}</button><button className="primary-button" disabled={running || Boolean(backupBusy)} onClick={createBackup}><Icon name="download" size={16}/>{backupBusy === "create" ? sm("creating") : sm("createNow")}</button></div></header>{running ? <p className="inline-warning"><Icon name="info" size={16}/>{sm("backupStopNote")}</p> : null}<div className="backup-list">{backups.slice(0,5).map((item) => <div className="backup-row" key={item.id}><span><strong>{item.displayName || item.id}</strong><small>{new Date(item.createdAt).toLocaleString(locale)} · {(item.sizeBytes / 1024 / 1024).toFixed(1)} MiB · {item.valid ? sm("validBackup") : sm("invalidBackup")}</small></span><div className="backup-actions"><button className="small-button" disabled={running || Boolean(backupBusy) || !item.valid} onClick={() => restoreBackup(item)}>{sm("restore")}</button><button className="icon-button danger" aria-label={sm("deleteBackup")} disabled={Boolean(backupBusy)} onClick={() => deleteBackup(item)}><Icon name="trash" size={16}/></button></div></div>)}{backups.length === 0 ? <div className="panel-empty compact"><p>{sm("noBackups")}</p></div> : null}</div></section>
    <AccessLogPanel serverId={server.id} state={status.state}/>
    {saving ? <OperationOverlay title={pw("saveInProgress")} detail={pw("saveDescription")} stages={[pw("restLocalOnlyTitle"), pw("saveInProgress"), pw("saveSucceeded")]} /> : null}
  </div>;
}
