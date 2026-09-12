import { invoke } from "@tauri-apps/api/core";
import type {
  CreateServerInput,
  CrossplayInstallInput,
  CrossplayInstallResult,
  CrossplayPlan,
  CrossplayStatus,
  CrossplayConfigurationResult,
  DeleteServerInput,
  DeleteServerResult,
  RegenerateWorldInput,
  AuditEntry,
  BackupInfo,
  BasicSettings,
  ExtensionInfo,
  ExtensionInstallPlan,
  ExtensionKind,
  ExtensionSearchHit,
  ExtensionVersionOption,
  FixedPlayerPreset,
  InviteInfo,
  InviteSettings,
  ImportPreview,
  ImportServerInput,
  InstallTunnelAgentInput,
  JavaDownloadPlan,
  JavaRuntime,
  LogEntry,
  ModpackProfile,
  NetworkProtocol,
  RuntimeStatus,
  SaveFixedPlayerInput,
  ServerDiagnosisReport,
  PcDiagnosis,
  PlayerAccessEntry,
  PlayerAccessKind,
  ProfileDiff,
  PublicAccessStatus,
  QuickStartTunnelInput,
  StartTunnelInput,
  TunnelAgentValidation,
  TunnelAgentInstallPlan,
  TunnelDiagnosis,
  TunnelExternalProbe,
  TunnelStatus,
  ValidateTunnelAgentInput,
  ServerProfile,
  ApplyServerUpdateInput,
  UpdateApplyResult,
  UpdateSafetyReport,
  UpdateInviteSettingsInput,
  UpdatePalworldSettingsInput,
  UpdatePlayerAccessInput,
  AutomationSettings,
  ExtensionCheckReport,
  MigrationExportResult,
  MigrationManifest,
  RestoreMigrationInput,
  UpdateCenterReport,
  ApplyManagedExtensionUpdateInput,
  AppUpdateInfo,
  VersionOption,
  WhitelistEntry,
  WorldRegenerationResult,
} from "../types";
import { isValidDeleteConfirmation } from "./deleteConfirmation";
import { getNetworkProtocolForServerType, getServerMaxPlayers, isPalworldServer } from "./gameAdapter";

const inDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const now = new Date().toISOString();
let demoServers: ServerProfile[] = [
  {
    id: "demo-paper",
    name: "Survival World",
    rootPath: "C:\\Servers\\Survival-World",
    gameKind: "minecraft",
    serverType: "paper",
    minecraftVersion: "1.21.11",
    distributionBuild: "48",
    launchTarget: "server.jar",
    javaPath: "C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe",
    javaMajor: 21,
    minMemoryMib: 1024,
    maxMemoryMib: 4096,
    port: 25565,
    eulaAcceptedAt: now,
    pendingRestart: false,
    settings: {
      defaultGameMode: "survival",
      difficulty: "normal",
      maxPlayers: 20,
      pvp: true,
      whitelist: true,
      allowCommands: false,
      onlineMode: true,
      allowFlight: false,
      forceGameMode: false,
      spawnProtection: 16,
      requireResourcePack: false,
      resourcePackUrl: "",
      resourcePackPrompt: "",
      worldName: "world",
      daylightCycle: true,
      spawnMonsters: true,
      spawnAnimals: true,
      viewDistance: 10,
      simulationDistance: 8,
    },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "demo-vanilla",
    name: "Creative Test",
    rootPath: "C:\\Servers\\Creative-Test",
    gameKind: "minecraft",
    serverType: "vanilla",
    minecraftVersion: "1.21.11",
    launchTarget: "server.jar",
    javaPath: "C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe",
    javaMajor: 21,
    minMemoryMib: 1024,
    maxMemoryMib: 3072,
    port: 25566,
    eulaAcceptedAt: now,
    pendingRestart: false,
    settings: {
      defaultGameMode: "creative",
      difficulty: "peaceful",
      maxPlayers: 10,
      pvp: false,
      whitelist: false,
      allowCommands: true,
      onlineMode: true,
      allowFlight: true,
      forceGameMode: false,
      spawnProtection: 0,
      requireResourcePack: false,
      resourcePackUrl: "",
      resourcePackPrompt: "",
      worldName: "creative",
      daylightCycle: true,
      spawnMonsters: false,
      spawnAnimals: true,
      viewDistance: 10,
      simulationDistance: 8,
    },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "demo-palworld",
    name: "Palworld Friends",
    rootPath: "C:\\Servers\\Palworld-Friends",
    gameKind: "palworld",
    serverType: "palworld",
    minecraftVersion: "Dedicated Server",
    launchTarget: "PalServer.exe",
    javaPath: "",
    javaMajor: 0,
    minMemoryMib: 0,
    maxMemoryMib: 0,
    port: 8211,
    eulaAcceptedAt: "",
    pendingRestart: false,
    settings: {
      defaultGameMode: "survival",
      difficulty: "normal",
      maxPlayers: 32,
      pvp: false,
      whitelist: false,
      allowCommands: false,
      onlineMode: true,
      allowFlight: false,
      forceGameMode: false,
      spawnProtection: 0,
      requireResourcePack: false,
      resourcePackUrl: "",
      resourcePackPrompt: "",
      worldName: "Palworld",
      daylightCycle: true,
      spawnMonsters: true,
      spawnAnimals: true,
      viewDistance: 10,
      simulationDistance: 8,
    },
    palworldSettings: {
      serverDescription: "Private Palworld server",
      maxPlayers: 32,
      restApiPort: 8212,
      restApiEnabled: true,
      backupEnabled: true,
    },
    createdAt: now,
    updatedAt: now,
  },
];

const demoStates = new Map<string, RuntimeStatus>([
  [
    "demo-paper",
    {
      state: "running",
      playerCount: 2,
      maxPlayers: 20,
      onlinePlayers: ["Player123", "Player456"],
      memoryUsedMib: 2150,
      uptimeSeconds: 5_040,
      address: "localhost:25565",
      cpuPercent: 24.5,
      tps: 20,
      tpsSupported: true,
      pingLatencyMs: 2,
    },
  ],
  [
    "demo-vanilla",
    {
      state: "stopped",
      playerCount: 0,
      maxPlayers: 10,
      memoryUsedMib: 0,
      uptimeSeconds: 0,
      address: "localhost:25566",
      cpuPercent: 0,
      tps: null,
      tpsSupported: true,
      pingLatencyMs: null,
    },
  ],
  [
    "demo-palworld",
    {
      state: "stopped",
      playerCount: 0,
      maxPlayers: 32,
      onlinePlayers: [],
      memoryUsedMib: 0,
      uptimeSeconds: 0,
      address: "127.0.0.1:8211",
      cpuPercent: 0,
      tps: null,
      tpsSupported: false,
      pingLatencyMs: null,
      palworld: {
        apiReachable: false,
        version: "browser-demo",
        serverName: "Palworld Friends",
        worldGuid: "browser-demo-world",
        players: [],
      },
    },
  ],
]);

const demoLogs: LogEntry[] = [
  { timestamp: "14:48:45", level: "INFO", message: "Survival World を正常に起動しました (2.31 秒)" },
  { timestamp: "14:49:01", level: "INFO", message: "ワールドの保存が完了しました (23.4 MB)" },
  { timestamp: "14:49:32", level: "WARN", message: "地面のアイテムを 1024 個削除しました" },
  { timestamp: "14:49:58", level: "INFO", message: "Player456 がゲームに参加しました" },
  { timestamp: "14:50:12", level: "INFO", message: "Player123 がゲームに参加しました" },
];

const demoPublicAccess = new Map<string, PublicAccessStatus>();
const demoTunnels = new Map<string, TunnelStatus>();
const demoInviteSettings = new Map<string, InviteSettings>();
const demoPlayerAccess = new Map<string, Record<PlayerAccessKind, PlayerAccessEntry[]>>([["demo-paper", {
  whitelist: [{ id: "demo-uuid", label: "Player123", detail: "demo-uuid" }],
  bedrock_whitelist: [{ id: "00000000-0000-0000-0009-01f64f65c7c3", label: ".BedrockFriend", detail: "Floodgate" }],
  operators: [{ id: "op-demo", label: "ServerOwner", detail: "owner-uuid", level: 4 }],
  banned_players: [{ id: "ban-demo", label: "Griefer123", detail: "banned-uuid", reason: "建築物の破壊" }],
  banned_ips: [{ id: "ip-demo", label: "203.0.***.***", detail: "IPアドレスは安全のため一部を非表示", reason: "不正アクセス" }],
}]]);
let demoFixedPlayers: FixedPlayerPreset[] = [];

async function desktopOr<T>(command: string, args: Record<string, unknown>, fallback: () => T | Promise<T>): Promise<T> {
  if (inDesktop) return invoke<T>(command, args);
  return fallback();
}

