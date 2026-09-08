import type { NetworkProtocol, ServerEdition, ServerRuntimeKind, ServerType } from "../types";
import { getDefaultPortForServerType, getNetworkProtocolForServerType, getRuntimeKindForServerType } from "./gameAdapter";

export const serverTypeLabel: Record<ServerType, string> = {
  vanilla: "Vanilla",
  paper: "Paper",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  bedrock: "Bedrock Dedicated Server",
  palworld: "Palworld Dedicated Server",
};

export function getServerEdition(serverType: ServerType): ServerEdition {
  if (serverType === "palworld") return "palworld";
  return serverType === "bedrock" ? "bedrock" : "java";
}

export function getServerRuntimeKind(serverType: ServerType): ServerRuntimeKind {
  return getRuntimeKindForServerType(serverType);
}

export function getServerNetworkProtocol(serverType: ServerType): NetworkProtocol {
  return getNetworkProtocolForServerType(serverType);
}

export function getDefaultServerPort(serverType: ServerType): number {
  return getDefaultPortForServerType(serverType);
}

export function getClientEditionLabel(serverType: ServerType): string {
  if (serverType === "palworld") return "Palworld";
  return serverType === "bedrock" ? "Minecraft 統合版" : "Minecraft Java版";
}

export function getCreateRuntimeMemoryDefaults(serverType: ServerType): { minMemoryMib: number; maxMemoryMib: number } {
  return serverType === "bedrock" || serverType === "palworld"
    ? { minMemoryMib: 0, maxMemoryMib: 0 }
    : { minMemoryMib: 1024, maxMemoryMib: 4096 };
}
