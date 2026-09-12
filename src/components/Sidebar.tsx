import { useState } from "react";
import type { AppSection, RuntimeStatus, ServerProfile, TabId } from "../types";
import { Icon } from "./Icon";
import { useI18n } from "../lib/i18n";
import { serverTypeLabel } from "../lib/serverEdition";
import { ServerIcon } from "./ServerIcon";
import { getNetworkProtocolForServerType, getServerVersionLabel, isPalworldServer } from "../lib/gameAdapter";
import { homeText } from "../lib/homeLocale";
import { workspaceText } from "../lib/workspaceLocale";

interface Props {
  servers: ServerProfile[];
  serverIcons: Record<string, string>;
  selectedId?: string;
  statuses: Record<string, RuntimeStatus>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onAppSettings: () => void;
  onImport: () => void;
  onDelete: (server: ServerProfile) => void;
  activeTab: TabId;
  availableTabs: readonly TabId[];
  onNavigate: (tab: TabId) => void;
  activeSection: AppSection;
  onSectionNavigate: (section: AppSection) => void;
}

export function Sidebar({ servers, serverIcons, selectedId, statuses, onSelect, onCreate, onAppSettings, onImport, onDelete, activeTab, availableTabs, onNavigate, activeSection, onSectionNavigate }: Props) {
  const { locale, t } = useI18n();
  const workspace = workspaceText(locale);
  const [query, setQuery] = useState("");
  const filteredServers = servers.filter((server) => `${server.name} ${serverTypeLabel[server.serverType]} ${getServerVersionLabel(server)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const runningCount = servers.filter((server) => statuses[server.id]?.state === "running").length;
  const stateText = { running: t("running"), starting: t("starting"), stopping: t("stopping"), restarting: t("restarting"), stopped: t("stopped"), crashed: t("crashed"), error: t("crashed"), unknown: "—" } as const;
  return (
    <aside className="sidebar" aria-label={t("serverList")}>
      <nav className="sidebar-navigation" aria-label={homeText(locale).home}>
        <button type="button" className={activeSection === "home" ? "active" : ""} disabled={!selectedId} onClick={() => onSectionNavigate("home")}><Icon name="chart" />{homeText(locale).home}</button>
        <button type="button" className={activeSection === "servers" ? "active" : ""} onClick={() => onSectionNavigate("servers")}><Icon name="server" />{workspace.servers}</button>
        <button type="button" className={activeSection === "players" ? "active" : ""} disabled={!selectedId || !availableTabs.includes("players")} onClick={() => onSectionNavigate("players")}><Icon name="users" />{workspace.players}</button>
        <button type="button" className={activeSection === "templates" ? "active" : ""} onClick={() => onSectionNavigate("templates")}><Icon name="clipboard" />{workspace.templates}</button>
        <button type="button" className={activeSection === "discover" ? "active" : ""} onClick={() => onSectionNavigate("discover")}><Icon name="search" />{workspace.discover}</button>
        <button type="button" className={activeSection === "news" ? "active" : ""} onClick={() => onSectionNavigate("news")}><Icon name="info" />{workspace.news}</button>
      </nav>
      <div className="sidebar-title"><Icon name="list" /><h2>{t("serverList")}</h2><span className="server-count">{servers.length}</span></div>
      <div className="sidebar-create-actions">
        <button className="primary-button" type="button" onClick={onCreate}><Icon name="add" />{t("newServer")}</button>
        <button className="secondary-button" type="button" onClick={onImport}><Icon name="download" size={18} />{t("importServer")}</button>
      </div>
      <label className="sidebar-search"><Icon name="search" size={17} /><input type="search" aria-label={t("serverList")} placeholder={t("serverList")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="server-list">
        {filteredServers.map((server) => {
          const status = statuses[server.id];
          const state = status?.state ?? "stopped";
          return (
            <div key={server.id} className={selectedId === server.id ? "server-row selected" : "server-row"}>
              <button type="button" className="server-row-main" aria-current={selectedId === server.id ? "true" : undefined} onClick={() => onSelect(server.id)}>
                <ServerIcon source={serverIcons[server.id]} />
                <span className="server-row-copy">
                  <strong>{server.name}</strong>
                  <small>{serverTypeLabel[server.serverType]} / {getServerVersionLabel(server)}{getNetworkProtocolForServerType(server.serverType) === "udp" ? " · UDP" : ""}{isPalworldServer(server) ? " · SteamCMD" : ""}</small>
                  <span className={`status-label ${state}`}><i />{stateText[state]}{state === "running" ? ` · ${status.playerCount}/${status.maxPlayers}` : ""}</span>
                </span>
              </button>
              <button className="server-row-delete" type="button" onClick={() => onDelete(server)} aria-label={locale === "ja" ? `${server.name}を削除` : `${t("deleteServer")}: ${server.name}`} title={t("deleteServer")}><Icon name="trash" size={18} /></button>
            </div>
          );
        })}
        {servers.length > 0 && filteredServers.length === 0 ? <div className="sidebar-search-empty"><Icon name="search" /><span>0 / {servers.length}</span><button className="small-button" type="button" onClick={() => setQuery("")}><Icon name="close" size={16} />{t("serverList")}</button></div> : null}
        {servers.length === 0 ? (
          <div className="sidebar-empty">
            <Icon name="server" size={34} />
            <strong>{t("noServers")}</strong>
            <span>{t("createFirstServer")}</span>
            <button className="secondary-button" type="button" onClick={onCreate}><Icon name="add" size={18} />{t("create")}</button>
            <button className="secondary-button" type="button" onClick={onImport}><Icon name="download" size={18} />{t("importServer")}</button>
          </div>
        ) : null}
      </div>
      <div className="sidebar-summary"><span className="status-label running"><i />{t("running")}</span><strong>{runningCount}<span> / {servers.length}</span></strong></div>
      <div className="sidebar-footer">
        <button type="button" onClick={onAppSettings}><Icon name="gear" />{t("settings")}</button>
        <button type="button" onClick={onAppSettings}><Icon name="info" />{t("information")}</button>
      </div>
    </aside>
  );
}
