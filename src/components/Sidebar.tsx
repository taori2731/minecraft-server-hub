import type { RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { useI18n } from "../lib/i18n";
import { serverTypeLabel } from "../lib/serverEdition";
import { ServerIcon } from "./ServerIcon";
import { getNetworkProtocolForServerType, getServerVersionLabel, isPalworldServer } from "../lib/gameAdapter";

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
}

export function Sidebar({ servers, serverIcons, selectedId, statuses, onSelect, onCreate, onAppSettings, onImport, onDelete }: Props) {
  const { locale, t } = useI18n();
  const stateText = { running: t("running"), starting: t("starting"), stopping: t("stopping"), stopped: t("stopped"), crashed: t("crashed") } as const;
  return (
    <aside className="sidebar" aria-label={t("serverList")}>
      <div className="sidebar-title"><Icon name="list" /><h2>{t("serverList")}</h2><button className="icon-button" type="button" aria-label={t("collapseSidebar")}><Icon name="back" /></button></div>
      <div className="server-list">
        {servers.map((server) => {
          const status = statuses[server.id];
          const state = status?.state ?? "stopped";
          return (
            <div key={server.id} className={selectedId === server.id ? "server-row selected" : "server-row"}>
              <button type="button" className="server-row-main" onClick={() => onSelect(server.id)}>
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
      <div className="sidebar-footer">
        <button type="button" onClick={onAppSettings}><Icon name="gear" />{t("settings")}</button>
        <button type="button" onClick={onAppSettings}><Icon name="info" />{t("information")}</button>
      </div>
    </aside>
  );
}
