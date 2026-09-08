import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./components/Icon";
import { OverviewTab } from "./components/OverviewTab";
import { OperationOverlay } from "./components/OperationOverlay";
import { monitoringWarnings, readMonitoring } from "./components/ProOperationsPanel";
import { ServerHeader } from "./components/ServerHeader";
import { Sidebar } from "./components/Sidebar";
import { backend, confirmDanger, selectLogDestination } from "./lib/backend";
import { ExternalLinkHandler } from "./components/ExternalLinkHandler";
import { I18nProvider, useI18n } from "./lib/i18n";
import { customAccentStyle, readAppearance } from "./lib/appearance";
import { readServerIcons, storeServerIcons, withServerIcon, type ServerIconMap } from "./lib/serverIcons";
import { getDefaultPortForServerType, getServerMaxPlayers, getServerTabs, isPalworldServer } from "./lib/gameAdapter";
import { palworldText } from "./lib/palworldLocale";
import { readAppUpdatePreferences } from "./lib/appUpdate";
import { appUpdateText } from "./lib/appUpdateLocale";
import type { AppearanceSettings, DeleteServerResult, LogEntry, MonitoringSettings, RuntimeStatus, ServerProfile, TabId, ThemeMode } from "./types";

const ConsoleTab = lazy(() => import("./components/ConsoleTab").then((module) => ({ default: module.ConsoleTab })));
const AppSettingsDialog = lazy(() => import("./components/AppSettingsDialog").then((module) => ({ default: module.AppSettingsDialog })));
const CreateServerWizard = lazy(() => import("./components/CreateServerWizard").then((module) => ({ default: module.CreateServerWizard })));
const DeleteServerDialog = lazy(() => import("./components/DeleteServerDialog").then((module) => ({ default: module.DeleteServerDialog })));
const ExtensionsTab = lazy(() => import("./components/ExtensionsTab").then((module) => ({ default: module.ExtensionsTab })));
const PlayerAccessTab = lazy(() => import("./components/FilesPlayersTab").then((module) => ({ default: module.PlayerAccessTab })));
const ServerFilesTab = lazy(() => import("./components/FilesPlayersTab").then((module) => ({ default: module.ServerFilesTab })));
const InviteDialog = lazy(() => import("./components/InviteDialog").then((module) => ({ default: module.InviteDialog })));
const PalworldInviteDialog = lazy(() => import("./components/PalworldInviteDialog").then((module) => ({ default: module.PalworldInviteDialog })));
const CrossplayInviteDialog = lazy(() => import("./components/CrossplayInviteDialog").then((module) => ({ default: module.CrossplayInviteDialog })));
const ImportServerWizard = lazy(() => import("./components/ImportServerWizard").then((module) => ({ default: module.ImportServerWizard })));
const SettingsTab = lazy(() => import("./components/SettingsTab").then((module) => ({ default: module.SettingsTab })));
const ServerLabTab = lazy(() => import("./components/ServerLabTab").then((module) => ({ default: module.ServerLabTab })));
const SafetyToolsTab = lazy(() => import("./components/SafetyToolsTab").then((module) => ({ default: module.SafetyToolsTab })));
const OperationsCenterTab = lazy(() => import("./components/OperationsCenterTab").then((module) => ({ default: module.OperationsCenterTab })));
const PalworldOverviewTab = lazy(() => import("./components/PalworldOverviewTab").then((module) => ({ default: module.PalworldOverviewTab })));
const PalworldPlayersTab = lazy(() => import("./components/PalworldPlayersTab").then((module) => ({ default: module.PalworldPlayersTab })));
const PalworldSettingsTab = lazy(() => import("./components/PalworldSettingsTab").then((module) => ({ default: module.PalworldSettingsTab })));
const CoManagementDialog = lazy(() => import("./components/CoManagementDialog").then((module) => ({ default: module.CoManagementDialog })));

