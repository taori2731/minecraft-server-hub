import type { ReactNode } from "react";
import type { RuntimeStatus, ServerProfile, TabId } from "../types";
import { useI18n } from "../lib/i18n";
import { homeText } from "../lib/homeLocale";
import { getServerTabs, getServerVersionLabel } from "../lib/gameAdapter";
import { serverTypeLabel } from "../lib/serverEdition";
import { Icon } from "./Icon";
import { ServerIcon } from "./ServerIcon";

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
  const stateLabels = { running: t("running"), starting: t("starting"), stopping: t("stopping"), stopped: t("stopped"), crashed: t("crashed") };
  const hasExtensions = getServerTabs(selected).includes("extensions");
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
        <div><Icon name="users" size={19} /><span><strong>{statuses[selected.id] ? `${statuses[selected.id].playerCount} / ${statuses[selected.id].maxPlayers}` : "—"}</strong><small>{t("players")}</small></span></div>
        <button type="button" onClick={onCopyAddress} disabled={!statuses[selected.id]?.address} title={statuses[selected.id]?.address} aria-label={statuses[selected.id]?.address ?? t("loadingServers")}><Icon name="clipboard" size={19} /><span><strong>{statuses[selected.id]?.address ?? "—"}</strong><small>{selected.port} · {selected.serverType === "palworld" || selected.serverType === "bedrock" ? "UDP" : "TCP"}</small></span></button>
      </div>
      <button type="button" className="home-invite" onClick={onInvite}><Icon name="invite" size={28} /><span><strong>{text.invite}</strong><small>{text.inviteDetail}</small></span><Icon name="chevron" /></button>
      <div className="home-inspector-links"><button className="secondary-button" type="button" onClick={() => onNavigate("console")}><Icon name="console" />{t("console")}<Icon name="chevron" size={17} /></button><button className="secondary-button" type="button" onClick={() => onNavigate("settings")}><Icon name="gear" />{t("settings")}</button></div>
    </aside>
  </section>;
}
