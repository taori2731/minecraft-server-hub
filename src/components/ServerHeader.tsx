import type { RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { useI18n } from "../lib/i18n";
import { serverTypeLabel } from "../lib/serverEdition";
import { ServerIcon } from "./ServerIcon";
import { getNetworkProtocolForServerType, getServerVersionLabel, isPalworldServer } from "../lib/gameAdapter";

interface Props {
  server: ServerProfile;
  serverIcon?: string;
  status: RuntimeStatus;
  busyAction: string;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  compact?: boolean;
}

export function ServerHeader({ server, serverIcon, status, busyAction, onStart, onStop, onRestart, compact = false }: Props) {
  const { t } = useI18n();
  const stateText = { running: t("running"), starting: t("starting"), stopping: t("stopping"), restarting: t("restarting"), stopped: t("stopped"), crashed: t("crashed"), error: t("crashed"), unknown: "—" } as const;
  const active = status.state === "running" || status.state === "starting";
  const transitioning = status.state === "starting" || status.state === "stopping" || status.state === "restarting";
  const visibleBuild = server.serverType === "bedrock" || isPalworldServer(server) ? "" : server.distributionBuild ? ` build ${server.distributionBuild}` : "";
  return (
    <section className={`server-hero${compact ? " compact" : ""}`}>
      <ServerIcon source={serverIcon} className="server-art" />
      <div className="server-heading">
        <h1>{server.name}</h1>
        <p>{serverTypeLabel[server.serverType]} / {getServerVersionLabel(server)}{visibleBuild}{getNetworkProtocolForServerType(server.serverType) === "udp" ? " · UDP" : ""}</p>
        <span className={`hero-status ${status.state}`}><i />{stateText[status.state]}</span>
      </div>
      <div className="server-actions" aria-label={t("serverActions")}>
        <button type="button" className="action-button start" disabled={active || transitioning || status.state === "unknown" || Boolean(busyAction)} onClick={onStart}><Icon name="play" />{busyAction === "start" ? t("starting") : t("start")}</button>
        <button type="button" className="action-button stop" disabled={!active || transitioning || Boolean(busyAction)} onClick={onStop}><Icon name="stop" />{busyAction === "stop" ? t("stopping") : t("stop")}</button>
        <button type="button" className="action-button restart" disabled={status.state !== "running" || transitioning || Boolean(busyAction)} onClick={onRestart}><Icon name="refresh" />{busyAction === "restart" ? t("restarting") : t("restart")}</button>
      </div>
    </section>
  );
}