function preloadTabModule(tab: TabId, palworld: boolean) {
  if (tab === "console") return import("./components/ConsoleTab");
  if (tab === "overview" && palworld) return import("./components/PalworldOverviewTab");
  if (tab === "players") return palworld ? import("./components/PalworldPlayersTab") : import("./components/FilesPlayersTab");
  if (tab === "files") return import("./components/FilesPlayersTab");
  if (tab === "extensions") return import("./components/ExtensionsTab");
  if (tab === "operations") return import("./components/OperationsCenterTab");
  if (tab === "lab") return import("./components/ServerLabTab");
  if (tab === "safety") return import("./components/SafetyToolsTab");
  if (tab === "settings") return palworld ? import("./components/PalworldSettingsTab") : import("./components/SettingsTab");
  return Promise.resolve();
}

const stoppedStatus = (server?: ServerProfile): RuntimeStatus => ({
  state: "stopped",
  playerCount: 0,
  maxPlayers: server ? getServerMaxPlayers(server) : 20,
  onlinePlayers: [],
  memoryUsedMib: 0,
  uptimeSeconds: 0,
  address: `localhost:${server?.port ?? getDefaultPortForServerType(server?.serverType ?? "paper")}`,
  cpuPercent: 0,
  tps: null,
  tpsSupported: server?.serverType === "paper" || server?.serverType === "vanilla",
  pingLatencyMs: null,
});

const sameStatus = (left?: RuntimeStatus, right?: RuntimeStatus) => Boolean(left && right
  && left.state === right.state
  && left.playerCount === right.playerCount
  && left.maxPlayers === right.maxPlayers
  && (left.onlinePlayers ?? []).join("\0") === (right.onlinePlayers ?? []).join("\0")
  && left.memoryUsedMib === right.memoryUsedMib
  && left.uptimeSeconds === right.uptimeSeconds
  && left.address === right.address
  && left.cpuPercent === right.cpuPercent
  && left.tps === right.tps
  && left.tpsSupported === right.tpsSupported
  && left.pingLatencyMs === right.pingLatencyMs
  && JSON.stringify(left.palworld ?? null) === JSON.stringify(right.palworld ?? null));

const sameLogs = (left: LogEntry[], right: LogEntry[]) => left.length === right.length
  && left.every((item, index) => item.timestamp === right[index]?.timestamp && item.level === right[index]?.level && item.message === right[index]?.message);

function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("server-hub:theme:v1");
    return saved === "dark" || saved === "light" || saved === "system" ? saved : "system";
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const [appearance, setAppearance] = useState<AppearanceSettings>(readAppearance);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => localStorage.setItem("server-hub:theme:v1", mode), [mode]);
  const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;
  return { mode, resolved, appearance, setAppearance, cycle: () => setMode((current) => current === "system" ? "dark" : current === "dark" ? "light" : "system") };
}