export const backend = {
  isDesktop: inDesktop,
  getAppVersion: () => inDesktop ? import("@tauri-apps/api/app").then(({ getVersion }) => getVersion()) : Promise.resolve("0.3.2"),
  quitApp: () => desktopOr<void>("quit_app", {}, () => undefined),
  checkAppUpdate: (endpoint?: string) => desktopOr<AppUpdateInfo>("check_app_update", { endpoint: endpoint?.trim() || null }, () => ({ configured: true, currentVersion: "0.3.2", available: false })),
  installAppUpdate: (expectedVersion: string, endpoint?: string) => desktopOr<void>("install_app_update", { expectedVersion, endpoint: endpoint?.trim() || null }, () => Promise.reject(new Error("Update installation is only available in the installed Windows app."))),
  listServers: () => desktopOr<ServerProfile[]>("list_servers", {}, () => [...demoServers]),
  getAutomationSettings: (serverId: string) => desktopOr<AutomationSettings>("get_automation_settings", { serverId }, () => ({ serverId, autoStopEnabled: false, idleMinutes: 30, notifyStartup: true, notifyPlayerJoin: true, notifyCrash: true, notifyBackupFailure: true, updatedAt: new Date().toISOString() })),
  saveAutomationSettings: (settings: AutomationSettings) => desktopOr<AutomationSettings>("save_automation_settings", { settings }, () => ({ ...settings, updatedAt: new Date().toISOString() })),
  checkExtensionConflicts: (serverId: string) => desktopOr<ExtensionCheckReport>("check_extension_conflicts", { serverId }, () => ({ checkedAt: new Date().toISOString(), blocking: false, scannedFiles: 0, managedFiles: 0, items: [], limitation: "ブラウザデモではJAR／ZIP内部を検査しません。" })),
  exportServerMigration: (serverId: string, destination: string) => desktopOr<MigrationExportResult>("export_server_migration", { serverId, destination }, () => ({ path: destination, manifest: { schemaVersion: 1, createdAt: new Date().toISOString(), sourceServerName: "Demo", serverType: "paper", minecraftVersion: "1.21.11", launchTarget: "server.jar", javaMajor: 21, minMemoryMib: 1024, maxMemoryMib: 4096, port: 25565, settings: demoServers[0].settings, fileCount: 42, sourceSizeBytes: 1024, archiveSha256: "browser-demo" } })),
  inspectServerMigration: (archivePath: string) => desktopOr<MigrationManifest>("inspect_server_migration", { archivePath }, () => ({ schemaVersion: 1, createdAt: new Date().toISOString(), sourceServerName: "Imported Server", serverType: "paper", minecraftVersion: "1.21.11", launchTarget: "server.jar", javaMajor: 21, minMemoryMib: 1024, maxMemoryMib: 4096, port: 25565, settings: demoServers[0].settings, fileCount: 42, sourceSizeBytes: 1024, archiveSha256: "browser-demo" })),
  restoreServerMigration: (input: RestoreMigrationInput) => desktopOr<ServerProfile>("restore_server_migration", { input }, () => ({ ...demoServers[0], id: `restored-${Date.now()}`, name: input.serverName, rootPath: `${input.parentPath}\\${input.serverName}`, javaPath: input.javaPath, javaMajor: input.javaMajor })),
  suggestServerPort: (startingPort = 25565, transport: NetworkProtocol = "tcp", reserveAdjacent = transport === "udp") => desktopOr<number>("suggest_server_port", { startingPort, transport, reserveAdjacent }, () => {
    const used = new Set(demoServers.flatMap((server) => {
      const ports: number[] = [];
      if (getNetworkProtocolForServerType(server.serverType) === transport) {
        ports.push(server.port);
        if (server.serverType === "bedrock") ports.push(server.port + 1);
      }
      if (transport === "tcp" && server.palworldSettings) ports.push(server.palworldSettings.restApiPort);
      return ports;
    }));
    const available = (port: number) => !used.has(port) && (!reserveAdjacent || (port < 65535 && !used.has(port + 1)));
    for (let port = Math.max(1024, startingPort); port <= 65535; port += 1) {
      if (available(port)) return port;
    }
    for (let port = 1024; port < startingPort; port += 1) {
      if (available(port)) return port;
    }
    throw new Error("利用できるサーバーポートを見つけられませんでした");
  }),
  listVersions: (serverType: string) =>
    desktopOr<VersionOption[]>("get_server_versions", { serverType }, () => serverType === "palworld"
      ? [{ id: "Dedicated Server", channel: "stable" }]
      : serverType === "bedrock"
      ? [{ id: "BDS latest (desktop check)", channel: "stable" }]
      : [
          { id: "1.21.11", channel: "stable" },
          { id: "1.21.10", channel: "stable" },
          { id: "1.21.8", channel: "stable" },
          { id: "1.20.6", channel: "stable" },
        ]),
  detectJava: (serverType: string, minecraftVersion: string) =>
    desktopOr<JavaRuntime[]>("detect_java", { serverType, minecraftVersion }, () => [
      {
        executablePath: "C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe",
        homePath: "C:\\Program Files\\Eclipse Adoptium\\jdk-21",
        vendor: "Eclipse Adoptium",
        version: "21.0.11",
        majorVersion: 21,
        architecture: "amd64",
        compatible: true,
        compatibilityMessage: "Java 21 — この構成の必要条件を満たしています",
      },
    ]),
  getJavaDownloadPlan: (serverType: string, minecraftVersion: string) =>
    desktopOr<JavaDownloadPlan>("get_java_download_plan", { serverType, minecraftVersion }, () => ({
      provider: "Eclipse Adoptium",
      distribution: "Eclipse Temurin JRE (HotSpot / Windows x64)",
      majorVersion: 21,
      releaseName: "jdk-21.0.12.1+1",
      packageName: "OpenJDK21U-jre_x64_windows_hotspot.zip",
      sizeBytes: 48_999_141,
      checksumSha256: "d35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636",
      destinationPath: "C:\\Users\\user\\AppData\\Roaming\\local.minecraft-server-hub.desktop\\java\\temurin-21-d35f31e712f0",
      licenseName: "GNU GPL v2 with the Classpath Exception",
      licenseUrl: "https://adoptium.net/docs/faq/#is-eclipse-temurin-free-to-use",
      sourceUrl: "https://github.com/adoptium/temurin21-binaries/releases/download/example/temurin.zip",
    })),
  installManagedJava: (plan: JavaDownloadPlan) =>
    desktopOr<JavaRuntime>("install_managed_java", { plan }, () => ({
      executablePath: `${plan.destinationPath}\\bin\\java.exe`,
      homePath: plan.destinationPath,
      vendor: "Eclipse Adoptium",
      version: plan.releaseName.replace(/^jdk-/, "").replace("+", "."),
      majorVersion: plan.majorVersion,
      architecture: "amd64",
      compatible: true,
      compatibilityMessage: `Java ${plan.majorVersion} — この構成の必要条件を満たしています`,
    })),
  updateServerJava: (serverId: string, javaPath: string, javaMajor: number) => desktopOr<ServerProfile>("update_server_java", { serverId, javaPath, javaMajor }, () => {
    const profile = demoServers.find((item) => item.id === serverId); if (!profile) throw new Error("サーバーが見つかりません"); Object.assign(profile, { javaPath, javaMajor, pendingRestart: true, updatedAt: new Date().toISOString() }); return { ...profile };
  }),
  createServer: (input: CreateServerInput) =>
    desktopOr<ServerProfile>("create_server", { input }, () => {
      const owner = demoServers.find((server) => server.port === input.port);
      if (owner) throw new Error(`ポート ${input.port} は「${owner.name}」と重複しています。空きポートへ変更してください`);
      const profile: ServerProfile = {
        id: `demo-${Date.now()}`,
        name: input.name,
        rootPath: `${input.parentPath}\\${input.name}`,
        gameKind: input.gameKind,
        serverType: input.serverType,
        minecraftVersion: input.minecraftVersion,
        launchTarget: input.serverType === "palworld" ? "PalServer.exe" : input.serverType === "bedrock" ? "bedrock_server.exe" : "server.jar",
        javaPath: input.javaPath,
        javaMajor: input.javaMajor,
        minMemoryMib: input.minMemoryMib,
        maxMemoryMib: input.maxMemoryMib,
        port: input.port,
        eulaAcceptedAt: new Date().toISOString(),
        pendingRestart: false,
        settings: input.settings,
        palworldSettings: input.palworldSettings,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      demoServers = [...demoServers, profile];
      demoStates.set(profile.id, {
        state: "stopped",
        playerCount: 0,
        maxPlayers: getServerMaxPlayers(profile),
        memoryUsedMib: 0,
        uptimeSeconds: 0,
        address: `localhost:${profile.port}`,
        cpuPercent: 0,
        tps: null,
        tpsSupported: profile.gameKind === "minecraft" && (profile.serverType === "paper" || profile.serverType === "vanilla"),
        pingLatencyMs: null,
        palworld: profile.gameKind === "palworld" ? { apiReachable: false, version: profile.minecraftVersion, serverName: profile.name, players: [] } : undefined,
      });
      return profile;
    }),
  status: (serverId: string) =>
    desktopOr<RuntimeStatus>("get_runtime_status", { serverId }, () => {
      const current = demoStates.get(serverId);
      if (current?.state === "running") {
        const phase = Math.floor(Date.now() / 1_000) % 10;
        const server = demoServers.find((item) => item.id === serverId);
        const palworld = Boolean(server && isPalworldServer(server));
        const sampled: RuntimeStatus = {
          ...current,
          uptimeSeconds: current.uptimeSeconds + 1,
          memoryUsedMib: (palworld ? 2_500 : 1_900) + phase * 90,
          cpuPercent: 14 + phase * 1.7,
          tps: palworld ? null : 19.8 + (phase % 3) * 0.05,
          pingLatencyMs: palworld ? null : 1 + phase % 3,
          palworld: palworld && current.palworld ? {
            ...current.palworld,
            serverFps: 59.5 + (phase % 2) * 0.5,
            serverFrameTimeMs: 16.6 + (phase % 3) * 0.1,
          } : current.palworld,
        };
        demoStates.set(serverId, sampled);
        return sampled;
      }
      return current ?? {
        state: "stopped",
        playerCount: 0,
        maxPlayers: 20,
        memoryUsedMib: 0,
        uptimeSeconds: 0,
        address: "localhost:25565",
        cpuPercent: 0,
        tps: null,
        tpsSupported: false,
        pingLatencyMs: null,
      };
    }),
  logs: (serverId: string) => desktopOr<LogEntry[]>("get_logs", { serverId }, () => (serverId ? [...demoLogs] : [])),
  start: (serverId: string) =>
    desktopOr<void>("start_server", { serverId }, () => {
      const status = demoStates.get(serverId);
      const server = demoServers.find((item) => item.id === serverId);
      const palworld = Boolean(server && isPalworldServer(server));
      if (status) demoStates.set(serverId, {
        ...status,
        state: "running",
        uptimeSeconds: 1,
        memoryUsedMib: palworld ? 2_640 : 1_320,
        palworld: palworld ? {
          apiReachable: true,
          version: server?.minecraftVersion || "browser-demo",
          serverName: server?.name || "Palworld",
          worldGuid: "browser-demo-world",
          serverFps: 60,
          serverFrameTimeMs: 16.7,
          baseCampCount: 1,
          worldDays: 12,
          players: [],
        } : status.palworld,
      });
    }),
  stop: (serverId: string, force = false) =>
    desktopOr<void>("stop_server", { serverId, force }, () => {
      const status = demoStates.get(serverId);
      if (status) demoStates.set(serverId, { ...status, state: "stopped", uptimeSeconds: 0, memoryUsedMib: 0 });
    }),
  restart: (serverId: string, force = false) =>
    desktopOr<void>("restart_server", { serverId, force }, () => {
      const status = demoStates.get(serverId);
      if (status) demoStates.set(serverId, { ...status, state: "running", uptimeSeconds: 1 });
    }),
  sendCommand: (serverId: string, command: string) =>
    desktopOr<void>("send_console_command", { serverId, command }, () => {
      demoLogs.push({ timestamp: new Date().toLocaleTimeString("ja-JP", { hour12: false }), level: "INFO", message: `> ${command}` });
    }),
  savePalworldWorld: (serverId: string) => desktopOr<void>("save_palworld_world", { serverId }, () => {
    const server = demoServers.find((item) => item.id === serverId);
    if (!server || !isPalworldServer(server)) throw new Error("Palworldサーバーが見つかりません");
    if (demoStates.get(serverId)?.state !== "running") throw new Error("Palworldサーバーを起動してください");
    demoLogs.push({ timestamp: new Date().toLocaleTimeString("ja-JP", { hour12: false }), level: "INFO", message: "Palworld world saved through the local REST API." });
  }),
  updatePalworldSettings: (input: UpdatePalworldSettingsInput) => desktopOr<ServerProfile>("update_palworld_settings", { input }, () => {
    const server = demoServers.find((item) => item.id === input.serverId);
    if (!server || !isPalworldServer(server)) throw new Error("Palworld server not found");
    const currentConfigured = server.palworldSettings?.joinCodeConfigured ?? false;
    const settings = {
      ...input.settings,
      restApiEnabled: true,
      joinCodeConfigured: input.serverPassword === undefined ? currentConfigured : input.serverPassword.length > 0,
    };
    Object.assign(server, {
      name: input.name.trim(),
      port: input.gamePort,
      palworldSettings: settings,
      pendingRestart: true,
      updatedAt: new Date().toISOString(),
    });
    const status = demoStates.get(input.serverId);
    if (status) demoStates.set(input.serverId, { ...status, maxPlayers: settings.maxPlayers, address: `localhost:${input.gamePort}` });
    return { ...server, palworldSettings: { ...settings } };
  }),
  clearLogs: (serverId: string) => desktopOr<void>("clear_logs", { serverId }, () => void demoLogs.splice(0)),
  saveLogs: (serverId: string, path: string) => desktopOr<void>("save_logs", { serverId, path }, () => undefined),
  openFolder: (serverId: string) => desktopOr<void>("open_server_folder", { serverId }, () => undefined),
  inspectExistingServer: (rootPath: string) => desktopOr<ImportPreview>("inspect_existing_server", { rootPath }, () => ({
    rootPath, suggestedName: "Existing Survival", serverType: "paper", minecraftVersion: "1.21.11", distributionBuild: "48", serverJar: "paper-1.21.11.jar",
    worldFolders: ["world"], modCount: 0, pluginCount: 3, datapackCount: 1, port: 25565, minMemoryMib: 1024, maxMemoryMib: 4096,
    eulaAccepted: true, javaRuntimes: [{ executablePath: "C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe", homePath: "C:\\Program Files\\Eclipse Adoptium\\jdk-21", vendor: "Eclipse Adoptium", version: "21.0.11", majorVersion: 21, architecture: "amd64", compatible: true, compatibilityMessage: "Java 21 — 互換" }],
    settings: { defaultGameMode: "survival", difficulty: "normal", maxPlayers: 20, pvp: true, whitelist: true, allowCommands: false, onlineMode: true, allowFlight: false, forceGameMode: false, spawnProtection: 16, requireResourcePack: false, resourcePackUrl: "", resourcePackPrompt: "", worldName: "world", daylightCycle: true, spawnMonsters: true, spawnAnimals: true, viewDistance: 10, simulationDistance: 8 },
    warnings: ["ブラウザデモでは実フォルダーを読み取りません。"], canImport: true, sourceFingerprint: "demo-fingerprint",
  })),
  importExistingServer: (input: ImportServerInput) => desktopOr<ServerProfile>("import_existing_server", { input }, () => {
    const preview = { serverType: "paper" as const, minecraftVersion: "1.21.11", settings: { defaultGameMode: "survival" as const, difficulty: "normal" as const, maxPlayers: 20, pvp: true, whitelist: true, allowCommands: false, onlineMode: true, allowFlight: false, forceGameMode: false, spawnProtection: 16, requireResourcePack: false, resourcePackUrl: "", resourcePackPrompt: "", worldName: "world", daylightCycle: true, spawnMonsters: true, spawnAnimals: true, viewDistance: 10, simulationDistance: 8 } };
    const now = new Date().toISOString();
    const profile: ServerProfile = { id: `import-${Date.now()}`, name: input.name, rootPath: input.rootPath, gameKind: "minecraft", serverType: preview.serverType, minecraftVersion: preview.minecraftVersion, launchTarget: "paper.jar", javaPath: input.javaPath, javaMajor: input.javaMajor, minMemoryMib: 1024, maxMemoryMib: 4096, port: 25565, eulaAcceptedAt: now, pendingRestart: false, settings: preview.settings, createdAt: now, updatedAt: now };
    demoServers = [...demoServers, profile]; return profile;
  }),
  diagnose: (serverId: string) => desktopOr<PcDiagnosis>("diagnose_pc", { serverId }, () => ({
    cpuName: "デモ用CPU（実機ではローカル診断）", physicalCores: 8, logicalThreads: 16, cpuUsagePercent: 18.4,
    memoryTotalMib: 32768, memoryAvailableMib: 18600, gpuName: "デモ用GPU", os: "Windows 11",
    storageKind: "SSD", storageFreeGib: 214, storageAvailable: true, javaRuntimes: [], recommendedMemoryMib: 6144,
    recommendedPlayers: 14, recommendedViewDistance: 10, recommendedSimulationDistance: 8,
    warnings: [], privacyNote: "診断はこのPC内だけで実行され、結果を外部へ送信しません。",
  })),
  diagnoseNewServer: (serverType: string, minecraftVersion: string, parentPath: string) => desktopOr<PcDiagnosis>("diagnose_new_server", { serverType, minecraftVersion, parentPath }, () => ({
    cpuName: "デモ用CPU（実機ではローカル診断）", physicalCores: 8, logicalThreads: 16, cpuUsagePercent: 18.4,
    memoryTotalMib: 32768, memoryAvailableMib: 18600, gpuName: "デモ用GPU", os: "Windows 11",
    storageKind: "SSD", storageFreeGib: 214, storageAvailable: true, javaRuntimes: [], recommendedMemoryMib: 6144,
    recommendedPlayers: serverType === "fabric" || serverType === "forge" || serverType === "neoforge" ? 8 : 14,
    recommendedViewDistance: 10, recommendedSimulationDistance: 8,
    warnings: [], privacyNote: "診断はこのPC内だけで実行され、結果を外部へ送信しません。",
  })),
  deleteServer: (input: DeleteServerInput) => desktopOr<DeleteServerResult>("delete_server", { input }, () => {
    const profile = demoServers.find((item) => item.id === input.serverId);
    if (!profile) throw new Error("サーバーが見つかりません");
    if (!isValidDeleteConfirmation(input.confirmationText)) throw new Error("削除確認には半角で「Delete」と入力してください");
    const status = demoStates.get(input.serverId);
    if (status && status.state !== "stopped") throw new Error("削除する前にサーバーを安全停止してください");
    demoServers = demoServers.filter((item) => item.id !== input.serverId);
    demoStates.delete(input.serverId);
    return { deletedFiles: input.deleteFiles, backupPath: input.deleteFiles && input.backupMode !== "none" ? "C:\\Backups\\before-server-delete.zip" : undefined };
  }),
  analyzeServer: (serverId: string) => desktopOr<ServerDiagnosisReport>("analyze_server", { serverId }, () => ({
    checkedAt: new Date().toISOString(), healthy: false,
    issues: [{ id: "demo-port", severity: "warning", whatHappened: "ポート25565の使用状況を確認してください", impact: "別のサーバーと同時に起動できない可能性があります。", likelyCause: "ブラウザデモではPC上のポートを調査しません。", nextActions: ["デスクトップ版で再診断してください。"], relatedLogs: [], suggestRestore: false }],
    redactionNote: "デスクトップ版の診断はローカルだけで実行し、秘密情報を伏せ字にします。",
  })),
  listBackups: (serverId: string) => desktopOr<BackupInfo[]>("list_backups", { serverId }, () => []),
  createBackup: (serverId: string, label = "manual") => desktopOr<BackupInfo>("create_backup", { serverId, label }, () => ({ id: `demo-${Date.now()}`, createdAt: new Date().toISOString(), sizeBytes: 24_800_000, path: "C:\\Backups\\demo.zip", serverName: "Survival World", minecraftVersion: "1.21.11", serverType: "paper", extensionSummary: "mods=0 plugins=3 datapacks=1", sha256: "demo-sha256", valid: true, schemaVersion: 2, kind: "manual", displayName: label, sourceSizeBytes: 31_000_000, fileCount: 42, verifiedAt: new Date().toISOString(), pinned: true })),
  restoreBackup: (serverId: string, backupId: string) => desktopOr<void>("restore_backup", { serverId, backupId }, () => undefined),
  verifyBackup: (serverId: string, backupId: string) => desktopOr<boolean>("verify_backup", { serverId, backupId }, () => true),
  deleteBackup: (serverId: string, backupId: string) => desktopOr<void>("delete_backup", { serverId, backupId }, () => undefined),
  openBackupFolder: (serverId: string) => desktopOr<void>("open_backup_folder", { serverId }, () => undefined),
  updateSettings: (serverId: string, settings: BasicSettings, maxMemoryMib: number, port: number) => desktopOr<ServerProfile>("update_server_settings", { serverId, settings, maxMemoryMib, port }, () => {
    const profile = demoServers.find((item) => item.id === serverId);
    if (!profile) throw new Error("サーバーが見つかりません");
    const owner = demoServers.find((item) => item.id !== serverId && item.port === port);
    if (owner) throw new Error(`ポート ${port} は「${owner.name}」と重複しています。空きポートへ変更してください`);
    Object.assign(profile, { settings, maxMemoryMib, port, pendingRestart: true, updatedAt: new Date().toISOString() });
    return { ...profile };
  }),
  regenerateWorld: (input: RegenerateWorldInput) => desktopOr<WorldRegenerationResult>("regenerate_world", { input }, () => {
    const profile = demoServers.find((item) => item.id === input.serverId);
    if (!profile) throw new Error("サーバーが見つかりません");
    const status = demoStates.get(input.serverId);
    if (status && status.state !== "stopped") throw new Error("ワールドを再生成する前にサーバーを安全停止してください");
    if (input.confirmationName.trim() !== profile.name) throw new Error("確認用のサーバー名が一致しません");
    const previousWorldName = profile.settings.worldName;
    Object.assign(profile, { settings: input.settings, maxMemoryMib: input.maxMemoryMib, port: input.port, pendingRestart: true, updatedAt: new Date().toISOString() });
    return { server: { ...profile }, backup: { id: `demo-world-${Date.now()}`, createdAt: new Date().toISOString(), sizeBytes: 24_800_000, path: "C:\\Backups\\before-world-regeneration.zip", serverName: profile.name, minecraftVersion: profile.minecraftVersion, serverType: profile.serverType, extensionSummary: "mods=0 plugins=0 datapacks=0", sha256: "demo-sha256", valid: true, schemaVersion: 2, kind: "before_world_regeneration", displayName: "ワールド再生成前", sourceSizeBytes: 31_000_000, fileCount: 42, verifiedAt: new Date().toISOString(), pinned: true }, removedWorldFolders: [previousWorldName] };
  }),
  listExtensions: (serverId: string) => desktopOr<ExtensionInfo[]>("list_extensions", { serverId }, () => []),
  installLocalExtension: (serverId: string, source: string, kind: ExtensionKind) => desktopOr<ExtensionInfo>("install_local_extension", { serverId, source, kind }, () => ({ fileName: source.split(/[\\/]/).pop() ?? "example.jar", kind, enabled: true, sizeBytes: 1024, compatibility: "デモ環境", clientRequirement: kind === "mod" ? "配布元の説明を確認してください。" : "通常はサーバー側のみです。", manageable: true })),
  setExtensionEnabled: (serverId: string, fileName: string, kind: ExtensionKind, enabled: boolean) => desktopOr<void>("set_extension_enabled", { serverId, fileName, kind, enabled }, () => undefined),
  removeExtension: (serverId: string, fileName: string, kind: ExtensionKind) => desktopOr<void>("remove_extension", { serverId, fileName, kind }, () => undefined),
  searchExtensions: (serverId: string, query: string, kind: ExtensionKind) => desktopOr<ExtensionSearchHit[]>("search_extensions", { serverId, query, kind }, () => query ? [{ projectId: "demo-project", title: `${query} Example`, description: "Modrinth検索結果のブラウザ用デモです。", author: "demo", versions: ["1.21.11"], allProjectTypes: [kind], categories: [kind], environment: ["server_only"], downloads: 125000, provider: "modrinth", sourceUrl: "https://modrinth.com" }] : [
    { projectId: `popular-${kind}-1`, title: kind === "mod" ? "Fabric API" : kind === "plugin" ? "ViaVersion" : "Terralith", description: "選択中のMinecraft版とサーバー種類に対応する人気項目です。", author: "Modrinth Creator", versions: ["1.21.11"], allProjectTypes: [kind], categories: [kind], environment: ["server_only"], downloads: 58_400_000, provider: "modrinth", sourceUrl: "https://modrinth.com" },
    { projectId: `popular-${kind}-2`, title: kind === "mod" ? "Lithium" : kind === "plugin" ? "LuckPerms" : "Incendium", description: "Modrinthのダウンロード数順カタログの表示例です。", author: "Community", versions: ["1.21.11"], allProjectTypes: [kind], categories: [kind], environment: ["server_only"], downloads: 31_200_000, provider: "modrinth", sourceUrl: "https://modrinth.com" },
    { projectId: `popular-${kind}-3`, title: kind === "mod" ? "FerriteCore" : kind === "plugin" ? "spark" : "Nullscape", description: "導入前に対応版と必要な依存関係を確認します。", author: "Community", versions: ["1.21.11"], allProjectTypes: [kind], categories: [kind], environment: ["server_only"], downloads: 18_700_000, provider: "modrinth", sourceUrl: "https://modrinth.com" },
  ]),
  listExtensionVersions: (serverId: string, projectId: string, kind: ExtensionKind) => desktopOr<ExtensionVersionOption[]>("list_extension_versions", { serverId, projectId, kind }, () => [{ id: "demo-version", name: "Recommended 1.0.0", versionNumber: "1.0.0", releaseChannel: "release", publishedAt: "2026-08-25T00:00:00Z", fileName: kind === "datapack" ? "example.zip" : "example.jar", sizeBytes: 2_400_000, requiredDependencyCount: kind === "mod" ? 1 : 0, clientRequirement: kind === "mod" ? "参加者側にも同じModが必要です。" : "通常はサーバー側だけで利用できます。" }]),
  planExtensionInstall: (serverId: string, versionId: string, kind: ExtensionKind) => desktopOr<ExtensionInstallPlan>("plan_extension_install", { serverId, versionId, kind }, () => ({ provider: "modrinth", minecraftVersion: "1.21.11", loader: kind === "plugin" ? "paper" : kind === "datapack" ? "datapack" : "fabric", kind, totalSizeBytes: 3_400_000, warnings: [], clientRequirement: kind === "mod" ? "参加者側にも同じModが必要です。" : "通常はサーバー側だけで利用できます。", items: [{ projectId: "demo-project", versionId, fileName: kind === "datapack" ? "example.zip" : "example.jar", versionNumber: "1.0.0", sizeBytes: 2_400_000, dependency: false }, ...(kind === "mod" ? [{ projectId: "demo-dependency", versionId: "demo-dependency-version", fileName: "dependency.jar", versionNumber: "2.0.0", sizeBytes: 1_000_000, dependency: true }] : [])] })),
  installCatalogExtension: (serverId: string, versionId: string, kind: ExtensionKind) => desktopOr<ExtensionInstallPlan>("install_catalog_extension", { serverId, versionId, kind }, () => ({ provider: "modrinth", minecraftVersion: "1.21.11", loader: kind === "plugin" ? "paper" : kind === "datapack" ? "datapack" : "fabric", kind, totalSizeBytes: 2_400_000, warnings: [], clientRequirement: "デモ環境", items: [{ projectId: "demo-project", versionId, fileName: kind === "datapack" ? "example.zip" : "example.jar", versionNumber: "1.0.0", sizeBytes: 2_400_000, dependency: false }] })),
  getCrossplayPlan: (serverId: string, bedrockPort: number) => desktopOr<CrossplayPlan>("get_crossplay_plan", { serverId, bedrockPort }, () => {
    const server = demoServers.find((item) => item.id === serverId);
    if (!server) throw new Error("サーバーが見つかりません");
    const eligible = server.serverType === "paper" && server.javaMajor >= 21;
    return {
      eligible,
      bedrockPort,
      geyser: { project: "geyser", version: "browser-demo", build: 0, fileName: "Geyser-Spigot.jar", sha256: "browser-demo-not-downloaded", installed: false },
      floodgate: { project: "floodgate", version: "browser-demo", build: 0, fileName: "floodgate-spigot.jar", sha256: "browser-demo-not-downloaded", installed: false },
      warnings: eligible ? ["ブラウザデモでは公式配布情報・SHA-256・互換性を実測しません。"] : ["クロスプレイ自動導入はJava 21以上のPaperサーバーだけに対応しています。"],
      nextSteps: ["デスクトップ版で公式GeyserMC配布情報を取得します。", "変更前バックアップ後にプラグインを追加します。", "再起動後に統合版UDPポートを確認します。"],
      sourceUrl: "https://geysermc.org/wiki/geyser/setup/self/paper-spigot/",
    };
  }),
  installCrossplay: (input: CrossplayInstallInput) => desktopOr<CrossplayInstallResult>("install_crossplay", { input }, () => {
    const server = demoServers.find((item) => item.id === input.serverId);
    if (!server) throw new Error("サーバーが見つかりません");
    if (!input.acceptWarnings) throw new Error("互換性、UDP公開、参加制限の説明を確認してください");
    if (server.serverType !== "paper" || server.javaMajor < 21) throw new Error("Java 21以上のPaperサーバーが必要です");
    const installedFiles = ["Geyser-Spigot.jar", ...(input.includeFloodgate ? ["floodgate-spigot.jar"] : [])];
    demoTunnels.set(`${input.serverId}::crossplay-installed`, { serverId: input.serverId, providerId: "local", state: "disconnected", localHost: "127.0.0.1", localPort: input.bedrockPort, transport: "udp", agentVerified: false, termsAcknowledged: false, accountState: "unknown", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "Geyser導入済み", recentLogs: [] });
    return {
      backup: { id: `demo-before-crossplay-${Date.now()}`, createdAt: new Date().toISOString(), sizeBytes: 1024, path: "C:\\Backups\\demo-crossplay.zip", serverName: server.name, minecraftVersion: server.minecraftVersion, serverType: server.serverType, extensionSummary: "plugins=0", sha256: "browser-demo-not-verified", valid: true, schemaVersion: 2, kind: "before_crossplay_install", displayName: "クロスプレイ導入前", sourceSizeBytes: 2048, fileCount: 2, verifiedAt: new Date().toISOString(), pinned: true },
      installedFiles,
      bedrockPort: input.bedrockPort,
      restartRequired: true,
      message: "ブラウザデモでは導入を再現しただけです。デスクトップ版で公式配布物とSHA-256を検証します。",
    };
  }),
  crossplayStatus: (serverId: string) => desktopOr<CrossplayStatus>("get_crossplay_status", { serverId }, () => {
    const server = demoServers.find((item) => item.id === serverId);
    if (!server) throw new Error("サーバーが見つかりません");
    const installed = demoTunnels.has(`${serverId}::crossplay-installed`);
    return { eligible: server.serverType === "paper", installed, bedrockPort: installed ? 19132 : undefined, floodgateInstalled: installed, configurationGenerated: installed && demoStates.get(serverId)?.state === "running", configurationReady: installed && demoTunnels.has(`${serverId}::crossplay-configured`) };
  }),
  configureCrossplay: (serverId: string) => desktopOr<CrossplayConfigurationResult>("configure_crossplay", { serverId }, () => {
    if (demoStates.get(serverId)?.state === "running") throw new Error("Geyser設定の変更前にPaperサーバーを停止してください");
    demoTunnels.set(`${serverId}::crossplay-configured`, { serverId, providerId: "local", state: "disconnected", localHost: "127.0.0.1", localPort: 19132, transport: "udp", agentVerified: false, termsAcknowledged: false, accountState: "unknown", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "Geyser設定済み", recentLogs: [] });
    const server = demoServers.find((item) => item.id === serverId) ?? demoServers[0];
    return { backup: { id: `demo-crossplay-config-${Date.now()}`, createdAt: new Date().toISOString(), sizeBytes: 1024, path: "C:\\Backups\\demo-crossplay-config.zip", serverName: server.name, minecraftVersion: server.minecraftVersion, serverType: server.serverType, extensionSummary: "plugins=2", sha256: "browser-demo-not-verified", valid: true, schemaVersion: 2, kind: "before_settings", displayName: "Geyser設定前", sourceSizeBytes: 2048, fileCount: 2, verifiedAt: new Date().toISOString(), pinned: true }, bedrockPort: 19132, floodgateEnabled: true, message: "GeyserのUDPポートとFloodgate認証を設定しました" };
  }),
  crossplayTunnelStatus: (serverId: string) => desktopOr<TunnelStatus>("get_crossplay_tunnel_status", { serverId }, () => {
    const port = 19132;
    return demoTunnels.get(`${serverId}::bedrock`) ?? { serverId, providerId: "playit", state: "unconfigured", localHost: "127.0.0.1", localPort: port, transport: "udp", agentVerified: false, termsAcknowledged: false, accountState: "unknown", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "統合版用トンネルはまだ開始していません", lastCheckedAt: new Date().toISOString(), recentLogs: [] };
  }),
  quickStartCrossplayTunnel: (input: QuickStartTunnelInput) => desktopOr<TunnelStatus>("quick_start_crossplay_tunnel", { input }, () => {
    if (demoStates.get(input.serverId)?.state !== "running") throw new Error("先にPaperサーバーを起動してください");
    const key = `${input.serverId}::bedrock`;
    const current = demoTunnels.get(key);
    if (!input.termsAccepted && !current?.termsAcknowledged) throw new Error("初回だけ利用条件を確認してください");
    const result: TunnelStatus = { serverId: input.serverId, providerId: "playit", state: "running", localHost: "127.0.0.1", localPort: 19132, transport: "udp", agentPath: current?.agentPath ?? "C:\\Program Files\\playit_gg\\bin\\playit.exe", agentVersion: "1.0.10-demo", agentVerified: true, termsAcknowledged: true, accountState: "verified", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: true, publicEndpoint: "bedrock-demo.gl.joinmc.link:19132", message: "統合版用UDP接続先の候補を取得しました", lastCheckedAt: new Date().toISOString(), recentLogs: ["ブラウザデモ: 統合版用UDPトンネル"] };
    demoTunnels.set(key, result); return result;
  }),
  stopCrossplayTunnel: (serverId: string) => desktopOr<TunnelStatus>("stop_crossplay_tunnel", { serverId }, () => {
    const key = `${serverId}::bedrock`; const current = demoTunnels.get(key);
    const result: TunnelStatus = { serverId, providerId: "playit", state: "disconnected", localHost: "127.0.0.1", localPort: current?.localPort ?? 19132, transport: "udp", agentPath: current?.agentPath, agentVersion: current?.agentVersion, agentVerified: Boolean(current?.agentVerified), termsAcknowledged: current?.termsAcknowledged ?? false, accountState: current?.accountState ?? "unknown", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "統合版の招待を停止しました", lastCheckedAt: new Date().toISOString(), recentLogs: current?.recentLogs ?? [] };
    demoTunnels.set(key, result); return result;
  }),
  diagnoseCrossplayTunnel: (serverId: string) => desktopOr<TunnelDiagnosis>("diagnose_crossplay_tunnel", { serverId }, () => {
    const current = demoTunnels.get(`${serverId}::bedrock`); const running = demoStates.get(serverId)?.state === "running";
    return { checkedAt: new Date().toISOString(), transport: "udp", serverRunning: running, localPortListening: running, agentConfigured: Boolean(current?.agentPath), agentVerified: Boolean(current?.agentVerified), agentRunning: Boolean(current), providerAuthenticated: current?.accountState === "verified", matchingTunnel: Boolean(current?.matchingTunnel), tunnelConnected: current?.state === "connected", endpointAvailable: Boolean(current?.publicEndpoint), items: [running ? "Paperサーバーは起動しています" : "Paperサーバーが起動していません", "ブラウザデモではUDP待受を実測しません"] };
  }),
  openCrossplayTunnelAccountLogin: (serverId: string) => desktopOr<void>("open_crossplay_tunnel_account_login", { serverId }, () => undefined),
  openCrossplayTunnelDashboard: (serverId: string) => desktopOr<void>("open_crossplay_tunnel_dashboard", { serverId }, () => undefined),
  probeCrossplayTunnelEndpoint: (serverId: string) => desktopOr<TunnelExternalProbe>("probe_crossplay_tunnel_endpoint", { serverId }, () => {
    const current = demoTunnels.get(`${serverId}::bedrock`);
    return { checkedAt: new Date().toISOString(), transport: "udp", attempted: Boolean(current?.publicEndpoint), reachable: false, endpoint: current?.publicEndpoint, scope: "host-network", message: "ブラウザデモでは外部UDP接続を実測しません" };
  }),
  inviteInfo: (serverId: string) => desktopOr<InviteInfo>("get_invite_info", { serverId }, () => {
    const server = demoServers.find((item) => item.id === serverId) ?? demoServers[0];
    return { lanAddresses: [`192.168.1.20:${server.port}`], hostAddress: `localhost:${server.port}`, port: server.port, whitelistRecommended: !server.settings.whitelist, externalProviders: [
      { id: "upnp", name: "ルーター自動公開（UPnP）", account: "不要", price: "通常は追加料金なし", limits: "UPnP対応ルーターと公開IPv4が必要", privacy: "参加者には自宅回線の公開IPが見えます", status: "アプリ内で利用可能" },
      { id: "playit", name: "playit.gg（代替中継）", account: "初回登録・規約同意が必要", price: "Minecraft Javaは無料枠あり", limits: "外部サービスの提供状況・規約に依存", privacy: "ゲーム通信がplayit.ggを経由します", status: "公式セットアップを案内" },
    ] };
  }),
  inviteSettings: (serverId: string) => desktopOr<InviteSettings>("get_invite_settings", { serverId }, () => {
    const server = demoServers.find((item) => item.id === serverId) ?? demoServers[0];
    return demoInviteSettings.get(serverId) ?? { inviteName: server.name, updatedAt: "" };
  }),
  updateInviteSettings: (input: UpdateInviteSettingsInput) => desktopOr<InviteSettings>("update_invite_settings", { input }, () => {
    const customHostname = input.customHostname?.trim().toLowerCase().replace(/\.$/, "") || undefined;
    const result = { inviteName: input.inviteName.trim(), customHostname, updatedAt: new Date().toISOString() };
    demoInviteSettings.set(input.serverId, result);
    const current = demoPublicAccess.get(input.serverId);
    if (current) demoPublicAccess.set(input.serverId, {
      ...current,
      inviteName: result.inviteName,
      customHostname,
      namedAddress: customHostname ? customHostname : undefined,
      hostnameState: customHostname ? "verified" : "not_configured",
      hostnameMessage: customHostname ? "ブラウザデモでは設定済みとして表示します。デスクトップ版ではDNSを確認します。" : "独自ホスト名は未設定です。数値アドレスで参加できます。",
    });
    return result;
  }),
  publicAccessStatus: (serverId: string) => desktopOr<PublicAccessStatus>("get_public_access_status", { serverId }, () => {
    const settings = demoInviteSettings.get(serverId) ?? { inviteName: demoServers.find((item) => item.id === serverId)?.name ?? "Minecraft Server", updatedAt: "" };
    return demoPublicAccess.get(serverId) ?? ({ state: "stopped", inviteName: settings.inviteName, customHostname: settings.customHostname, hostnameState: settings.customHostname ? "pending" : "not_configured", hostnameMessage: settings.customHostname ? "公開開始時にDNSを確認します。" : "独自ホスト名は未設定です。数値アドレスで参加できます。", method: "UPnP", message: "インターネットには公開していません。", homeIpExposed: true });
  }),
  publishServerUpnp: (serverId: string) => desktopOr<PublicAccessStatus>("publish_server_upnp", { serverId }, () => {
    const server = demoServers.find((item) => item.id === serverId);
    if (!server) throw new Error("サーバーが見つかりません");
    if (demoStates.get(serverId)?.state !== "running") throw new Error("先にMinecraftサーバーを起動してください");
    if (!server.settings.whitelist) throw new Error("安全のため、ホワイトリストを有効にしてください");
    if (!server.settings.onlineMode) throw new Error("認証が無効なサーバーはインターネット公開できません");
    const settings = demoInviteSettings.get(serverId) ?? { inviteName: server.name, updatedAt: "" };
    const result: PublicAccessStatus = { state: "published", address: "203.0.113.42:25565", namedAddress: settings.customHostname, inviteName: settings.inviteName, customHostname: settings.customHostname, hostnameState: settings.customHostname ? "verified" : "not_configured", hostnameMessage: settings.customHostname ? "ブラウザデモでは設定済みとして表示します。デスクトップ版ではDNSを確認します。" : "独自ホスト名は未設定です。数値アドレスで参加できます。", method: "UPnP（ブラウザデモ）", expiresAt: new Date(Date.now() + 600_000).toISOString(), message: "別の家の友達がこのアドレスで参加できます。", homeIpExposed: true };
    demoPublicAccess.set(serverId, result);
    return result;
  }),
  unpublishServer: (serverId: string) => desktopOr<PublicAccessStatus>("unpublish_server", { serverId }, () => {
    demoPublicAccess.delete(serverId);
    const settings = demoInviteSettings.get(serverId) ?? { inviteName: demoServers.find((item) => item.id === serverId)?.name ?? "Minecraft Server", updatedAt: "" };
    return { state: "stopped", inviteName: settings.inviteName, customHostname: settings.customHostname, hostnameState: settings.customHostname ? "pending" : "not_configured", hostnameMessage: settings.customHostname ? "公開開始時にDNSを確認します。" : "独自ホスト名は未設定です。数値アドレスで参加できます。", method: "UPnP", message: "インターネットには公開していません。", homeIpExposed: true };
  }),
  quickStartPalworldTunnel: (input: QuickStartTunnelInput) => desktopOr<TunnelStatus>("quick_start_palworld_tunnel", { input }, () => { throw new Error("Desktop app required for Palworld internet invites."); }),
  publishPalworldUpnp: (serverId: string) => desktopOr<PublicAccessStatus>("publish_server_upnp", { serverId }, () => { throw new Error("Desktop app required for Palworld internet invites."); }),
  tunnelStatus: (serverId: string) => desktopOr<TunnelStatus>("get_tunnel_status", { serverId }, () => {
    const server = demoServers.find((item) => item.id === serverId) ?? demoServers[0];
    const transport = server.serverType === "bedrock" || server.gameKind === "palworld" ? "udp" : "tcp";
    return demoTunnels.get(serverId) ?? { serverId, providerId: "playit", state: "unconfigured", localHost: "127.0.0.1", localPort: server.port, transport, agentVerified: false, termsAcknowledged: false, accountState: "unknown", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "公式エージェントを選択して検証してください", lastCheckedAt: new Date().toISOString(), recentLogs: [] };
  }),
  validateTunnelAgent: (input: ValidateTunnelAgentInput) => desktopOr<TunnelAgentValidation>("validate_tunnel_agent", { input }, () => {
    const current = demoTunnels.get(input.serverId);
    const server = demoServers.find((item) => item.id === input.serverId) ?? demoServers[0];
    const transport = server.serverType === "bedrock" || server.gameKind === "palworld" ? "udp" : "tcp";
    demoTunnels.set(input.serverId, { serverId: input.serverId, providerId: "playit", state: "disconnected", localHost: "127.0.0.1", localPort: current?.localPort ?? server.port, transport, agentPath: input.agentPath, agentVersion: "1.0.0-demo", agentVerified: true, termsAcknowledged: current?.termsAcknowledged ?? false, accountState: "unknown", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "ブラウザデモでは署名検証を再現しません", lastCheckedAt: new Date().toISOString(), recentLogs: [] });
    return { valid: true, providerId: "playit", agentPath: input.agentPath, version: "1.0.0-demo", sha256: "browser-demo-not-verified", verificationMethod: "ブラウザデモ", message: "デスクトップ版で公式署名を検証してください" };
  }),
  tunnelAgentInstallPlan: (serverId: string) => desktopOr<TunnelAgentInstallPlan>("get_tunnel_agent_install_plan", { serverId }, () => {
    const current = demoTunnels.get(serverId);
    const installedValidation = current?.agentVerified ? { valid: true, providerId: "playit", agentPath: current.agentPath ?? "C:\\Program Files\\playit_gg\\bin\\playit.exe", version: current.agentVersion ?? "1.0.10-demo", sha256: "browser-demo-not-verified", verificationMethod: "ブラウザデモ", message: "ブラウザデモでは実ファイルを検証しません" } : undefined;
    return { providerId: "playit", version: "1.0.10", sourceUrl: "https://github.com/playit-cloud/playit-agent/releases/download/v1.0.10/playit-windows-x86_64-signed.msi", sizeBytes: 6_070_272, checksumSha256: "18c022281fcfe578fb0d614ac6dc1d36cd6885b4a5439b97655768cd2a82bdc1", publisher: "Developed Methods LLC", licenseName: "BSD-2-Clause", licenseUrl: "https://github.com/playit-cloud/playit-agent/blob/v1.0.10/LICENSE.txt", installScope: "このPCの全ユーザー（Windowsサービスを含む）", installPath: "C:\\Program Files\\playit_gg", temporaryPath: "C:\\Users\\demo\\AppData\\Roaming\\Minecraft Server Hub\\tunnel-installers\\playit-v1.0.10-x64-signed.msi", alreadyInstalled: Boolean(installedValidation), installedValidation };
  }),
  installTunnelAgent: (input: InstallTunnelAgentInput) => desktopOr<TunnelAgentValidation>("install_tunnel_agent", { input }, () => {
    const current = demoTunnels.get(input.serverId);
    const server = demoServers.find((item) => item.id === input.serverId) ?? demoServers[0];
    const transport = server.serverType === "bedrock" || server.gameKind === "palworld" ? "udp" : "tcp";
    const validation: TunnelAgentValidation = { valid: true, providerId: "playit", agentPath: "C:\\Program Files\\playit_gg\\bin\\playit.exe", version: input.version, sha256: "browser-demo-not-verified", verificationMethod: "ブラウザデモ", message: "公式エージェントの準備をブラウザデモで再現しました" };
    demoTunnels.set(input.serverId, { serverId: input.serverId, providerId: "playit", state: "disconnected", localHost: "127.0.0.1", localPort: current?.localPort ?? server.port, transport, agentPath: validation.agentPath, agentVersion: validation.version, agentVerified: true, termsAcknowledged: current?.termsAcknowledged ?? false, accountState: "unknown", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "公式エージェントを準備しました", lastCheckedAt: new Date().toISOString(), recentLogs: [] });
    return validation;
  }),
  startTunnel: (input: StartTunnelInput) => desktopOr<TunnelStatus>("start_tunnel", { input }, () => {
    const server = demoServers.find((item) => item.id === input.serverId); if (!server) throw new Error("サーバーが見つかりません");
    const transport = server.serverType === "bedrock" || server.gameKind === "palworld" ? "udp" : "tcp";
    if (demoStates.get(server.id)?.state !== "running") throw new Error("先にMinecraftサーバーを起動してください");
    if (!input.termsAccepted) throw new Error("利用条件を確認してください");
    const result: TunnelStatus = { serverId: server.id, providerId: "playit", state: "awaiting_login", localHost: "127.0.0.1", localPort: server.port, transport, agentPath: input.agentPath, agentVersion: "1.0.0-demo", agentVerified: true, termsAcknowledged: true, accountState: "not_configured", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: `公式画面でログインし、このMinecraftポート用の${transport.toUpperCase()}トンネルを追加してください`, lastCheckedAt: new Date().toISOString(), recentLogs: ["ブラウザデモ: ローカルエージェントを開始"] };
    demoTunnels.set(server.id, result); return result;
  }),
  quickStartTunnel: (input: QuickStartTunnelInput) => desktopOr<TunnelStatus>("quick_start_tunnel", { input }, () => {
    const server = demoServers.find((item) => item.id === input.serverId); if (!server) throw new Error("サーバーが見つかりません");
    const transport = server.serverType === "bedrock" || server.gameKind === "palworld" ? "udp" : "tcp";
    if (demoStates.get(server.id)?.state !== "running") throw new Error("Minecraftサーバーを起動できませんでした");
    const current = demoTunnels.get(server.id);
    if (!input.termsAccepted && !current?.termsAcknowledged) throw new Error("初回だけ利用条件を確認してください");
    const result: TunnelStatus = { serverId: server.id, providerId: "playit", state: transport === "udp" ? "running" : "connected", localHost: "127.0.0.1", localPort: server.port, transport, agentPath: current?.agentPath ?? "C:\\Program Files\\playit_gg\\bin\\playit.exe", agentVersion: "1.0.10-demo", agentVerified: true, termsAcknowledged: true, accountState: "verified", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: true, publicEndpoint: `demo.gl.joinmc.link:${server.port}`, message: transport === "udp" ? "Bedrock UDP接続先の候補です。デスクトップ版の接続診断でRakNet応答を確認してください" : "Minecraft用の公開接続先を取得しました", lastCheckedAt: new Date().toISOString(), recentLogs: ["ブラウザデモ: かんたん公開"] };
    demoTunnels.set(server.id, result); return result;
  }),
  stopTunnel: (serverId: string) => desktopOr<TunnelStatus>("stop_tunnel", { serverId }, () => {
    const current = demoTunnels.get(serverId); const server = demoServers.find((item) => item.id === serverId) ?? demoServers[0];
    const transport = server.serverType === "bedrock" || server.gameKind === "palworld" ? "udp" : "tcp";
    const result: TunnelStatus = { serverId, providerId: "playit", state: "disconnected", localHost: "127.0.0.1", localPort: current?.localPort ?? server.port, transport, agentPath: current?.agentPath, agentVersion: current?.agentVersion, agentVerified: Boolean(current?.agentVerified), termsAcknowledged: current?.termsAcknowledged ?? false, accountState: current?.accountState ?? "unknown", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "エージェントを停止しました", lastCheckedAt: new Date().toISOString(), recentLogs: current?.recentLogs ?? [] };
    demoTunnels.set(serverId, result); return result;
  }),
  diagnoseTunnel: (serverId: string) => desktopOr<TunnelDiagnosis>("diagnose_tunnel", { serverId }, () => {
    const current = demoTunnels.get(serverId); const running = demoStates.get(serverId)?.state === "running";
    const server = demoServers.find((item) => item.id === serverId) ?? demoServers[0];
    const transport = server.serverType === "bedrock" || server.gameKind === "palworld" ? "udp" : "tcp";
    const connected = current?.state === "connected" && Boolean(current.publicEndpoint);
    return { checkedAt: new Date().toISOString(), transport, serverRunning: running, localPortListening: running, agentConfigured: Boolean(current?.agentPath), agentVerified: Boolean(current?.agentVerified), agentRunning: Boolean(current && !["unconfigured", "disconnected", "error"].includes(current.state)), providerAuthenticated: current?.accountState === "verified", matchingTunnel: Boolean(current?.matchingTunnel), tunnelConnected: connected, endpointAvailable: Boolean(current?.publicEndpoint), items: [running ? "Minecraftサーバープロセスは起動しています" : "Minecraftサーバーが起動していません", `ブラウザデモでは${transport.toUpperCase()}待受と公式署名を実測しません`, connected ? "公開接続先をブラウザデモで再現しています" : "公開接続先はまだ取得できません", "別の家からのMinecraft実参加は別回線で確認してください"] };
  }),
  openTunnelAccountLogin: (serverId: string) => desktopOr<void>("open_tunnel_account_login", { serverId }, () => {
    const current = demoTunnels.get(serverId); if (!current) throw new Error("先にエージェントを開始してください");
    demoTunnels.set(serverId, { ...current, accountState: "verified", state: "running", message: "ブラウザデモ: 公式ログイン完了として再現しました" });
  }),
  openTunnelDashboard: (serverId: string) => desktopOr<void>("open_tunnel_dashboard", { serverId }, () => {
    const current = demoTunnels.get(serverId); if (!current) throw new Error("先にエージェントを開始してください");
    const transport = current.transport ?? "tcp";
    demoTunnels.set(serverId, { ...current, state: transport === "udp" ? "running" : "connected", accountState: "verified", publicEndpoint: `demo.gl.joinmc.link:${current.localPort}`, matchingTunnel: true, message: transport === "udp" ? "Bedrock UDP接続先の候補を取得しました。接続診断で確認してください" : "Minecraft用の公開接続先を取得しました" });
  }),
  probeTunnelEndpoint: (serverId: string) => desktopOr<TunnelExternalProbe>("probe_tunnel_endpoint", { serverId }, () => {
    const current = demoTunnels.get(serverId); const endpoint = current?.publicEndpoint;
    const transport = current?.transport ?? "tcp";
    return { checkedAt: new Date().toISOString(), transport, attempted: Boolean(endpoint), reachable: false, endpoint, scope: "host-network", message: endpoint ? `ブラウザデモのため${transport.toUpperCase()}接続は実測していません。デスクトップ版と別回線で確認してください` : "公開接続先がまだ取得できていません" };
  }),
  auditLog: (serverId: string) => desktopOr<AuditEntry[]>("list_audit_log", { serverId }, () => [{ id: "demo", at: new Date().toISOString(), actor: "local-host", action: "server.view", detail: "ブラウザデモ" }]),
  whitelist: (serverId: string) => desktopOr<WhitelistEntry[]>("list_whitelist", { serverId }, () => [{ uuid: "demo-uuid", name: "Player123" }]),
  updateWhitelistPlayer: (serverId: string, playerName: string, add: boolean) => desktopOr<void>("update_whitelist_player", { serverId, playerName, add }, () => undefined),
  playerAccess: (serverId: string, kind: PlayerAccessKind) => desktopOr<PlayerAccessEntry[]>("list_player_access", { serverId, kind }, () => [...(demoPlayerAccess.get(serverId)?.[kind] ?? [])]),
  playerSkin: (playerName: string, playerId?: string) => desktopOr<string | null>("get_player_skin", { playerName, playerId }, () => null),
  updatePlayerAccess: (input: UpdatePlayerAccessInput) => desktopOr<void>("update_player_access", { input }, () => {
    const current = demoPlayerAccess.get(input.serverId) ?? { whitelist: [], bedrock_whitelist: [], operators: [], banned_players: [], banned_ips: [] };
    const entries = current[input.kind];
    if (input.add) {
      const label = input.kind === "banned_ips" ? input.target.replace(/^(\d+\.\d+)\..*$/, "$1.***.***") : input.target;
      const isRunning = demoStates.get(input.serverId)?.state === "running";
      const detail = input.kind === "banned_ips"
        ? "IPアドレスは安全のため一部を非表示"
        : isRunning ? "コマンド反映待ち" : "次回起動時に読み込み";
      current[input.kind] = [...entries, { id: `demo-${Date.now()}`, label, detail, level: input.kind === "operators" ? 4 : undefined, reason: input.reason }];
    } else {
      current[input.kind] = entries.filter((entry) => entry.id !== input.entryId && entry.label !== input.target);
    }
    demoPlayerAccess.set(input.serverId, current);
  }),
  listFixedPlayers: () => desktopOr<FixedPlayerPreset[]>("list_fixed_players", {}, () => [...demoFixedPlayers]),
  saveFixedPlayer: (input: SaveFixedPlayerInput) => desktopOr<FixedPlayerPreset>("save_fixed_player", { input }, () => {
    const existing = demoFixedPlayers.find((player) => player.id === input.id || (player.edition === input.edition && player.playerName.toLowerCase() === input.playerName.trim().toLowerCase()));
    const timestamp = new Date().toISOString();
    const saved: FixedPlayerPreset = {
      id: existing?.id ?? `fixed-${Date.now()}`,
      edition: input.edition,
      playerName: input.playerName.trim(),
      whitelist: input.whitelist,
      operator: input.operator,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    demoFixedPlayers = existing ? demoFixedPlayers.map((player) => player.id === existing.id ? saved : player) : [...demoFixedPlayers, saved];
    return saved;
  }),
  deleteFixedPlayer: (id: string) => desktopOr<void>("delete_fixed_player", { id }, () => { demoFixedPlayers = demoFixedPlayers.filter((player) => player.id !== id); }),
  openUninstallSettings: () => desktopOr<void>("open_windows_uninstall_settings", {}, () => undefined),
  listModpackProfiles: () => desktopOr<ModpackProfile[]>("list_modpack_profiles", {}, () => []),
  saveModpackProfile: (serverId: string, name: string) => desktopOr<ModpackProfile>("save_modpack_profile", { serverId, name }, () => demoProfile(serverId, name)),
  duplicateModpackProfile: (profileId: string) => desktopOr<ModpackProfile>("duplicate_modpack_profile", { profileId }, () => demoProfile("demo-paper", "プロファイルのコピー")),
  exportModpackProfile: (profileId: string, destination: string) => desktopOr<void>("export_modpack_profile", { profileId, destination }, () => undefined),
  importModpackProfile: (source: string) => desktopOr<ModpackProfile>("import_modpack_profile", { source }, () => demoProfile("imported", "インポートしたプロファイル")),
  compareModpackProfile: (serverId: string, profileId: string) => desktopOr<ProfileDiff>("compare_modpack_profile", { serverId, profileId }, () => ({ missingFromServer: ["mod:example-library.jar"], extraOnServer: [], configurationNotes: [] })),
  deleteModpackProfile: (profileId: string) => desktopOr<void>("delete_modpack_profile", { profileId }, () => undefined),
  checkUpdateSafety: (serverId: string, targetMinecraftVersion: string, targetServerType: string) => desktopOr<UpdateSafetyReport>("check_update_safety", { serverId, targetMinecraftVersion, targetServerType }, () => ({ checkedAt: new Date().toISOString(), safeToProceed: false, backupRecommended: true, compatibilityChecks: [`Minecraft更新先: ${targetMinecraftVersion}`, `サーバー種類: ${targetServerType}`], dependencyWarnings: ["ブラウザデモでは実ファイルの互換性を確認しません。"], affectedFiles: ["server.jar"], rollbackPossible: false, disclaimer: "デスクトップ版でローカル確認してください。更新は自動実行しません。" })),
  getUpdateCenter: (serverId: string) => desktopOr<UpdateCenterReport>("get_update_center", { serverId }, () => ({ checkedAt: new Date().toISOString(), items: [], unmanagedFiles: [], disclaimer: "ブラウザデモでは公式APIへ更新確認しません。" })),
  applyManagedExtensionUpdate: (input: ApplyManagedExtensionUpdateInput) => desktopOr<ExtensionInstallPlan>("apply_managed_extension_update", { input }, () => ({ provider: "modrinth", minecraftVersion: demoServers[0].minecraftVersion, loader: demoServers[0].serverType, kind: input.kind, items: [], totalSizeBytes: 0, warnings: [], clientRequirement: "ブラウザデモ" })),
  applyServerUpdate: (input: ApplyServerUpdateInput) => desktopOr<UpdateApplyResult>("apply_server_update", { input }, () => {
    const server = demoServers.find((item) => item.id === input.serverId); if (!server) throw new Error("サーバーが見つかりません");
    const updated = { ...server, minecraftVersion: input.targetMinecraftVersion, pendingRestart: true, updatedAt: new Date().toISOString() };
    demoServers = demoServers.map((item) => item.id === server.id ? updated : item);
    return { server: updated, backup: { id: `demo-before-update-${Date.now()}`, createdAt: new Date().toISOString(), sizeBytes: 1024, path: "C:\\Backups\\demo.zip", serverName: server.name, minecraftVersion: server.minecraftVersion, serverType: server.serverType, extensionSummary: "mods=0 plugins=0 datapacks=0", sha256: "demo", valid: true, schemaVersion: 2, kind: "before_update", displayName: "更新前", sourceSizeBytes: 2048, fileCount: 2, verifiedAt: new Date().toISOString(), pinned: true }, changedFiles: ["server.jar"], message: "デモ更新を適用しました。" };
  }),
};

function demoProfile(serverId: string, name: string): ModpackProfile {
  const server = demoServers.find((item) => item.id === serverId) ?? demoServers[0];
  return { id: crypto.randomUUID(), name, sourceServerId: server.id, minecraftVersion: server.minecraftVersion, serverType: server.serverType, loader: server.serverType, mods: [], plugins: [], datapacks: [], configurationFiles: [], settings: server.settings, recommendedMemoryMib: server.maxMemoryMib, plannedPlayers: server.settings.maxPlayers, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export async function selectFolder(): Promise<string | null> {
  if (!inDesktop) return "C:\\Servers";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title: "サーバーの保存先を選択" });
  return typeof selected === "string" ? selected : null;
}

export async function selectTunnelAgent(): Promise<string | null> {
  if (!inDesktop) return "C:\\Program Files\\playit\\playit.exe";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: false, title: "playit.gg公式エージェントを選択", filters: [{ name: "Windows実行ファイル", extensions: ["exe"] }] });
  return typeof selected === "string" ? selected : null;
}

