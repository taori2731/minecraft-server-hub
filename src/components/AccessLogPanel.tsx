import { useEffect, useMemo, useState } from "react";
import { backend } from "../lib/backend";
import { useI18n } from "../lib/i18n";
import { serverManagerText } from "../lib/serverManagerLocale";
import type { AuditEntry, ServerState } from "../types";
import { Icon } from "./Icon";

export function AccessLogPanel({ serverId, state }: { serverId: string; state: ServerState }) {
  const { locale } = useI18n();
  const sm = (key: Parameters<typeof serverManagerText>[1]) => serverManagerText(locale, key);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    backend.auditLog(serverId).then((items) => active && setEntries(items)).catch(() => active && setEntries([]));
    return () => { active = false; };
  }, [serverId, state]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return entries.filter((item) => `${item.action} ${item.detail} ${item.actor}`.toLocaleLowerCase().includes(normalized)).slice(0, 50);
  }, [entries, query]);

  return <section className="feature-panel access-log-panel" id="server-access-log"><header><div><span className="section-kicker">AUDIT TRAIL</span><h2>{sm("accessLog")}</h2></div><label className="search-field"><Icon name="search" size={17}/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={sm("searchAudit")} aria-label={sm("searchAudit")}/></label></header><div className="access-log-list">{visible.map((entry) => <article key={entry.id}><time>{new Date(entry.at).toLocaleString(locale)}</time><strong>{entry.action}</strong><span>{entry.detail}</span><small>{entry.actor}</small></article>)}{visible.length === 0 ? <div className="panel-empty compact"><p>{sm("noAudit")}</p></div> : null}</div></section>;
}
