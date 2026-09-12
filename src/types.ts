export type GameKind = "minecraft" | "palworld";
export type ServerType = "vanilla" | "paper" | "fabric" | "forge" | "neoforge" | "bedrock" | "palworld";
export type ServerEdition = "java" | "bedrock" | "palworld";
export type ServerRuntimeKind = "java" | "native";
export type NetworkProtocol = "tcp" | "udp";
export type WorldType = "minecraft:normal" | "minecraft:flat" | "minecraft:large_biomes" | "minecraft:amplified" | "DEFAULT" | "FLAT" | "LEGACY";
export type ServerState = "stopped" | "starting" | "running" | "stopping" | "crashed";
export type ThemeMode = "system" | "dark" | "light";
export type AccentTheme = "emerald" | "amethyst" | "ocean" | "copper" | "custom";
export type IconScale = "comfortable" | "compact";
export type TabId = "overview" | "console" | "players" | "files" | "extensions" | "operations" | "lab" | "safety" | "settings";

export interface AppearanceSettings {
  accent: AccentTheme;
  iconScale: IconScale;
  customAccent: string;
}

export interface MonitoringSettings {
  enabled: boolean;
  cpuWarningPercent: number;
  memoryWarningPercent: number;
  minimumTps: number;
  notifyOnCrash: boolean;
}

export interface BasicSettings {
  defaultGameMode: "survival" | "creative" | "adventure" | "spectator";
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  maxPlayers: number;
  pvp: boolean;
  whitelist: boolean;
  allowCommands: boolean;
  onlineMode: boolean;
  allowFlight: boolean;
  forceGameMode: boolean;
  spawnProtection: number;
  requireResourcePack: boolean;
  resourcePackUrl: string;
  resourcePackPrompt: string;
  worldName: string;
  /** Optional while loading profiles created before world-generation settings were added. */
  worldType?: WorldType;
  worldSeed?: string;
  generateStructures?: boolean;
  hardcore?: boolean;
  daylightCycle: boolean;
  spawnMonsters: boolean;
  spawnAnimals: boolean;
  viewDistance: number;
  simulationDistance: number;
  /** Bedrock Dedicated Server setting. Java profiles can omit it. */
  defaultPlayerPermissionLevel?: "visitor" | "member" | "operator";
  /** Bedrock Dedicated Server IPv6 port. */
  serverPortV6?: number;
  /** Bedrock LAN broadcast switch. */
  enableLanVisibility?: boolean;
}

export interface PalworldSettings {
  serverDescription: string;
  maxPlayers: number;
  restApiPort: number;
  restApiEnabled: boolean;
  backupEnabled: boolean;
  joinCodeConfigured?: boolean;
  expRate?: number;
  collectionDropRate?: number;
  palCaptureRate?: number;
  dayTimeSpeedRate?: number;
  nightTimeSpeedRate?: number;
  palEggDefaultHatchingTime?: number;
  deathPenalty?: "None" | "Item" | "ItemAndEquipment" | "All";
  invaderEnemiesEnabled?: boolean;
  fastTravelEnabled?: boolean;
  playerListEnabled?: boolean;
  joinLeaveMessagesEnabled?: boolean;
  voiceChatEnabled?: boolean;
  clientModsAllowed?: boolean;
  baseCampMaxNumInGuild?: number;
  baseCampWorkerMaxNum?: number;
}

export interface UpdatePalworldSettingsInput {
  serverId: string;
  name: string;
  gamePort: number;
  settings: PalworldSettings;
  /** Omit to keep the current join password; an empty string clears it. */
  serverPassword?: string;
  /** Omit to keep the current REST administrator password. */
  adminPassword?: string;
}

export interface PalworldPlayerSummary {
  name: string;
  accountName: string;
  playerId: string;
  userId: string;
  ping: number;
  level: number;
  buildingCount: number;
}

