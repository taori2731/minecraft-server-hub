import type { GameKind, NetworkProtocol, ServerProfile, ServerRuntimeKind, ServerType, TabId } from "../types";

export const MINECRAFT_TABS: readonly TabId[] = [
  "overview", "console", "players", "files", "extensions", "operations", "lab", "safety", "settings",
];

export const PALWORLD_TABS: readonly TabId[] = ["overview", "console", "players", "files", "operations", "settings"];

export interface GameCapabilities {
  tabs: readonly TabId[];
  console: boolean;
  livePlayers: boolean;
  playerAccessRules: boolean;
  fileManager: boolean;
  extensions: boolean;
  backups: boolean;
  updateCenter: boolean;
  safetyTools: boolean;
  localRestMonitoring: boolean;
}

const CAPABILITIES: Record<GameKind, GameCapabilities> = {
  minecraft: {
    tabs: MINECRAFT_TABS,
    console: true,
    livePlayers: true,
    playerAccessRules: true,
    fileManager: true,
    extensions: true,
    backups: true,
    updateCenter: true,
    safetyTools: true,
    localRestMonitoring: false,
  },
  palworld: {
    tabs: PALWORLD_TABS,
    console: true,
    livePlayers: true,
    playerAccessRules: false,
    fileManager: true,
    extensions: false,
    backups: true,
    updateCenter: false,
    safetyTools: false,
    localRestMonitoring: true,
  },
};

export function gameKindForServer(server: Pick<ServerProfile, "gameKind" | "serverType">): GameKind {
  return server.gameKind === "palworld" || server.serverType === "palworld" ? "palworld" : "minecraft";
}

export function isPalworldServer(server: Pick<ServerProfile, "gameKind" | "serverType">) {
  return gameKindForServer(server) === "palworld";
}

export function getRuntimeKindForServerType(serverType: ServerType): ServerRuntimeKind {
  return serverType === "bedrock" || serverType === "palworld" ? "native" : "java";
}

export function getNetworkProtocolForServerType(serverType: ServerType): NetworkProtocol {
  return serverType === "bedrock" || serverType === "palworld" ? "udp" : "tcp";
}

export function getDefaultPortForServerType(serverType: ServerType) {
  if (serverType === "palworld") return 8211;
  return serverType === "bedrock" ? 19132 : 25565;
}

export function getServerTabs(server: Pick<ServerProfile, "gameKind" | "serverType">): readonly TabId[] {
  return getGameCapabilities(server).tabs;
}

export function getGameCapabilities(server: Pick<ServerProfile, "gameKind" | "serverType">): GameCapabilities {
  return CAPABILITIES[gameKindForServer(server)];
}

export function getServerVersionLabel(server: Pick<ServerProfile, "gameKind" | "serverType" | "minecraftVersion">) {
  return isPalworldServer(server) ? server.minecraftVersion || "Dedicated Server" : server.minecraftVersion;
}

export function getServerMaxPlayers(server: Pick<ServerProfile, "gameKind" | "serverType" | "settings" | "palworldSettings">) {
  return isPalworldServer(server) ? server.palworldSettings?.maxPlayers ?? server.settings.maxPlayers : server.settings.maxPlayers;
}