export async function selectLogDestination(defaultName: string): Promise<string | null> {
  if (!inDesktop) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath: defaultName, filters: [{ name: "ログ", extensions: ["log", "txt"] }] });
}

export async function selectMigrationExport(defaultName: string): Promise<string | null> {
  if (!inDesktop) return `C:\\Downloads\\${defaultName}`;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath: defaultName, filters: [{ name: "Minecraft Server Hub Move", extensions: ["mshmove"] }] });
}

export async function selectMigrationImport(): Promise<string | null> {
  if (!inDesktop) return "C:\\Downloads\\server.mshmove";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: false, title: "サーバー引っ越しファイルを選択", filters: [{ name: "Minecraft Server Hub Move", extensions: ["mshmove"] }] });
  return typeof selected === "string" ? selected : null;
}

export async function selectExtensionFile(kind: ExtensionKind): Promise<string | null> {
  if (!inDesktop) return kind === "datapack" ? "C:\\Downloads\\example-datapack.zip" : "C:\\Downloads\\example-extension.jar";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: false, title: "追加するファイルを選択", filters: [{ name: kind === "datapack" ? "データパック" : "Java拡張", extensions: [kind === "datapack" ? "zip" : "jar"] }] });
  return typeof selected === "string" ? selected : null;
}

export async function selectProfileImport(): Promise<string | null> {
  if (!inDesktop) return "C:\\Downloads\\server-profile.json";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: false, title: "Modパックプロファイルを選択", filters: [{ name: "Minecraft Server Hub Profile", extensions: ["json"] }] });
  return typeof selected === "string" ? selected : null;
}

export async function selectProfileExport(defaultName: string): Promise<string | null> {
  if (!inDesktop) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath: defaultName, filters: [{ name: "Minecraft Server Hub Profile", extensions: ["json"] }] });
}

export async function confirmDanger(message: string): Promise<boolean> {
  if (!inDesktop) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title: "操作の確認", kind: "warning" });
}