export interface PalworldRuntimeMetrics {
  apiReachable: boolean;
  version?: string;
  serverName?: string;
  worldGuid?: string;
  serverFps?: number;
  serverFrameTimeMs?: number;
  baseCampCount?: number;
  worldDays?: number;
  players: PalworldPlayerSummary[];
}

export interface ServerProfile {
  id: string;
  name: string;
  rootPath: string;
  /** Profiles created before the game-adapter migration are treated as Minecraft. */
  gameKind?: GameKind;
  serverType: ServerType;
  minecraftVersion: string;
  distributionBuild?: string;
  launchTarget: string;
  javaPath: string;
  javaMajor: number;
  minMemoryMib: number;
  maxMemoryMib: number;
  port: number;
  eulaAcceptedAt: string;
  pendingRestart: boolean;
  settings: BasicSettings;
  palworldSettings?: PalworldSettings | null;
  createdAt: string;
  updatedAt: string;
}

export interface JavaRuntime {
  executablePath: string;
  homePath: string;
  vendor: string;
  version: string;
  majorVersion: number;
  architecture: string;
  compatible: boolean;
  compatibilityMessage: string;
}

export interface JavaDownloadPlan {
  provider: string;
  distribution: string;
  majorVersion: number;
  releaseName: string;
  packageName: string;
  sizeBytes: number;
  checksumSha256: string;
  destinationPath: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
}

export interface VersionOption {
  id: string;
  channel: string;
}

export interface RuntimeStatus {
  state: ServerState;
  playerCount: number;
  maxPlayers: number;
  onlinePlayers?: string[];
  memoryUsedMib: number;
  uptimeSeconds: number;
  address: string;
  cpuPercent: number;
  tps: number | null;
  tpsSupported: boolean;
  pingLatencyMs: number | null;
  palworld?: PalworldRuntimeMetrics | null;
}

export interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | string;
  message: string;
}

export interface CreateServerInput {
  name: string;
  parentPath: string;
  gameKind: GameKind;
  serverType: ServerType;
  minecraftVersion: string;
  javaPath: string;
  javaMajor: number;
  minMemoryMib: number;
  maxMemoryMib: number;
  port: number;
  eulaAccepted: boolean;
  /** Official Bedrock Dedicated Server ZIP chosen by the user. */
  bedrockArchivePath?: string;
  palworldSettings?: PalworldSettings | null;
  settings: BasicSettings;
}

export interface PcDiagnosis {
  cpuName: string;
  physicalCores: number;
  logicalThreads: number;
  cpuUsagePercent: number;
  memoryTotalMib: number;
  memoryAvailableMib: number;
  gpuName: string;
  os: string;
  storageKind: string;
  storageFreeGib: number;
  storageAvailable: boolean;
  javaRuntimes: JavaRuntime[];
  recommendedMemoryMib: number;
  recommendedPlayers: number;
  recommendedViewDistance: number;
  recommendedSimulationDistance: number;
  warnings: string[];
  privacyNote: string;
}

export interface DeleteServerInput {
  serverId: string;
  deleteFiles: boolean;
  backupMode?: "full" | "essential" | "none";
  confirmationText: string;
}

export interface DeleteServerResult {
  deletedFiles: boolean;
  backupPath?: string;
}

export interface RegenerateWorldInput {
  serverId: string;
  confirmationName: string;
  settings: BasicSettings;
  maxMemoryMib: number;
  port: number;
}

export interface WorldRegenerationResult {
  server: ServerProfile;
  backup: BackupInfo;
  removedWorldFolders: string[];
}

export type BackupKind = "manual" | "scheduled" | "before_restore" | "before_settings" | "before_extension" | "before_update" | "before_world_regeneration" | "before_server_delete" | "before_crossplay_install" | "initial_import" | "legacy";

export interface BackupInfo {
  id: string;
  createdAt: string;
  sizeBytes: number;
  path: string;
  serverName: string;
  minecraftVersion: string;
  serverType: string;
  extensionSummary: string;
  sha256: string;
  valid: boolean;
  schemaVersion: number;
  kind: BackupKind;
  displayName: string;
  sourceSizeBytes: number;
  fileCount: number;
  verifiedAt?: string;
  pinned: boolean;
  scheduleId?: string;
}

