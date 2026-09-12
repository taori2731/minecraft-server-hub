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
  onInvite: () => void;
  onNavigate: (tab: TabId) => void;
  onCopyAddress: () => void;
  children: ReactNode;
}

export function HomeHub({ servers, selected, statuses, serverIcons, onSelect, onCreate, onInvite, onNavigate, onCopyAddress, children }: Props) {
  const { locale, t } = useI18n();
  const text = homeText(locale);
  const sm = (key: Parameters<typeof serverManagerText>[1]) => serverManagerText(locale, key);
  const stateLabels = { running: t("running"), starting: t("starting"), stopping: t("stopping"), restarting: t("restarting"), stopped: t("stopped"), crashed: t("crashed"), error: t("crashed"), unknown: "—" };
  const hasExtensions = getServerTabs(selected).includes("extensions");
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
      <section className="home-discover"><header><h2>{text.discover}</h2></header><div className="home-discover-grid">
        <button type="button" className="discovery-card create" onClick={onCreate}><Icon name="server" size={28} /><strong>{text.create}</strong><span>{text.createDetail}</span><Icon name="chevron" size={18} /></button>
        {hasExtensions ? <button type="button" className="discovery-card extensions" onClick={() => onNavigate("extensions")}><Icon name="plugin" size={28} /><strong>{text.extensions}</strong><span>{text.extensionsDetail}</span><Icon name="chevron" size={18} /></button> : null}
        <button type="button" className="discovery-card operations" onClick={() => onNavigate("operations")}><Icon name="clock" size={28} /><strong>{text.operations}</strong><span>{text.operationsDetail}</span><Icon name="chevron" size={18} /></button>
      </div></section>
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
      <button type="button" className="home-invite" onClick={onInvite}><Icon name="invite" size={28} /><span><strong>{text.invite}</strong><small>{text.inviteDetail}</small></span><Icon name="chevron" /></button>
      <div className="home-inspector-links"><button className="secondary-button" type="button" onClick={() => onNavigate("console")}><Icon name="console" />{t("console")}</button>{getServerTabs(selected).includes("files") ? <button className="secondary-button" type="button" onClick={() => onNavigate("files")}><Icon name="folder" />{t("files")}</button> : null}<button className="secondary-button" type="button" onClick={() => jumpTo("server-access-log")}><Icon name="list" />{sm("accessLog")}</button><button className="secondary-button" type="button" onClick={() => jumpTo("server-backups")}><Icon name="download" />{sm("backups")}</button><button className="secondary-button" type="button" onClick={() => onNavigate("settings")}><Icon name="gear" />{t("settings")}</button></div>
    </aside>
  </section>;
}
