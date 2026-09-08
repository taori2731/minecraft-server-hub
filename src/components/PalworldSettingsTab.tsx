import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { useI18n } from "../lib/i18n";
import { palworldText } from "../lib/palworldLocale";
import { palworldSettingsText } from "../lib/palworldSettingsLocale";
import type { PalworldSettings, RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";

type Props = {
  server: ServerProfile;
  status: RuntimeStatus;
  onUpdated: (server: ServerProfile) => void;
  notify: (message: string) => void;
  fail: (message: string) => void;
};

const defaults: Required<PalworldSettings> = {
  serverDescription: "", maxPlayers: 32, restApiPort: 8212, restApiEnabled: true, backupEnabled: true,
  joinCodeConfigured: false, expRate: 1, collectionDropRate: 1, palCaptureRate: 1, dayTimeSpeedRate: 1,
  nightTimeSpeedRate: 1, palEggDefaultHatchingTime: 72, deathPenalty: "All", invaderEnemiesEnabled: true,
  fastTravelEnabled: true, playerListEnabled: true, joinLeaveMessagesEnabled: true, voiceChatEnabled: false,
  clientModsAllowed: false, baseCampMaxNumInGuild: 4, baseCampWorkerMaxNum: 15,
};

function normalize(settings?: PalworldSettings | null): Required<PalworldSettings> {
  return { ...defaults, ...settings, restApiEnabled: true };
}

export function PalworldSettingsTab({ server, status, onUpdated, notify, fail }: Props) {
  const { locale } = useI18n();
  const text = (key: Parameters<typeof palworldSettingsText>[1], values: Record<string, string | number> = {}) => palworldSettingsText(locale, key, values);
  const pw = (key: Parameters<typeof palworldText>[1]) => palworldText(locale, key);
  const [name, setName] = useState(server.name);
  const [gamePort, setGamePort] = useState(server.port);
  const [settings, setSettings] = useState(() => normalize(server.palworldSettings));
  const [joinPassword, setJoinPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [clearJoinPassword, setClearJoinPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [choosingPort, setChoosingPort] = useState<"game" | "rest" | "">("");
  const canEdit = status.state === "stopped" || status.state === "crashed";

  useEffect(() => {
    setName(server.name); setGamePort(server.port); setSettings(normalize(server.palworldSettings));
    setJoinPassword(""); setAdminPassword(""); setClearJoinPassword(false);
  }, [server]);

  const patch = <K extends keyof Required<PalworldSettings>>(key: K, value: Required<PalworldSettings>[K]) => setSettings((current) => ({ ...current, [key]: value }));

  const choosePort = async (kind: "game" | "rest") => {
    setChoosingPort(kind);
    try {
      const current = kind === "game" ? gamePort : settings.restApiPort;
      let selected = await backend.suggestServerPort(current || (kind === "game" ? 8211 : 8212), kind === "game" ? "udp" : "tcp");
      if (selected === (kind === "game" ? settings.restApiPort : gamePort)) selected = await backend.suggestServerPort(selected + 1, kind === "game" ? "udp" : "tcp");
      if (kind === "game") setGamePort(selected); else patch("restApiPort", selected);
      notify(text("portSelected", { port: selected }));
    } catch (reason) { fail(String(reason)); }
    finally { setChoosingPort(""); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await backend.updatePalworldSettings({
        serverId: server.id, name, gamePort, settings,
        serverPassword: clearJoinPassword ? "" : joinPassword || undefined,
        adminPassword: adminPassword || undefined,
      });
      onUpdated(updated); setSettings(normalize(updated.palworldSettings));
      setJoinPassword(""); setAdminPassword(""); setClearJoinPassword(false); notify(text("saved"));
    } catch (reason) { fail(String(reason)); }
    finally { setSaving(false); }
  };

  const portInvalid = gamePort < 1024 || gamePort > 65535 || settings.restApiPort < 1024 || settings.restApiPort > 65535 || gamePort === settings.restApiPort;
  const rates = [settings.expRate, settings.collectionDropRate, settings.palCaptureRate, settings.dayTimeSpeedRate, settings.nightTimeSpeedRate];
  const passwordInvalid = [joinPassword, adminPassword].some((value) => value.length > 64 || /[\u0000-\u001f\u007f"\\]/.test(value));
  const invalid = !name.trim() || name.trim().length > 64 || portInvalid || settings.maxPlayers < 1 || settings.maxPlayers > 32
    || rates.some((value) => !Number.isFinite(value) || value < 0.1 || value > 20)
    || !Number.isFinite(settings.palEggDefaultHatchingTime) || settings.palEggDefaultHatchingTime < 0 || settings.palEggDefaultHatchingTime > 240
    || settings.baseCampMaxNumInGuild < 1 || settings.baseCampMaxNumInGuild > 10
    || settings.baseCampWorkerMaxNum < 1 || settings.baseCampWorkerMaxNum > 50 || passwordInvalid;
  const numberField = (key: "expRate" | "collectionDropRate" | "palCaptureRate" | "dayTimeSpeedRate" | "nightTimeSpeedRate", label: Parameters<typeof palworldSettingsText>[1]) => (
    <label><span>{text(label)}</span><input aria-label={text(label)} type="number" min={0.1} max={20} step={0.1} value={settings[key]} disabled={!canEdit} onChange={(event) => patch(key, Number(event.target.value))} /><small>0.1–20.0</small></label>
  );

  return <div className="tab-content settings-content palworld-settings-content">
    <section className="feature-panel palworld-settings-editor">
      <header><div><span className="section-kicker">PALWORLD · SERVER SETTINGS</span><h2>{text("title")}</h2><p>{text("subtitle")}</p></div><span className="status-pill">{pw("localOnly")}</span></header>
      {!canEdit ? <p className="inline-warning palworld-stop-note"><Icon name="info" size={17} />{text("stoppedOnly")}</p> : null}

      <div className="property-section-heading"><div><span className="section-kicker">CONNECTION</span><h3>{text("basic")}</h3></div><small>{text("restart")}</small></div>
      <div className="palworld-editor-grid">
        <label><span>{text("serverName")}</span><input value={name} maxLength={64} disabled={!canEdit} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>{text("maxPlayers")}</span><input type="number" min={1} max={32} value={settings.maxPlayers} disabled={!canEdit} onChange={(event) => patch("maxPlayers", Number(event.target.value))} /><small>1–32</small></label>
        <label className="wide-field"><span>{text("description")}</span><input value={settings.serverDescription} maxLength={256} disabled={!canEdit} onChange={(event) => patch("serverDescription", event.target.value)} /></label>
        <label><span>{text("gamePort")}</span><div className="input-action"><input type="number" min={1024} max={65535} value={gamePort} disabled={!canEdit} onChange={(event) => setGamePort(Number(event.target.value))} /><button className="secondary-button" type="button" disabled={!canEdit || Boolean(choosingPort)} onClick={() => void choosePort("game")}>{choosingPort === "game" ? "…" : text("chooseFree")}</button></div></label>
        <label><span>{text("restPort")}</span><div className="input-action"><input type="number" min={1024} max={65535} value={settings.restApiPort} disabled={!canEdit} onChange={(event) => patch("restApiPort", Number(event.target.value))} /><button className="secondary-button" type="button" disabled={!canEdit || Boolean(choosingPort)} onClick={() => void choosePort("rest")}>{choosingPort === "rest" ? "…" : text("chooseFree")}</button></div></label>
      </div>

      <div className="property-section-heading"><div><span className="section-kicker">ACCESS</span><h3>{text("access")}</h3></div><small>{text("secretHelp")}</small></div>
      <div className="palworld-editor-grid">
        <label><span>{text("joinPassword")} <b className="field-status">{settings.joinCodeConfigured ? text("joinConfigured") : text("joinNotConfigured")}</b></span><input aria-label={text("joinPassword")} type="password" autoComplete="new-password" value={joinPassword} placeholder={text("joinPlaceholder")} disabled={!canEdit || clearJoinPassword} onChange={(event) => setJoinPassword(event.target.value)} /></label>
        <label><span>{text("adminPassword")}</span><input aria-label={text("adminPassword")} type="password" autoComplete="new-password" value={adminPassword} placeholder={text("adminPlaceholder")} disabled={!canEdit} onChange={(event) => setAdminPassword(event.target.value)} /></label>
        <label className="palworld-checkbox wide-field"><input type="checkbox" checked={clearJoinPassword} disabled={!canEdit || !settings.joinCodeConfigured} onChange={(event) => { setClearJoinPassword(event.target.checked); if (event.target.checked) setJoinPassword(""); }} /><span>{text("clearJoin")}</span></label>
      </div>
      <div className="info-callout palworld-local-api-note"><Icon name="check" /><div><strong>{pw("credentialsTitle")}</strong><br />{pw("credentialsDescription")}</div></div>

      <div className="property-section-heading"><div><span className="section-kicker">BALANCE</span><h3>{text("balance")}</h3></div></div>
      <div className="palworld-editor-grid rate-grid">
        {numberField("expRate", "expRate")}{numberField("palCaptureRate", "captureRate")}{numberField("collectionDropRate", "dropRate")}
        {numberField("dayTimeSpeedRate", "daySpeed")}{numberField("nightTimeSpeedRate", "nightSpeed")}
        <label><span>{text("hatchingTime")}</span><input type="number" min={0} max={240} step={0.5} value={settings.palEggDefaultHatchingTime} disabled={!canEdit} onChange={(event) => patch("palEggDefaultHatchingTime", Number(event.target.value))} /><small>0–240</small></label>
      </div>

      <div className="property-section-heading"><div><span className="section-kicker">GAMEPLAY</span><h3>{text("gameplay")}</h3></div></div>
      <div className="palworld-editor-grid">
        <label><span>{text("deathPenalty")}</span><select value={settings.deathPenalty} disabled={!canEdit} onChange={(event) => patch("deathPenalty", event.target.value as Required<PalworldSettings>["deathPenalty"])}><option value="None">{text("deathNone")}</option><option value="Item">{text("deathItem")}</option><option value="ItemAndEquipment">{text("deathItemEquipment")}</option><option value="All">{text("deathAll")}</option></select></label>
        <label><span>{text("baseCamps")}</span><input type="number" min={1} max={10} value={settings.baseCampMaxNumInGuild} disabled={!canEdit} onChange={(event) => patch("baseCampMaxNumInGuild", Number(event.target.value))} /><small>1–10</small></label>
        <label><span>{text("baseWorkers")}</span><input type="number" min={1} max={50} value={settings.baseCampWorkerMaxNum} disabled={!canEdit} onChange={(event) => patch("baseCampWorkerMaxNum", Number(event.target.value))} /><small>1–50</small></label>
      </div>
      <div className="palworld-toggle-grid">
        {([ ["invaderEnemiesEnabled", "invasions"], ["fastTravelEnabled", "fastTravel"], ["playerListEnabled", "playerList"], ["joinLeaveMessagesEnabled", "joinLeave"], ["voiceChatEnabled", "voiceChat"], ["clientModsAllowed", "clientMods"], ["backupEnabled", "backup"] ] as const).map(([key, label]) => <label key={key}><span>{text(label)}</span><input type="checkbox" checked={settings[key]} disabled={!canEdit} onChange={(event) => patch(key, event.target.checked)} /><i aria-hidden="true" /></label>)}
      </div>
      <p className="inline-warning"><Icon name="info" size={16} />{pw("restNeverExpose")}</p>
      <footer><button className="secondary-button" type="button" onClick={() => backend.openFolder(server.id)}><Icon name="folder" size={17} />Palworld</button><button className="primary-button" type="button" disabled={!canEdit || invalid || saving || Boolean(choosingPort)} onClick={() => void save()}>{saving ? text("saving") : text("save")}</button></footer>
    </section>
    {saving ? <OperationOverlay title={text("saving")} detail={text("restart")} stages={[text("access"), text("basic"), text("save")]} /> : null}
  </div>;
}