export interface BackupProgress {
  serverId: string;
  stage: "scanning" | "creating" | "verifying" | "completed" | string;
  bytesProcessed: number;
  totalBytes: number;
  filesProcessed: number;
  totalFiles: number;
  percent: number;
}

export interface DiagnosisIssue {
  id: string;
  severity: "error" | "warning" | "info" | string;
  whatHappened: string;
  impact: string;
  likelyCause: string;
  nextActions: string[];
  relatedLogs: string[];
  suggestRestore: boolean;
}

export interface ServerDiagnosisReport {
  checkedAt: string;
  healthy: boolean;
  issues: DiagnosisIssue[];
  redactionNote: string;
}

export type ExtensionKind = "mod" | "plugin" | "datapack" | "behavior_pack" | "resource_pack" | "addon";
export type ExtensionProvider = "modrinth" | "local";
export interface ExtensionInfo {
  fileName: string;
  kind: ExtensionKind;
  enabled: boolean;
  sizeBytes: number;
  compatibility: string;
  clientRequirement: string;
  manageable: boolean;
}
export interface ExtensionSearchHit {
  projectId: string;
  title: string;
  description: string;
  author: string;
  versions: string[];
  allProjectTypes: string[];
  categories: string[];
  environment: string[];
  iconUrl?: string;
  downloads: number;
  provider: ExtensionProvider;
  /** Official project page supplied by the provider, when available. */
  sourceUrl?: string;
}

export interface ExtensionVersionOption {
  id: string;
  name: string;
  versionNumber: string;
  releaseChannel: "release" | "beta" | "alpha" | string;
  publishedAt: string;
  fileName: string;
  sizeBytes: number;
  requiredDependencyCount: number;
  clientRequirement: string;
}
export interface ExtensionInstallItem {
  projectId: string;
  versionId: string;
  fileName: string;
  versionNumber: string;
  sizeBytes: number;
  dependency: boolean;
}
export interface ExtensionInstallPlan {
  provider: ExtensionProvider;
  minecraftVersion: string;
  loader: string;
  kind: ExtensionKind;
  items: ExtensionInstallItem[];
  totalSizeBytes: number;
  warnings: string[];
  clientRequirement: string;
}

export interface ExternalProvider {
  id: string; name: string; account: string; price: string; limits: string; privacy: string; status: string;
}
export interface InviteInfo { lanAddresses: string[]; hostAddress: string; port: number; whitelistRecommended: boolean; externalProviders: ExternalProvider[]; }
export interface InviteSettings {
  inviteName: string;
  customHostname?: string;
  updatedAt: string;
}
export interface UpdateInviteSettingsInput {
  serverId: string;
  inviteName: string;
  customHostname?: string;
}
export interface PublicAccessStatus {
  state: "stopped" | "published" | "warning" | string;
  address?: string;
  namedAddress?: string;
  inviteName: string;
  customHostname?: string;
  hostnameState: "not_configured" | "pending" | "verified" | "mismatch" | "unresolved" | string;
  hostnameMessage: string;
  method: string;
  expiresAt?: string;
  message: string;
  homeIpExposed: boolean;
}

