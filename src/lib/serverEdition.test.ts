import { describe, expect, it } from "vitest";
import { getClientEditionLabel, getCreateRuntimeMemoryDefaults, getDefaultServerPort, getServerEdition, getServerNetworkProtocol, getServerRuntimeKind, serverTypeLabel } from "./serverEdition";

describe("server edition model", () => {
  it("derives the native UDP Bedrock runtime without changing Java defaults", () => {
    expect(getServerEdition("bedrock")).toBe("bedrock");
    expect(getServerRuntimeKind("bedrock")).toBe("native");
    expect(getServerNetworkProtocol("bedrock")).toBe("udp");
    expect(getDefaultServerPort("bedrock")).toBe(19132);
    expect(getClientEditionLabel("bedrock")).toBe("Minecraft 統合版");
    expect(serverTypeLabel.bedrock).toBe("Bedrock Dedicated Server");
    expect(getCreateRuntimeMemoryDefaults("bedrock")).toEqual({ minMemoryMib: 0, maxMemoryMib: 0 });
  });

  it.each(["vanilla", "paper", "fabric", "forge", "neoforge"] as const)("keeps %s on Java TCP 25565", (serverType) => {
    expect(getServerEdition(serverType)).toBe("java");
    expect(getServerRuntimeKind(serverType)).toBe("java");
    expect(getServerNetworkProtocol(serverType)).toBe("tcp");
    expect(getDefaultServerPort(serverType)).toBe(25565);
    expect(getCreateRuntimeMemoryDefaults(serverType)).toEqual({ minMemoryMib: 1024, maxMemoryMib: 4096 });
  });

  it("derives the native UDP Palworld runtime without Java memory flags", () => {
    expect(getServerEdition("palworld")).toBe("palworld");
    expect(getServerRuntimeKind("palworld")).toBe("native");
    expect(getServerNetworkProtocol("palworld")).toBe("udp");
    expect(getDefaultServerPort("palworld")).toBe(8211);
    expect(serverTypeLabel.palworld).toBe("Palworld Dedicated Server");
    expect(getCreateRuntimeMemoryDefaults("palworld")).toEqual({ minMemoryMib: 0, maxMemoryMib: 0 });
  });
});
