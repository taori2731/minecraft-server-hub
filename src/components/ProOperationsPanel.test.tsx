import { describe, expect, it } from "vitest";
import { defaultMonitoring, monitoringWarnings } from "./ProOperationsPanel";
import type { RuntimeStatus, ServerProfile } from "../types";

const server = {
  id: "server-1", name: "重いサーバー", rootPath: "C:\\Server", serverType: "paper", minecraftVersion: "1.21.11",
  launchTarget: "server.jar", javaPath: "java", javaMajor: 21, minMemoryMib: 1024, maxMemoryMib: 4096,
  port: 25565, eulaAcceptedAt: "now", pendingRestart: false,
  settings: { defaultGameMode: "survival", difficulty: "normal", maxPlayers: 20, pvp: true, whitelist: true, allowCommands: false, onlineMode: true, allowFlight: false, forceGameMode: false, spawnProtection: 16, requireResourcePack: false, resourcePackUrl: "", resourcePackPrompt: "", worldName: "world", daylightCycle: true, spawnMonsters: true, spawnAnimals: true, viewDistance: 10, simulationDistance: 8 },
  createdAt: "now", updatedAt: "now",
} satisfies ServerProfile;

describe("Pro monitoring", () => {
  it("reports CPU, memory and TPS thresholds without external data", () => {
    const status: RuntimeStatus = { state: "running", playerCount: 2, maxPlayers: 20, memoryUsedMib: 3900, uptimeSeconds: 60, address: "localhost:25565", cpuPercent: 91, tps: 16.5, tpsSupported: true, pingLatencyMs: 3 };
    const warnings = monitoringWarnings([server], { [server.id]: status }, defaultMonitoring);
    expect(warnings).toEqual(expect.arrayContaining([
      "重いサーバー: Java CPU 91%",
      "重いサーバー: メモリ 95%",
      "重いサーバー: TPS 16.5",
    ]));
  });

  it("does not warn when monitoring is disabled", () => {
    const status: RuntimeStatus = { state: "crashed", playerCount: 0, maxPlayers: 20, memoryUsedMib: 0, uptimeSeconds: 0, address: "localhost:25565", cpuPercent: 0, tps: null, tpsSupported: true, pingLatencyMs: null };
    expect(monitoringWarnings([server], { [server.id]: status }, { ...defaultMonitoring, enabled: false })).toEqual([]);
  });
});