export type TunnelState = "unconfigured" | "preparing" | "starting" | "running" | "connected" | "disconnected" | "error" | "stopping" | "awaiting_terms" | "awaiting_login";
export interface TunnelStatus {
  serverId: string;
  providerId: string;
  state: TunnelState;
  localHost: string;
  localPort: number;
  agentPath?: string;
  agentVersion?: string;
  agentVerified: boolean;
  termsAcknowledged: boolean;
  publicEndpoint?: string;
  accountState: "unknown" | "not_configured" | "invalid" | "guest" | "email_not_verified" | "verified" | string;
  pendingTunnelCount: number;
  providerNotices: string[];
  matchingTunnel: boolean;
  message: string;
  lastCheckedAt?: string;
  recentLogs: string[];
  /** Explicit when supplied by the native backend; otherwise derived from server type. */
  transport?: NetworkProtocol;
}
export interface ValidateTunnelAgentInput { serverId: string; providerId: string; agentPath: string; }
export interface TunnelAgentValidation {
  valid: boolean; providerId: string; agentPath: string; version?: string; sha256: string;
  verificationMethod: string; message: string;
}
export interface TunnelAgentInstallPlan {
  providerId: string; version: string; sourceUrl: string; sizeBytes: number; checksumSha256: string;
  publisher: string; licenseName: string; licenseUrl: string; installScope: string; installPath: string;
  temporaryPath: string; alreadyInstalled: boolean; installedValidation?: TunnelAgentValidation;
}
export interface InstallTunnelAgentInput {
  serverId: string; version: string; sourceUrl: string; sizeBytes: number; checksumSha256: string;
}
export interface StartTunnelInput { serverId: string; providerId: string; agentPath: string; termsAccepted: boolean; }
export interface QuickStartTunnelInput { serverId: string; termsAccepted: boolean; }
export interface TunnelDiagnosis {
  checkedAt: string; serverRunning: boolean; localPortListening: boolean; agentConfigured: boolean;
  agentVerified: boolean; agentRunning: boolean; providerAuthenticated: boolean; matchingTunnel: boolean;
  tunnelConnected: boolean; endpointAvailable: boolean; items: string[];
  transport?: NetworkProtocol;
}
export interface TunnelExternalProbe {
  checkedAt: string; attempted: boolean; reachable: boolean; endpoint?: string;
  scope: "host-network" | string; message: string;
  transport?: NetworkProtocol;
}

export interface AuditEntry { id: string; at: string; actor: string; action: string; detail: string; }
export interface WhitelistEntry { uuid: string; name: string; }
export type PlayerAccessKind = "whitelist" | "bedrock_whitelist" | "operators" | "banned_players" | "banned_ips";
export interface PlayerAccessEntry {
  id: string;
  label: string;
  detail: string;
  level?: number;
  reason?: string;
  expires?: string;
  pending?: boolean;
}
export interface UpdatePlayerAccessInput {
  serverId: string;
  kind: PlayerAccessKind;
  target: string;
  entryId?: string;
  add: boolean;
  reason?: string;
}

