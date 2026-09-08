import type { BasicSettings, ServerProfile, ServerType } from "../types";

export type PlaystylePresetId = "survival" | "creative" | "peaceful" | "pvp";
export type PerformancePresetId = "eco" | "balanced" | "range";

export interface ServerLabDraft {
  settings: BasicSettings;
  memoryMib: number;
  port: number;
}

export interface ServerLabDiff {
  key: string;
  property: string;
  before: string;
  after: string;
}

export type ServerLabAuditId = "authentication" | "allowlist" | "defaultPermission" | "resourcePack" | "port" | "hardcore";

export interface ServerLabAuditItem {
  id: ServerLabAuditId;
  passed: boolean;
}

export interface PortInspection {
  valid: boolean;
  isDefault: boolean;
  isDynamic: boolean;
  systemReserved: boolean;
}

export interface StoredServerLabDraft {
  schemaVersion: 1;
  serverId: string;
  savedAt: string;
  settings: BasicSettings;
  memoryMib: number;
  port: number;
}

const LAB_DRAFT_PREFIX = "server-hub:server-lab-draft:v1:";

const JAVA_PROPERTIES: ReadonlyArray<[keyof BasicSettings, string]> = [
  ["defaultGameMode", "gamemode"],
  ["difficulty", "difficulty"],
  ["maxPlayers", "max-players"],
  ["pvp", "pvp"],
  ["whitelist", "white-list"],
  ["allowCommands", "enable-command-block"],
  ["onlineMode", "online-mode"],
  ["allowFlight", "allow-flight"],
  ["forceGameMode", "force-gamemode"],
  ["spawnProtection", "spawn-protection"],
  ["requireResourcePack", "require-resource-pack"],
  ["resourcePackUrl", "resource-pack"],
  ["resourcePackPrompt", "resource-pack-prompt"],
  ["worldName", "level-name"],
  ["worldType", "level-type"],
  ["worldSeed", "level-seed"],
  ["generateStructures", "generate-structures"],
  ["hardcore", "hardcore"],
  ["daylightCycle", "doDaylightCycle"],
  ["spawnMonsters", "spawn-monsters"],
  ["spawnAnimals", "spawn-animals"],
  ["viewDistance", "view-distance"],
  ["simulationDistance", "simulation-distance"],
];

const BEDROCK_PROPERTIES: ReadonlyArray<[keyof BasicSettings, string]> = [
  ["defaultGameMode", "gamemode"],
  ["difficulty", "difficulty"],
  ["maxPlayers", "max-players"],
  ["whitelist", "allow-list"],
  ["allowCommands", "allow-cheats"],
  ["onlineMode", "online-mode"],
  ["forceGameMode", "force-gamemode"],
  ["requireResourcePack", "texturepack-required"],
  ["worldName", "level-name"],
  ["worldType", "level-type"],
  ["worldSeed", "level-seed"],
  ["viewDistance", "view-distance"],
  ["simulationDistance", "tick-distance"],
  ["defaultPlayerPermissionLevel", "default-player-permission-level"],
  ["serverPortV6", "server-portv6"],
  ["enableLanVisibility", "enable-lan-visibility"],
];

export function createServerLabDraft(server: ServerProfile): ServerLabDraft {
  return { settings: { ...server.settings }, memoryMib: server.maxMemoryMib, port: server.port };
}

export function applyPlaystylePreset(draft: ServerLabDraft, preset: PlaystylePresetId, serverType: ServerType): ServerLabDraft {
  const common: Partial<BasicSettings> = preset === "survival" ? {
    defaultGameMode: "survival", difficulty: "normal", pvp: true, forceGameMode: false,
    spawnMonsters: true, spawnAnimals: true, hardcore: false,
  } : preset === "creative" ? {
    defaultGameMode: "creative", difficulty: "peaceful", pvp: false, forceGameMode: true,
    allowFlight: true, allowCommands: serverType === "bedrock" ? true : draft.settings.allowCommands,
    spawnMonsters: false, spawnAnimals: true, hardcore: false,
  } : preset === "peaceful" ? {
    defaultGameMode: "survival", difficulty: "peaceful", pvp: false, forceGameMode: false,
    spawnMonsters: false, spawnAnimals: true, hardcore: false,
  } : {
    defaultGameMode: "survival", difficulty: "hard", pvp: true, forceGameMode: true,
    spawnProtection: 0, spawnMonsters: false, spawnAnimals: false, hardcore: false,
  };
  return { ...draft, settings: { ...draft.settings, ...common } };
}

