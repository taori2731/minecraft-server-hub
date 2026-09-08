import type { GameKind, NetworkProtocol, ServerProfile, ServerRuntimeKind, ServerType, TabId } from "../types";

export const MINECRAFT_TABS: readonly TabId[] = [
  "overview", "console", "players", "files", "extensions", "operations", "lab", "safety", "settings",
];

export const PALWORLD_TABS: readonly TabId[] = ["overview", "console", "players", "operations", "settings"];

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
  return isPalworldServer(server) ? PALWORLD_TABS : MINECRAFT_TABS;
}

export function getServerVersionLabel(server: Pick<ServerProfile, "gameKind" | "serverType" | "minecraftVersion">) {
  return isPalworldServer(server) ? server.minecraftVersion || "Dedicated Server" : server.minecraftVersion;
}

export function getServerMaxPlayers(server: Pick<ServerProfile, "gameKind" | "serverType" | "settings" | "palworldSettings">) {
  return isPalworldServer(server) ? server.palworldSettings?.maxPlayers ?? server.settings.maxPlayers : server.settings.maxPlayers;
}
