import type { RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { useI18n } from "../lib/i18n";
import { palworldText } from "../lib/palworldLocale";

export function PalworldPlayersTab({ server, status }: { server: ServerProfile; status: RuntimeStatus }) {
  const { locale, t } = useI18n();
  const pw = (key: Parameters<typeof palworldText>[1]) => palworldText(locale, key);
  const players = status.palworld?.players ?? [];
  return <div className="tab-content palworld-players-content">
    <section className="feature-panel palworld-player-panel">
      <header><div><span className="section-kicker">PALWORLD · ONLINE NOW</span><h2>{t("players")}</h2><p>{pw("monitoringDescription")}</p></div><span className="status-pill on">{players.length}</span></header>
      <p className="privacy-note"><Icon name="info" size={16} />{pw("playerIpHidden")}</p>
      <div className="palworld-player-list">
        {players.map((player) => <article key={`${player.playerId}-${player.userId}`}>
          <span className="access-avatar whitelist"><Icon name="users" size={19} /></span>
          <div><strong>{player.name || player.accountName || "Palworld player"}</strong><small>{player.accountName && player.accountName !== player.name ? player.accountName : "Palworld"}</small></div>
          <dl><div><dt>{pw("levelLabel")}</dt><dd>{player.level}</dd></div><div><dt>{pw("pingLabel")}</dt><dd>{player.ping} ms</dd></div><div><dt>{pw("buildingsLabel")}</dt><dd>{player.buildingCount}</dd></div></dl>
        </article>)}
        {players.length === 0 ? <div className="panel-empty compact"><p>{status.state === "running" ? pw("noPlayers") : `${server.name} · ${pw("statusStopped")}`}</p></div> : null}
      </div>
    </section>
  </div>;
}