export function applyPerformancePreset(draft: ServerLabDraft, preset: PerformancePresetId, serverType: ServerType): ServerLabDraft {
  const distances = preset === "eco"
    ? { viewDistance: 5, simulationDistance: 4 }
    : preset === "balanced"
      ? { viewDistance: 10, simulationDistance: serverType === "bedrock" ? 6 : 8 }
      : { viewDistance: 16, simulationDistance: serverType === "bedrock" ? 12 : 10 };
  return { ...draft, settings: { ...draft.settings, ...distances } };
}

export function estimateRecommendedMemoryMib(
  plannedPlayers: number,
  serverType: ServerType,
  viewDistance: number,
  simulationDistance: number,
  totalMemoryMib?: number,
): number {
  if (serverType === "bedrock") return 0;
  const modded = ["fabric", "forge", "neoforge"].includes(serverType);
  const base = modded ? 3_072 : serverType === "paper" ? 2_048 : 1_536;
  const playerCost = Math.max(0, Math.ceil(plannedPlayers) - 2) * (modded ? 384 : 256);
  const distanceCost = Math.max(0, viewDistance - 8) * 96 + Math.max(0, simulationDistance - 6) * 128;
  const raw = Math.ceil((base + playerCost + distanceCost) / 1_024) * 1_024;
  const safeUpper = totalMemoryMib
    ? Math.max(1_024, Math.floor(Math.max(1_024, totalMemoryMib - 4_096) / 1_024) * 1_024)
    : 65_536;
  return Math.max(1_024, Math.min(65_536, safeUpper, raw));
}

export function estimatePlayerCapacity(
  memoryMib: number,
  serverType: ServerType,
  viewDistance: number,
  simulationDistance: number,
): number {
  if (serverType === "bedrock") {
    const distancePenalty = Math.max(0, viewDistance - 10) + Math.max(0, simulationDistance - 6) * 2;
    return Math.max(2, Math.min(100, 24 - distancePenalty));
  }
  const modded = ["fabric", "forge", "neoforge"].includes(serverType);
  const base = modded ? 3_072 : serverType === "paper" ? 2_048 : 1_536;
  const distanceCost = Math.max(0, viewDistance - 8) * 96 + Math.max(0, simulationDistance - 6) * 128;
  const perPlayer = modded ? 384 : 256;
  return Math.max(1, Math.min(500, 2 + Math.floor(Math.max(0, memoryMib - base - distanceCost) / perPlayer)));
}

export function estimateChunkSquare(radius: number): number {
  const safeRadius = Math.max(0, Math.floor(radius));
  return (safeRadius * 2 + 1) ** 2;
}

export function spawnProtectionFootprint(radius: number): { diameter: number; blocks: number } {
  const safeRadius = Math.max(0, Math.floor(radius));
  const diameter = safeRadius * 2 + 1;
  return { diameter, blocks: diameter ** 2 };
}

export function generateWorldSeed(randomValues?: Uint32Array): string {
  const values = randomValues ?? crypto.getRandomValues(new Uint32Array(2));
  const unsigned = (BigInt(values[0] ?? 0) << 32n) | BigInt(values[1] ?? 0);
  const signed = unsigned > 0x7fff_ffff_ffff_ffffn ? unsigned - 0x1_0000_0000_0000_0000n : unsigned;
  return signed.toString();
}

export function inspectServerPort(port: number, serverType: ServerType): PortInspection {
  const valid = Number.isInteger(port) && port >= 1_024 && port <= 65_535;
  return {
    valid,
    isDefault: port === (serverType === "bedrock" ? 19_132 : 25_565),
    isDynamic: valid && port >= 49_152,
    systemReserved: !Number.isInteger(port) || port < 1_024,
  };
}

