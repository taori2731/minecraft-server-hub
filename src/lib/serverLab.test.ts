import { describe, expect, it } from "vitest";
import type { BasicSettings, ServerProfile } from "../types";
import {
  applyPerformancePreset,
  applyPlaystylePreset,
  auditServerLabDraft,
  createServerLabDraft,
  diffServerLabDraft,
  estimateChunkSquare,
  estimatePlayerCapacity,
  estimateRecommendedMemoryMib,
  formatPropertiesPatch,
  generateWorldSeed,
  inspectServerPort,
  loadServerLabDraft,
  saveServerLabDraft,
  serverLabDraftStorageKey,
  spawnProtectionFootprint,
} from "./serverLab";

const settings: BasicSettings = {
  defaultGameMode: "survival", difficulty: "normal", maxPlayers: 20, pvp: true,
  whitelist: false, allowCommands: false, onlineMode: true, allowFlight: false,
  forceGameMode: false, spawnProtection: 16, requireResourcePack: false,
  resourcePackUrl: "https://example.test/pack.zip?secret=do-not-store", resourcePackPrompt: "Secret prompt",
  worldName: "world", worldType: "minecraft:normal", worldSeed: "", generateStructures: true,
  hardcore: false, daylightCycle: true, spawnMonsters: true, spawnAnimals: true,
  viewDistance: 10, simulationDistance: 8, defaultPlayerPermissionLevel: "member",
  serverPortV6: 19133, enableLanVisibility: true,
};

const server: ServerProfile = {
  id: "server-1", name: "Lab World", rootPath: "C:\\Servers\\Lab", serverType: "paper",
  minecraftVersion: "1.21.11", launchTarget: "paper.jar", javaPath: "java", javaMajor: 21,
  minMemoryMib: 1024, maxMemoryMib: 4096, port: 25565, eulaAcceptedAt: "2026-08-28T00:00:00Z",
  pendingRestart: false, settings, createdAt: "2026-08-28T00:00:00Z", updatedAt: "2026-08-28T00:00:00Z",
};

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("server lab", () => {
  it("creates an isolated draft without mutating the profile", () => {
    const draft = createServerLabDraft(server);
    draft.settings.maxPlayers = 99;
    expect(server.settings.maxPlayers).toBe(20);
  });

  it("applies each playstyle as an unsaved draft", () => {
    const original = createServerLabDraft(server);
    expect(applyPlaystylePreset(original, "creative", "paper").settings).toMatchObject({ defaultGameMode: "creative", difficulty: "peaceful", pvp: false, allowFlight: true });
    expect(applyPlaystylePreset(original, "peaceful", "paper").settings.spawnMonsters).toBe(false);
    expect(applyPlaystylePreset(original, "pvp", "paper").settings.spawnProtection).toBe(0);
    expect(server.settings.defaultGameMode).toBe("survival");
  });

  it("uses edition-safe performance distances", () => {
    const draft = createServerLabDraft(server);
    expect(applyPerformancePreset(draft, "eco", "paper").settings).toMatchObject({ viewDistance: 5, simulationDistance: 4 });
    expect(applyPerformancePreset(draft, "range", "bedrock").settings.simulationDistance).toBe(12);
  });

  it("calculates a RAM estimate and leaves headroom on a known PC", () => {
    expect(estimateRecommendedMemoryMib(20, "paper", 10, 8, 16_384)).toBeGreaterThanOrEqual(6_144);
    expect(estimateRecommendedMemoryMib(100, "forge", 32, 32, 8_192)).toBe(4_096);
    expect(estimateRecommendedMemoryMib(20, "bedrock", 10, 6, 16_384)).toBe(0);
  });

  it("estimates player capacity conservatively for modded servers", () => {
    expect(estimatePlayerCapacity(8_192, "paper", 10, 8)).toBeGreaterThan(estimatePlayerCapacity(8_192, "forge", 10, 8));
    expect(estimatePlayerCapacity(1_024, "vanilla", 32, 32)).toBe(2);
  });

  it("calculates square chunk candidates and spawn footprint", () => {
    expect(estimateChunkSquare(10)).toBe(441);
    expect(spawnProtectionFootprint(16)).toEqual({ diameter: 33, blocks: 1089 });
  });

  it("generates signed 64-bit numeric seeds", () => {
    expect(generateWorldSeed(new Uint32Array([0, 42]))).toBe("42");
    expect(generateWorldSeed(new Uint32Array([0xffffffff, 0xffffffff]))).toBe("-1");
  });

  it("classifies default, dynamic, and invalid ports", () => {
    expect(inspectServerPort(25565, "paper")).toMatchObject({ valid: true, isDefault: true, isDynamic: false });
    expect(inspectServerPort(50000, "paper")).toMatchObject({ valid: true, isDefault: false, isDynamic: true });
    expect(inspectServerPort(80, "paper")).toMatchObject({ valid: false, systemReserved: true });
    expect(inspectServerPort(19132, "bedrock").isDefault).toBe(true);
  });

  it("audits authentication, allowlist, permissions, URLs, ports, and hardcore consistency", () => {
    const draft = createServerLabDraft({ ...server, serverType: "bedrock", port: 19132, settings: { ...settings, whitelist: true, defaultPlayerPermissionLevel: "operator" } });
    const result = Object.fromEntries(auditServerLabDraft(draft, "bedrock").map((item) => [item.id, item.passed]));
    expect(result).toMatchObject({ authentication: true, allowlist: true, defaultPermission: false, resourcePack: true, port: true, hardcore: true });
  });

  it("shows only changed server.properties values", () => {
    const draft = createServerLabDraft(server);
    draft.settings.viewDistance = 6;
    draft.memoryMib = 6144;
    draft.port = 25570;
    const changes = diffServerLabDraft(server, draft);
    expect(changes.map((change) => change.property)).toEqual(["view-distance", "-Xmx", "server-port"]);
  });

  it("formats a review-only property patch", () => {
    const draft = createServerLabDraft(server);
    draft.settings.pvp = false;
    const text = formatPropertiesPatch(server, draft);
    expect(text).toContain("pvp=false");
    expect(text).toContain("apply through the app to create a safety backup");
    expect(text).not.toContain("resource-pack=");
  });

  it("stores drafts locally without resource-pack secrets", () => {
    const storage = new MemoryStorage();
    const stored = saveServerLabDraft(storage, server, createServerLabDraft(server), "2026-08-28T12:00:00Z");
    const raw = storage.getItem(serverLabDraftStorageKey(server.id)) ?? "";
    expect(stored.savedAt).toBe("2026-08-28T12:00:00Z");
    expect(raw).not.toContain("do-not-store");
    expect(raw).not.toContain("Secret prompt");
  });

  it("restores safe fields while preserving current resource-pack values", () => {
    const storage = new MemoryStorage();
    const draft = createServerLabDraft(server);
    draft.settings.maxPlayers = 48;
    saveServerLabDraft(storage, server, draft);
    const restored = loadServerLabDraft(storage, server);
    expect(restored?.settings.maxPlayers).toBe(48);
    expect(restored?.settings.resourcePackUrl).toBe(server.settings.resourcePackUrl);
  });

  it("rejects corrupt and mismatched drafts", () => {
    const storage = new MemoryStorage();
    storage.setItem(serverLabDraftStorageKey(server.id), "not-json");
    expect(loadServerLabDraft(storage, server)).toBeNull();
    storage.setItem(serverLabDraftStorageKey(server.id), JSON.stringify({ schemaVersion: 1, serverId: "other", port: 25565, memoryMib: 4096, settings }));
    expect(loadServerLabDraft(storage, server)).toBeNull();
  });
});