export function AppContent() {
  const theme = useTheme();
  const { locale, t } = useI18n();
  const tabs: { id: TabId; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
    { id: "overview", label: t("overview"), icon: "chart" },
    { id: "console", label: t("console"), icon: "console" },
    { id: "players", label: t("players"), icon: "users" },
    { id: "files", label: t("files"), icon: "folder" },
    { id: "extensions", label: t("extensions"), icon: "plugin" },
    { id: "operations", label: "自動運用", icon: "clock" },
    { id: "lab", label: t("lab"), icon: "memory" },
    { id: "safety", label: t("safety"), icon: "check" },
    { id: "settings", label: t("settings"), icon: "gear" },
  ];
  const [servers, setServers] = useState<ServerProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [statuses, setStatuses] = useState<Record<string, RuntimeStatus>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showWizard, setShowWizard] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showCrossplayInvite, setShowCrossplayInvite] = useState(false);
  const [showCoManagement, setShowCoManagement] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServerProfile>();
  const [busyAction, setBusyAction] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [monitoring, setMonitoring] = useState<MonitoringSettings>(readMonitoring);
  const [serverIcons, setServerIcons] = useState<ServerIconMap>(readServerIcons);
  const deliveredWarnings = useRef(new Set<string>());
  const closePromptOpen = useRef(false);
  const startupUpdateChecked = useRef(false);

  const coRequestsInFlight = useRef(new Set<string>());

  const selected = useMemo(() => servers.find((server) => server.id === selectedId), [servers, selectedId]);
  const selectedStatus = selected ? statuses[selected.id] ?? stoppedStatus(selected) : stoppedStatus();
  const selectedIsPalworld = Boolean(selected && isPalworldServer(selected));
  const visibleTabs = useMemo(() => selected ? tabs.filter((tab) => getServerTabs(selected).includes(tab.id)) : tabs, [selected, tabs]);
  const updateServer = useCallback((updated: ServerProfile) => setServers((current) => current.map((item) => item.id === updated.id ? updated : item)), []);
  const updateServerIcon = useCallback((serverId: string, dataUrl?: string) => {
    const next = withServerIcon(serverIcons, serverId, dataUrl);
    storeServerIcons(next);
    setServerIcons(next);
  }, [serverIcons]);

  useEffect(() => {
    if (selected && !visibleTabs.some((tab) => tab.id === activeTab)) setActiveTab("overview");
  }, [activeTab, selected, visibleTabs]);

  const refreshServers = useCallback(async () => {
    const items = await backend.listServers();
    setServers(items);
    setSelectedId((current) => current && items.some((server) => server.id === current) ? current : items[0]?.id);
  }, []);

  useEffect(() => {
    refreshServers().catch((reason: unknown) => setError(String(reason))).finally(() => setLoading(false));
  }, [refreshServers]);

  useEffect(() => {
    if (startupUpdateChecked.current) return;
    startupUpdateChecked.current = true;
    const preferences = readAppUpdatePreferences();
    if (!preferences.autoCheck || !backend.isDesktop) return;
    backend.checkAppUpdate(preferences.endpoint)
      .then((info) => {
        if (info.available && info.version) setToast(appUpdateText(locale, "startupAvailable", { version: info.version }));
      })
      .catch(() => undefined);
  }, [locale]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await backend.status(selectedId);
        if (active) setStatuses((current) => sameStatus(current[selectedId], next) ? current : { ...current, [selectedId]: next });
      } finally { refreshing = false; }
    };
    refresh().catch(() => undefined);
    const interval = ["running", "starting"].includes(selectedStatus.state) ? 1_000 : 3_000;
    const timer = window.setInterval(() => refresh().catch(() => undefined), interval);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedId, selectedStatus.state]);

  useEffect(() => {
    const background = servers.filter((server) => server.id !== selectedId);
    if (background.length === 0) return;
    let active = true;
    const refresh = async () => {
      const results = await Promise.all(background.map(async (server) => [server.id, await backend.status(server.id)] as const));
      if (!active) return;
      setStatuses((current) => {
        if (results.every(([id, status]) => sameStatus(current[id], status))) return current;
        return { ...current, ...Object.fromEntries(results) };
      });
    };
    refresh().catch(() => undefined);
    const timer = window.setInterval(() => refresh().catch(() => undefined), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [servers, selectedId]);

  useEffect(() => {
    if (!selectedId) { setLogs([]); return; }
    let active = true;
    const refresh = () => backend.logs(selectedId).then((entries) => active && setLogs((current) => sameLogs(current, entries) ? current : entries)).catch(() => undefined);
    refresh();
    const shouldPoll = selectedStatus.state === "running" && (activeTab === "overview" || activeTab === "console");
    const timer = shouldPoll ? window.setInterval(refresh, 2_000) : undefined;
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedId, selectedStatus.state, activeTab]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2_600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const update = () => setMonitoring(readMonitoring());
    window.addEventListener("server-hub:monitoring-settings-changed", update);
    return () => window.removeEventListener("server-hub:monitoring-settings-changed", update);
  }, []);

  useEffect(() => {
    const currentWarnings = new Set(monitoringWarnings(servers, statuses, monitoring));
    const newWarning = [...currentWarnings].find((warning) => !deliveredWarnings.current.has(warning));
    deliveredWarnings.current = currentWarnings;
    if (newWarning) setToast(`監視通知: ${newWarning}`);
  }, [monitoring, servers, statuses]);

  useEffect(() => {
    if (!backend.isDesktop) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => listen<{ title: string; body: string }>("local-notification", async ({ payload }) => {
      try {
        const notifications = await import("@tauri-apps/plugin-notification");
        let allowed = await notifications.isPermissionGranted();
        if (!allowed) allowed = (await notifications.requestPermission()) === "granted";
        if (allowed) notifications.sendNotification({ title: payload.title, body: payload.body });
      } catch { /* The in-app status remains available when Windows notifications are disabled. */ }
    })).then((dispose) => { unlisten = dispose; }).catch(() => undefined);
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!backend.isDesktop) return;
    let active = true;
    const respondToRequest = async (event: { serverId: string; eventType: string; payload: Record<string, unknown> }) => {
      if (event.eventType === "participant.pending") {
        window.dispatchEvent(new CustomEvent("server-hub:co-management-pending", { detail: event.payload }));
        return;
      }
      const requestId = typeof event.payload.requestId === "string" ? event.payload.requestId : "";
      const operationId = typeof event.payload.operationId === "string" ? event.payload.operationId : "";
      if (!requestId || coRequestsInFlight.current.has(requestId)) return;
      coRequestsInFlight.current.add(requestId);
      const serverId = typeof event.payload.serverId === "string" ? event.payload.serverId : event.serverId;
      const participantId = typeof event.payload.participantId === "string" ? event.payload.participantId : "";
      try {
        if (event.eventType === "summary.get") {
          const snapshot = await backend.coManagementSnapshot(serverId);
          const { enabled: _enabled, connectionState: _connectionState, participants: _participants, invites: _invites, ...safeSnapshot } = snapshot;
          await backend.respondCoManagementRequest({ serverId, requestId, ok: true, result: safeSnapshot });
        } else if (event.eventType === "settings.get" && participantId) {
          const settings = await backend.coManagementSettings({ serverId, participantId });
          await backend.respondCoManagementRequest({ serverId, requestId, ok: true, result: settings });
        } else if (event.eventType === "settings.patch" && participantId) {
          if (!operationId) throw new Error("missing operationId");
          const changes = event.payload.changes;
          if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("invalid changes");
          const expectedRevision = typeof event.payload.expectedRevision === "number" ? event.payload.expectedRevision : 0;
          const role = event.payload.role === "editor" ? "editor" : "viewer";
          const result = await backend.applyCoManagementSettings({ serverId, participantId, role, requestId: operationId, expectedRevision, changes: changes as Record<string, string | number | boolean> });
          await backend.respondCoManagementRequest({ serverId, requestId, ok: true, result });
        } else if (event.eventType === "audit.get" && participantId) {
          const entries = await backend.coManagementAudit(serverId, participantId);
          await backend.respondCoManagementRequest({ serverId, requestId, ok: true, result: entries });
        } else if (event.eventType === "operation.get" && participantId) {
          if (!operationId) throw new Error("missing operationId");
          const result = await backend.coManagementOperation(serverId, participantId, operationId);
          await backend.respondCoManagementRequest({ serverId, requestId, ok: true, result });
        }
      } catch (reason) {
        const text = String(reason);
        const errorCode = text.includes("409 Conflict") || text.includes("revision") ? "conflict" : text.includes("権限") || text.includes("editor") ? "forbidden" : "operation-failed";
        await backend.respondCoManagementRequest({ serverId, requestId, ok: false, errorCode, errorMessage: text }).catch(() => undefined);
      } finally {
        coRequestsInFlight.current.delete(requestId);
      }
    };
    const poll = async () => {
      if (!active) return;
      try {
        const events = await backend.pollCoManagementEvents();
        await Promise.all(events.map((event) => respondToRequest(event)));
      } catch { /* A disconnected relay is represented in the co-management dialog. */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 700);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!backend.isDesktop || servers.length === 0) return;
    let active = true;
    const publish = () => {
      if (!active) return;
      void Promise.all(servers.map((server) => backend.publishCoManagementSnapshot(server.id).catch(() => undefined)));
    };
    publish();
    const timer = window.setInterval(publish, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [servers]);

  useEffect(() => {
    if (!backend.isDesktop) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => listen("app-close-requested", async () => {
      if (!active || closePromptOpen.current) return;
      closePromptOpen.current = true;
      try {
        const confirmed = await confirmDanger("Minecraft Server Hubを終了しますか？\n\n起動中のサーバーがある場合は、先に安全停止してください。");
        if (confirmed) await backend.quitApp();
      } catch (reason) {
        if (active) setError(String(reason));
      } finally {
        closePromptOpen.current = false;
      }
    })).then((dispose) => { unlisten = dispose; }).catch(() => undefined);
    return () => { active = false; unlisten?.(); };
  }, []);

  const runAction = async (name: "start" | "stop" | "restart") => {
    if (!selected) return;
    setBusyAction(name);
    setError("");
    try {
      if (name === "start") await backend.start(selected.id);
      if (name === "stop") await backend.stop(selected.id);
      if (name === "restart") await backend.restart(selected.id);
      const nextStatus = await backend.status(selected.id);
      setStatuses((current) => ({ ...current, [selected.id]: nextStatus }));
      setToast(name === "start" ? "サーバーを起動しました" : name === "stop" ? "サーバーを安全に停止しました" : "サーバーを再起動しました");
    } catch (reason) {
      const message = String(reason);
      if (message.includes("強制終了") && await confirmDanger(`${message}\n\nワールド破損の可能性があります。強制終了しますか？`)) {
        await backend.stop(selected.id, true);
        setToast("サーバーを強制終了しました");
      } else {
        setError(message);
      }
    } finally {
      setBusyAction("");
    }
  };

  const copy = async (value: string, message = "コピーしました") => {
    await navigator.clipboard.writeText(value);
    setToast(message);
  };

  const sendCommand = async (command: string) => {
    if (!selected) return;
    const dangerous = /^(stop|op\s|deop\s|ban\s|pardon\s|whitelist\s+off|save-off|reload)/i.test(command);
    if (dangerous && !await confirmDanger(`「${command}」を実行しますか？\nこのコマンドはサーバー状態や権限を変更します。`)) return;
    await backend.sendCommand(selected.id, command);
    setToast("コマンドを送信しました");
  };

  const saveLogs = async () => {
    if (!selected) return;
    const destination = await selectLogDestination(`${selected.name}-${new Date().toISOString().slice(0, 10)}.log`);
    if (!destination) return;
    await backend.saveLogs(selected.id, destination);
    setToast("ログを保存しました");
  };

  return (
    <div className="app" data-theme={theme.resolved} data-accent={theme.appearance.accent} data-icon-scale={theme.appearance.iconScale} style={customAccentStyle(theme.appearance)}>
      <ExternalLinkHandler onError={setError} />
      <header className="titlebar">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
        <strong>Minecraft Server Hub</strong>
        <span className="unofficial-label">{t("unofficial")}</span>
        <div className="titlebar-actions">
          {selected?.serverType === "paper" ? <button className="top-button ghost crossplay-invite-button" type="button" onClick={() => setShowCrossplayInvite(true)}><Icon name="users" />{t("inviteBedrock")}</button> : null}
          <button className="top-button ghost" type="button" onClick={() => selected ? setShowCoManagement(true) : setToast(t("selectServerFirst"))}><Icon name="users" />共同管理</button>
          <button className="top-button ghost" type="button" onClick={() => selected ? setShowInvite(true) : setToast(t("selectServerFirst"))}><Icon name="invite" />{t("inviteFriends")}</button>
          <button className="icon-button theme-button" type="button" onClick={theme.cycle} aria-label={`${t("theme")}: ${theme.mode}`} title={`${t("theme")}: ${theme.mode}`}><Icon name={theme.resolved === "dark" ? "moon" : "sun"} /></button>
          <button className="top-button ghost import-button" type="button" onClick={() => setShowImport(true)}><Icon name="download" />{t("importServer")}</button>
          <button className="top-button create" type="button" onClick={() => setShowWizard(true)}><Icon name="add" />{t("newServer")}</button>
        </div>
      </header>

      <div className="app-body">
        <Sidebar servers={servers} serverIcons={serverIcons} selectedId={selectedId} statuses={statuses} onSelect={(id) => { setSelectedId(id); setActiveTab("overview"); }} onCreate={() => setShowWizard(true)} onImport={() => setShowImport(true)} onDelete={setDeleteTarget} onAppSettings={() => setShowAppSettings(true)} />
        <main className="workspace">
          {loading ? <div className="center-state"><span className="spinner" /><strong>{t("loadingServers")}</strong></div> : null}
          {!loading && !selected ? <div className="center-state empty"><img src="/assets/voxel-server-island.png" alt="" /><h1>{t("firstServerTitle")}</h1><p>{t("firstServerBody")}</p><button className="primary-button" type="button" onClick={() => setShowWizard(true)}><Icon name="add" />{t("newServer")}</button></div> : null}
          {selected ? (
            <>
              <ServerHeader server={selected} serverIcon={serverIcons[selected.id]} status={selectedStatus} busyAction={busyAction} onStart={() => runAction("start")} onStop={() => runAction("stop")} onRestart={() => runAction("restart")} />
              <nav className="tabs" aria-label={t("serverDetails")}>
                {visibleTabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onMouseEnter={() => void preloadTabModule(tab.id, selectedIsPalworld)} onFocus={() => void preloadTabModule(tab.id, selectedIsPalworld)} onClick={() => setActiveTab(tab.id)}><Icon name={tab.icon} />{tab.label}</button>)}
              </nav>
              <Suspense fallback={<div className="center-state tab-loading" role="status"><span className="spinner" /><strong>{t("loadingServers")}</strong></div>}>
                {activeTab === "overview" ? selectedIsPalworld
                  ? <PalworldOverviewTab server={selected} status={selectedStatus} onCopyAddress={() => copy(selectedStatus.address)} notify={setToast} fail={setError} />
                  : <OverviewTab server={selected} status={selectedStatus} logs={logs} onCopyAddress={() => copy(selectedStatus.address, "サーバーアドレスをコピーしました")} onOpenFolder={() => backend.openFolder(selected.id)} onUpdated={updateServer} notify={setToast} fail={setError} onNavigate={setActiveTab} onInvite={() => setShowInvite(true)} /> : null}
                {activeTab === "console" ? <ConsoleTab logs={logs} running={selectedStatus.state === "running"} onClear={() => { backend.clearLogs(selected.id); setLogs([]); }} onCopy={(value) => copy(value)} onSave={saveLogs} onCommand={sendCommand} commandsEnabled={!selectedIsPalworld} commandUnavailableMessage={selectedIsPalworld ? palworldText(locale, "readOnlyLogs") : undefined} /> : null}
                {activeTab === "players" ? selectedIsPalworld ? <PalworldPlayersTab server={selected} status={selectedStatus} /> : <PlayerAccessTab server={selected} status={selectedStatus} notify={setToast} fail={setError} /> : null}
                {!selectedIsPalworld && activeTab === "files" ? <ServerFilesTab server={selected} /> : null}
                {!selectedIsPalworld && activeTab === "extensions" ? <ExtensionsTab server={selected} status={selectedStatus} notify={setToast} fail={setError} /> : null}
                {activeTab === "operations" ? <OperationsCenterTab key={selected.id} server={selected} status={selectedStatus} onUpdated={updateServer} notify={setToast} fail={setError} /> : null}
                {!selectedIsPalworld && activeTab === "lab" ? <ServerLabTab server={selected} status={selectedStatus} onUpdated={updateServer} notify={setToast} fail={setError} /> : null}
                {!selectedIsPalworld && activeTab === "safety" ? <SafetyToolsTab server={selected} status={selectedStatus} onUpdated={updateServer} notify={setToast} fail={setError} /> : null}
                {activeTab === "settings" ? selectedIsPalworld ? <PalworldSettingsTab server={selected} status={selectedStatus} onUpdated={updateServer} notify={setToast} fail={setError} /> : <SettingsTab server={selected} serverIcon={serverIcons[selected.id]} onServerIconChanged={updateServerIcon} status={selectedStatus} onUpdated={updateServer} notify={setToast} fail={setError} /> : null}
              </Suspense>
            </>
          ) : null}
        </main>
      </div>

      <Suspense fallback={null}>
      {showWizard ? <CreateServerWizard isFirstServer={servers.length === 0} onClose={() => setShowWizard(false)} onCreated={(server) => { setServers((current) => [...current, server]); setSelectedId(server.id); setActiveTab("overview"); setShowWizard(false); setToast("サーバーを作成しました"); }} /> : null}
      {showImport ? <ImportServerWizard onClose={() => setShowImport(false)} onImported={(server) => { setServers((current) => [...current, server]); setSelectedId(server.id); setActiveTab("overview"); setShowImport(false); setToast("既存サーバーを読み取り登録しました"); }} /> : null}
      {showInvite && selected ? selectedIsPalworld ? <PalworldInviteDialog key={selected.id} server={selected} onClose={() => setShowInvite(false)} notify={setToast} /> : <InviteDialog server={selected} status={selectedStatus} onClose={() => setShowInvite(false)} notify={setToast} /> : null}
      {showCrossplayInvite && selected?.serverType === "paper" ? <CrossplayInviteDialog server={selected} status={selectedStatus} onClose={() => setShowCrossplayInvite(false)} notify={setToast} /> : null}
      {showCoManagement && selected ? <CoManagementDialog server={selected} status={selectedStatus} onClose={() => setShowCoManagement(false)} notify={setToast} fail={setError} /> : null}
      {showAppSettings ? <AppSettingsDialog server={selected} status={selected ? selectedStatus : undefined} servers={servers} statuses={statuses} onStatusesChanged={(values) => setStatuses((current) => ({ ...current, ...values }))} onAppearanceChanged={theme.setAppearance} onClose={() => setShowAppSettings(false)} notify={setToast} fail={setError} /> : null}
      {deleteTarget ? <DeleteServerDialog server={deleteTarget} status={statuses[deleteTarget.id] ?? stoppedStatus(deleteTarget)} onClose={() => setDeleteTarget(undefined)} fail={setError} onDeleted={(result: DeleteServerResult) => {
        const next = servers.filter((item) => item.id !== deleteTarget.id);
        setServers(next);
        setStatuses((current) => { const updated = { ...current }; delete updated[deleteTarget.id]; return updated; });
        try { updateServerIcon(deleteTarget.id, undefined); } catch { /* Registration deletion must not fail because local appearance storage is unavailable. */ }
        if (selectedId === deleteTarget.id) { setSelectedId(next[0]?.id); setActiveTab("overview"); }
        setDeleteTarget(undefined);
        setToast(result.deletedFiles ? "最終バックアップを作成し、サーバーフォルダーを削除しました" : "サーバーを一覧から外しました（ファイルは残っています）");
      }} /> : null}
      </Suspense>
      {error ? <div className="global-error" role="alert"><Icon name="info" /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="エラーを閉じる"><Icon name="close" size={18} /></button></div> : null}
      {toast ? <div className="toast" role="status"><Icon name="check" size={18} />{toast}</div> : null}
      {busyAction ? <OperationOverlay
        title={selectedIsPalworld ? busyAction === "stop" ? palworldText(locale, "safeShutdownSaving") : palworldText(locale, "statusStarting") : busyAction === "start" ? "サーバーを起動しています" : busyAction === "stop" ? "サーバーを安全に停止しています" : "サーバーを再起動しています"}
        detail={selectedIsPalworld ? palworldText(locale, busyAction === "stop" ? "safeShutdownDescription" : "phasePw1Description") : "プロセスとポートの状態を確認しています。ワールドの読み込みや保存には時間がかかる場合があります。"}
        stages={selectedIsPalworld ? busyAction === "stop" ? [palworldText(locale, "safeShutdownSaving"), palworldText(locale, "safeShutdownRequesting"), palworldText(locale, "safeShutdownWaiting")] : [palworldText(locale, "statusInstallingSteamCmd"), palworldText(locale, "statusPreparing"), palworldText(locale, "statusStarting")] : busyAction === "stop" ? ["保存要求", "停止確認", "状態更新"] : ["起動要求", "待受確認", "状態更新"]}
      /> : null}
    </div>
  );
}

export default function App() {
  return <I18nProvider><AppContent /></I18nProvider>;
}
