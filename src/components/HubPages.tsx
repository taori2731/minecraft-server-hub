import { useMemo, useState } from "react";
import type { AppSection, RuntimeStatus, ServerProfile, TabId } from "../types";
import { useI18n } from "../lib/i18n";
import { supportedCatalog, workspaceAnnouncements, workspaceText } from "../lib/workspaceLocale";
import { serverTemplates } from "../lib/templates";
import { serverTypeLabel } from "../lib/serverEdition";
import { getServerVersionLabel } from "../lib/gameAdapter";
import { Icon } from "./Icon";
import { ServerIcon } from "./ServerIcon";

type NavigateServer = (serverId: string, tab?: TabId) => void;

export function ServerDirectoryPage({ servers, statuses, serverIcons, onOpen, onCreate }: { servers: ServerProfile[]; statuses: Record<string, RuntimeStatus>; serverIcons: Record<string, string>; onOpen: NavigateServer; onCreate: () => void }) {
  const { locale, t } = useI18n(); const copy = workspaceText(locale);
  const stateText = { running: t("running"), starting: t("starting"), stopping: t("stopping"), restarting: t("restarting"), stopped: t("stopped"), crashed: t("crashed"), error: t("crashed"), unknown: "—" };
  return <div className="hub-page"><header className="hub-page-header"><div><span className="section-kicker">SERVER LIBRARY</span><h1>{copy.allServers}</h1><p>{t("serverDetails")}</p></div><button className="primary-button" onClick={onCreate}><Icon name="add" />{t("newServer")}</button></header><div className="hub-card-grid">
    {servers.map((server) => { const status = statuses[server.id]; const state = status?.state ?? "stopped"; return <button className="hub-server-card" key={server.id} onClick={() => onOpen(server.id)}><ServerIcon source={serverIcons[server.id]} /><span><strong>{server.name}</strong><small>{serverTypeLabel[server.serverType]} · {getServerVersionLabel(server)}</small><em className={`status-label ${state}`}><i />{stateText[state]} · {status?.playerCount ?? 0}/{status?.maxPlayers ?? server.settings.maxPlayers}</em></span><Icon name="chevron" /></button>; })}
  </div></div>;
}

export function TemplatesPage({ onUse }: { onUse: (templateId: string) => void }) {
  const { locale } = useI18n(); const copy = workspaceText(locale);
  return <div className="hub-page"><header className="hub-page-header"><div><span className="section-kicker">SERVER TEMPLATES</span><h1>{copy.templates}</h1><p>{copy.templateSubtitle}</p></div></header><div className="template-library">{serverTemplates.map((template) => <button key={template.id} onClick={() => onUse(template.id)}><Icon name="server" size={27}/><span><strong>{template.label}</strong><small>{template.detail}</small><em>{serverTypeLabel[template.serverType]} · {Math.round(template.maxMemoryMib / 1024)} GiB</em></span><Icon name="chevron" /></button>)}</div></div>;
}

export function DiscoverPage({ onCreate, onExtensions }: { onCreate: () => void; onExtensions: () => void }) {
  const { locale } = useI18n(); const copy = workspaceText(locale);
  return <div className="hub-page"><header className="hub-page-header"><div><span className="section-kicker">SUPPORTED CATALOG</span><h1>{copy.discover}</h1><p>{copy.discoverSubtitle}</p></div></header><div className="discover-library">{supportedCatalog(locale).map((item, index) => <button key={item.title} onClick={index === 3 ? onExtensions : onCreate}><Icon name={index === 1 ? "users" : index === 3 ? "plugin" : "server"} size={30}/><strong>{item.title}</strong><span>{item.detail}</span><Icon name="chevron" /></button>)}</div></div>;
}

export function NewsPage() {
  const { locale } = useI18n(); const copy = workspaceText(locale);
  const announcements = workspaceAnnouncements(locale);
  return <div className="hub-page"><header className="hub-page-header"><div><span className="section-kicker">LOCAL ANNOUNCEMENTS</span><h1>{copy.news}</h1><p>{copy.newsSubtitle}</p></div></header><div className="news-list">{announcements.map((item) => <article key={item.date + item.tag}><time>{item.date}</time><span>{item.tag}</span><div><h2>{item.title}</h2><p>{item.body}</p></div></article>)}</div></div>;
}

export function GlobalSearch({ servers, onOpenServer, onSection, onSettings }: { servers: ServerProfile[]; onOpenServer: NavigateServer; onSection: (section: AppSection) => void; onSettings: () => void }) {
  const { locale } = useI18n(); const copy = workspaceText(locale); const [query, setQuery] = useState(""); const normalized = query.trim().toLocaleLowerCase();
  const items = useMemo(() => [
    ...servers.map((server) => ({ id: `server-${server.id}`, label: server.name, detail: `${serverTypeLabel[server.serverType]} · ${getServerVersionLabel(server)}`, icon: "server" as const, action: () => onOpenServer(server.id) })),
    ...serverTemplates.map((template) => ({ id: `template-${template.id}`, label: template.label, detail: `${copy.templates} · ${template.detail}`, icon: "server" as const, action: () => onSection("templates") })),
    { id: "players", label: copy.players, detail: copy.feature, icon: "users" as const, action: () => onSection("players") },
    { id: "discover", label: copy.discover, detail: copy.feature, icon: "search" as const, action: () => onSection("discover") },
    { id: "news", label: copy.news, detail: copy.feature, icon: "info" as const, action: () => onSection("news") },
    { id: "settings", label: copy.settings, detail: copy.feature, icon: "gear" as const, action: onSettings },
  ].filter((item) => !normalized || `${item.label} ${item.detail}`.toLocaleLowerCase().includes(normalized)).slice(0, 8), [copy, normalized, onOpenServer, onSection, onSettings, servers]);
  const choose = (action: () => void) => { action(); setQuery(""); };
  return <div className="global-search"><label><Icon name="search" size={18}/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search}/>{query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear"><Icon name="close" size={15}/></button> : null}</label>{query ? <div className="global-search-results">{items.length ? items.map((item) => <button type="button" key={item.id} onClick={() => choose(item.action)}><Icon name={item.icon}/><span><strong>{item.label}</strong><small>{item.detail}</small></span><Icon name="chevron" size={16}/></button>) : <p>{copy.noResults}</p>}</div> : null}</div>;
}
