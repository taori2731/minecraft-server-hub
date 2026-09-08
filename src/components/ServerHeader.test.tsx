import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BasicSettings, RuntimeStatus, ServerProfile, ServerType } from "../types";
import { ServerHeader } from "./ServerHeader";

const settings: BasicSettings = {
  defaultGameMode: "survival", difficulty: "normal", maxPlayers: 10, pvp: true, whitelist: true,
  allowCommands: false, onlineMode: true, allowFlight: false, forceGameMode: false, spawnProtection: 16,
  requireResourcePack: false, resourcePackUrl: "", resourcePackPrompt: "", worldName: "world",
  daylightCycle: true, spawnMonsters: true, spawnAnimals: true, viewDistance: 10, simulationDistance: 8,
};
const status: RuntimeStatus = { state: "stopped", playerCount: 0, maxPlayers: 10, memoryUsedMib: 0, uptimeSeconds: 0, address: "localhost:25565", cpuPercent: 0, tps: null, tpsSupported: false, pingLatencyMs: null };

function profile(serverType: ServerType): ServerProfile {
  return { id: serverType, name: `${serverType} server`, rootPath: "C:\\Servers\\test", serverType, minecraftVersion: "1.20.1", distributionBuild: serverType === "forge" ? "1.20.1-47.4.10" : serverType === "bedrock" ? "bds-sha256:1c02222f32256a8b44ad27720c8e1e945b62ed48e7480bef8b" : undefined, launchTarget: "server.jar", javaPath: "java.exe", javaMajor: 17, minMemoryMib: 1024, maxMemoryMib: 4096, port: 25565, eulaAcceptedAt: "test", pendingRestart: false, settings, createdAt: "test", updatedAt: "test" };
}

describe("ServerHeader", () => {
  it.each([
    ["vanilla", "Vanilla"], ["paper", "Paper"], ["fabric", "Fabric"], ["forge", "Forge"], ["neoforge", "NeoForge"], ["bedrock", "Bedrock Dedicated Server"],
  ] as const)("labels %s without falling back to Vanilla", (serverType, label) => {
    const { unmount } = render(<ServerHeader server={profile(serverType)} status={status} busyAction="" onStart={() => undefined} onStop={() => undefined} onRestart={() => undefined} />);
    expect(screen.getByText(new RegExp(`^${label} / 1\\.20\\.1`))).toBeInTheDocument();
    unmount();
  });

  it("keeps Bedrock verification hashes out of the header while retaining Java build labels", () => {
    const { rerender } = render(<ServerHeader server={profile("bedrock")} status={status} busyAction="" onStart={() => undefined} onStop={() => undefined} onRestart={() => undefined} />);
    expect(screen.getByText("Bedrock Dedicated Server / 1.20.1 · UDP")).toBeInTheDocument();
    expect(screen.queryByText(/sha256/)).not.toBeInTheDocument();

    rerender(<ServerHeader server={profile("forge")} status={status} busyAction="" onStart={() => undefined} onStop={() => undefined} onRestart={() => undefined} />);
    expect(screen.getByText("Forge / 1.20.1 build 1.20.1-47.4.10")).toBeInTheDocument();
  });
});