export interface FixedPlayerPreset {
  id: string;
  edition: "java" | "bedrock";
  playerName: string;
  whitelist: boolean;
  operator: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveFixedPlayerInput {
  id?: string;
  edition: "java" | "bedrock";
  playerName: string;
  whitelist: boolean;
  operator: boolean;
}

export interface ImportPreview {
  rootPath: string;
  suggestedName: string;
  serverType: ServerType;
  minecraftVersion: string;
  distributionBuild?: string;
  serverJar?: string;
  worldFolders: string[];
  modCount: number;
  pluginCount: number;
  datapackCount: number;
  behaviorPackCount?: number;
  resourcePackCount?: number;
  port: number;
  minMemoryMib: number;
  maxMemoryMib: number;
  eulaAccepted: boolean;
  javaRuntimes: JavaRuntime[];
  settings: BasicSettings;
  warnings: string[];
  canImport: boolean;
  sourceFingerprint: string;
}

export interface ImportServerInput {
  rootPath: string;
  name: string;
  javaPath: string;
  javaMajor: number;
  createInitialBackup: boolean;
  sourceFingerprint: string;
}

export interface ProfileEntry { fileName: string; version: string; dependencyNote: string; clientRequirement: string; }
export interface ModpackProfile {
  id: string; name: string; sourceServerId: string; minecraftVersion: string; serverType: string; loader: string;
  mods: ProfileEntry[]; plugins: ProfileEntry[]; datapacks: ProfileEntry[]; configurationFiles: string[]; settings: BasicSettings;
  recommendedMemoryMib: number; plannedPlayers: number; createdAt: string; updatedAt: string;
}
export interface ProfileDiff { missingFromServer: string[]; extraOnServer: string[]; configurationNotes: string[]; }
export interface UpdateSafetyReport { checkedAt: string; safeToProceed: boolean; backupRecommended: boolean; latestBackupAt?: string; compatibilityChecks: string[]; dependencyWarnings: string[]; affectedFiles: string[]; rollbackPossible: boolean; disclaimer: string; }
export interface ApplyServerUpdateInput { serverId: string; targetMinecraftVersion: string; targetServerType: ServerType; confirmationName: string; acceptWarnings: boolean; }
export interface UpdateApplyResult { server: ServerProfile; backup: BackupInfo; changedFiles: string[]; message: string; }
export interface AutomationSettings {
  serverId: string; autoStopEnabled: boolean; idleMinutes: number;
  notifyStartup: boolean; notifyPlayerJoin: boolean; notifyCrash: boolean; notifyBackupFailure: boolean; updatedAt: string;
}
export interface ExtensionCheckItem { severity: "error" | "warning" | "info" | string; code: string; title: string; detail: string; files: string[]; nextAction: string; }
export interface ExtensionCheckReport { checkedAt: string; blocking: boolean; scannedFiles: number; managedFiles: number; items: ExtensionCheckItem[]; limitation: string; }
export interface MigrationManifest {
  schemaVersion: number; createdAt: string; sourceServerName: string; serverType: ServerType; minecraftVersion: string; distributionBuild?: string;
  launchTarget: string; javaMajor: number; minMemoryMib: number; maxMemoryMib: number; port: number; settings: BasicSettings;
  fileCount: number; sourceSizeBytes: number; archiveSha256: string;
}
export interface MigrationExportResult { path: string; manifest: MigrationManifest; }
export interface RestoreMigrationInput { archivePath: string; parentPath: string; serverName: string; javaPath: string; javaMajor: number; }
export interface UpdateCenterItem {
  id: string; kind: string; name: string; currentVersion: string; availableVersion: string; source: string; managed: boolean; selectable: boolean;
  requiresClientUpdate: boolean; note: string; projectId?: string; versionId?: string; extensionKind?: ExtensionKind;
}
export interface UpdateCenterReport { checkedAt: string; items: UpdateCenterItem[]; unmanagedFiles: string[]; disclaimer: string; }
export interface ApplyManagedExtensionUpdateInput { serverId: string; projectId: string; versionId: string; kind: ExtensionKind; }

export interface AppUpdateInfo {
  configured: boolean;
  currentVersion: string;
  available: boolean;
  version?: string;
  notes?: string;
  publishedAt?: string;
}

export interface AppUpdateProgress {
  phase: "downloading" | "verified";
  downloadedBytes: number;
  totalBytes?: number;
}

export interface CrossplayComponent {
  project: string;
  version: string;
  build: number;
  fileName: string;
  sha256: string;
  installed: boolean;
}

export interface CrossplayPlan {
  eligible: boolean;
  bedrockPort: number;
  geyser?: CrossplayComponent;
  floodgate?: CrossplayComponent;
  warnings: string[];
  nextSteps: string[];
  sourceUrl: string;
}

export interface CrossplayInstallInput {
  serverId: string;
  includeFloodgate: boolean;
  bedrockPort: number;
  acceptWarnings: boolean;
}

export interface CrossplayInstallResult {
  backup: BackupInfo;
  installedFiles: string[];
  bedrockPort: number;
  restartRequired: boolean;
  message: string;
}

export interface CrossplayStatus {
  eligible: boolean;
  installed: boolean;
  bedrockPort?: number;
  floodgateInstalled: boolean;
  configurationGenerated: boolean;
  configurationReady: boolean;
}

export interface CrossplayConfigurationResult {
  backup: BackupInfo;
  bedrockPort: number;
  floodgateEnabled: boolean;
  message: string;
}