export function auditServerLabDraft(draft: ServerLabDraft, serverType: ServerType): ServerLabAuditItem[] {
  const settings = draft.settings;
  return [
    { id: "authentication", passed: settings.onlineMode },
    { id: "allowlist", passed: settings.whitelist },
    { id: "defaultPermission", passed: serverType !== "bedrock" || (settings.defaultPlayerPermissionLevel ?? "member") !== "operator" },
    { id: "resourcePack", passed: !settings.requireResourcePack || serverType === "bedrock" || /^https?:\/\/\S+$/i.test(settings.resourcePackUrl.trim()) },
    { id: "port", passed: inspectServerPort(draft.port, serverType).valid },
    { id: "hardcore", passed: !settings.hardcore || (settings.defaultGameMode === "survival" && settings.difficulty === "hard") },
  ];
}

function displayValue(value: BasicSettings[keyof BasicSettings] | number | undefined): string {
  if (value === undefined) return "";
  return String(value);
}

export function diffServerLabDraft(server: ServerProfile, draft: ServerLabDraft): ServerLabDiff[] {
  const properties = server.serverType === "bedrock" ? BEDROCK_PROPERTIES : JAVA_PROPERTIES;
  const changes = properties.flatMap(([key, property]) => {
    const before = displayValue(server.settings[key]);
    const after = displayValue(draft.settings[key]);
    return before === after ? [] : [{ key: String(key), property, before, after }];
  });
  if (server.serverType !== "bedrock" && server.maxMemoryMib !== draft.memoryMib) {
    changes.push({ key: "memoryMib", property: "-Xmx", before: `${server.maxMemoryMib}M`, after: `${draft.memoryMib}M` });
  }
  if (server.port !== draft.port) {
    changes.push({ key: "port", property: "server-port", before: String(server.port), after: String(draft.port) });
  }
  return changes;
}

export function formatPropertiesPatch(server: ServerProfile, draft: ServerLabDraft): string {
  const changes = diffServerLabDraft(server, draft);
  return [
    "# Minecraft Server Hub - configuration draft",
    `# ${server.name} / ${server.serverType} / ${server.minecraftVersion}`,
    "# Review only: apply through the app to create a safety backup.",
    ...changes.map((change) => `${change.property}=${change.after}`),
  ].join("\n");
}

export function serverLabDraftStorageKey(serverId: string): string {
  return `${LAB_DRAFT_PREFIX}${serverId}`;
}

export function saveServerLabDraft(storage: Pick<Storage, "setItem">, server: ServerProfile, draft: ServerLabDraft, savedAt = new Date().toISOString()): StoredServerLabDraft {
  const stored: StoredServerLabDraft = {
    schemaVersion: 1,
    serverId: server.id,
    savedAt,
    settings: { ...draft.settings, resourcePackUrl: "", resourcePackPrompt: "" },
    memoryMib: draft.memoryMib,
    port: draft.port,
  };
  storage.setItem(serverLabDraftStorageKey(server.id), JSON.stringify(stored));
  return stored;
}

export function loadServerLabDraft(storage: Pick<Storage, "getItem">, server: ServerProfile): StoredServerLabDraft | null {
  const raw = storage.getItem(serverLabDraftStorageKey(server.id));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredServerLabDraft>;
    if (value.schemaVersion !== 1 || value.serverId !== server.id || !value.settings
      || !Number.isInteger(value.port) || Number(value.port) < 1_024 || Number(value.port) > 65_535
      || !Number.isInteger(value.memoryMib) || Number(value.memoryMib) < 0) return null;
    return {
      ...value,
      schemaVersion: 1,
      serverId: server.id,
      savedAt: String(value.savedAt ?? ""),
      settings: {
        ...server.settings,
        ...value.settings,
        resourcePackUrl: server.settings.resourcePackUrl,
        resourcePackPrompt: server.settings.resourcePackPrompt,
      },
      memoryMib: Number(value.memoryMib),
      port: Number(value.port),
    } as StoredServerLabDraft;
  } catch {
    return null;
  }
}
