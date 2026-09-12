import { useEffect, useState, type ReactNode } from "react";
import type { RuntimeStatus, ServerProfile, TabId } from "../types";
import { useI18n } from "../lib/i18n";
import { homeText } from "../lib/homeLocale";
import { getServerTabs, getServerVersionLabel } from "../lib/gameAdapter";
import { serverTypeLabel } from "../lib/serverEdition";
import { Icon } from "./Icon";
import { ServerIcon } from "./ServerIcon";
import { backend } from "../lib/backend";
import { serverManagerText } from "../lib/serverManagerLocale";

interface Props {
  servers: ServerProfile[];
  selected: ServerProfile;
  statuses: Record<string, RuntimeStatus>;
  serverIcons: Record<string, string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onNavigate: (tab: TabId) => void;
  onCopyAddress: () => void;
  children: ReactNode;
  below?: ReactNode;
}

export function HomeHub({ servers, selected, statuses, serverIcons, onSelect, onCreate, onNavigate, onCopyAddress, children, below }: Props) {
  const { locale, t } = useI18n();
  const text = homeText(locale);
  const sm = (key: Parameters<typeof serverManagerText>[1]) => serverManagerText(locale, key);
  const fileManagementLabel = locale === "ja" ? "ファイル管理" : sm("serverFiles");
  const stateLabels = { running: t("running"), starting: t("starting"), stopping: t("stopping"), restarting: t("restarting"), stopped: t("stopped"), crashed: t("crashed"), error: t("crashed"), unknown: "—" };
  const serverTabs = getServerTabs(selected);
  const [latestBackup, setLatestBackup] = useState<string>();
  useEffect(() => {
    let active = true;
    backend.listBackups(selected.id).then((items) => active && setLatestBackup(items[0]?.createdAt)).catch(() => active && setLatestBackup(undefined));
    return () => { active = false; };
  }, [selected.id]);
  const selectedStatus = statuses[selected.id];
  const uptime = selectedStatus ? selectedStatus.uptimeSeconds < 60 ? `${selectedStatus.uptimeSeconds}s` : selectedStatus.uptimeSeconds < 3600 ? `${Math.floor(selectedStatus.uptimeSeconds / 60)}m` : `${Math.floor(selectedStatus.uptimeSeconds / 3600)}h ${Math.floor(selectedStatus.uptimeSeconds % 3600 / 60)}m` : "—";
  const jumpTo = (id: string) => { onNavigate("overview"); window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); };
  return <section className="home-hub" aria-label={text.home}>
    <div className="home-main">
      <div className="home-banner"><div><h2>{text.title}</h2><p>{text.subtitle}</p><button className="primary-button" type="button" onClick={onCreate}><Icon name="add" />{t("newServer")}</button></div></div>
      <section className="home-servers"><header><h2>{text.servers}</h2><span>{servers.length}</span></header>
        <div className="home-server-grid">{servers.map((server) => {
          const status = statuses[server.id];
          const state = status?.state ?? "stopped";
          return <button className={`home-server-card${server.id === selected.id ? " selected" : ""}`} type="button" key={server.id} aria-pressed={server.id === selected.id} onClick={() => onSelect(server.id)}>
            <div className={`home-server-cover ${server.serverType}`}><ServerIcon source={serverIcons[server.id]} /><span className={`hero-status ${state}`}><i />{stateLabels[state]}</span></div>
            <div className="home-server-copy"><strong>{server.name}</strong><small>{serverTypeLabel[server.serverType]} · {getServerVersionLabel(server)}</small><span><Icon name="users" size={15} />{status ? `${status.playerCount} / ${status.maxPlayers}` : "—"}</span></div>
          </button>;
        })}<button type="button" className="home-server-add" onClick={onCreate}><Icon name="add" size={30} /><strong>{t("newServer")}</strong></button></div>
      </section>
      {below}
    </div>
    <aside className="home-inspector">
      {children}
      <div className="home-inspector-facts">
        <div><Icon name="users" size={19} /><span><strong>{selectedStatus ? `${selectedStatus.playerCount} / ${selectedStatus.maxPlayers}` : "—"}</strong><small>{t("players")}</small></span></div>
        <button type="button" onClick={onCopyAddress} disabled={!selectedStatus?.address} title={selectedStatus?.address} aria-label={selectedStatus?.address ?? t("loadingServers")}><Icon name="clipboard" size={19} /><span><strong>{selectedStatus?.address ?? "—"}</strong><small>{selected.port} · {selected.serverType === "palworld" || selected.serverType === "bedrock" ? "UDP" : "TCP"}</small></span></button>
        <div><Icon name="clock" size={19}/><span><strong>{uptime}</strong><small>Uptime</small></span></div>
        <div><Icon name="memory" size={19}/><span><strong>{selectedStatus ? `${(selectedStatus.memoryUsedMib / 1024).toFixed(1)} GiB · CPU ${selectedStatus.cpuPercent.toFixed(0)}%` : "—"}</strong><small>Runtime</small></span></div>
        <div><Icon name="check" size={19}/><span><strong>{latestBackup ? new Date(latestBackup).toLocaleString(locale) : "—"}</strong><small>Backup</small></span></div>
      </div>
      <div className="home-inspector-links"><button className="secondary-button" type="button" onClick={() => jumpTo("server-access-log")}><Icon name="list" />{sm("accessLog")}</button><button className="secondary-button" type="button" onClick={() => jumpTo("server-backups")}><Icon name="download" />{sm("backups")}</button>{serverTabs.includes("files") ? <button className="secondary-button" type="button" onClick={() => onNavigate("files")}><Icon name="folder" />{fileManagementLabel}</button> : null}</div>
    </aside>
  </section>;
}
