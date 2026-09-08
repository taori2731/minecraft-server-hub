import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import { I18nProvider } from "../lib/i18n";
import type { BasicSettings, RuntimeStatus, ServerProfile } from "../types";
import { ServerLabTab } from "./ServerLabTab";

const settings: BasicSettings = {
  defaultGameMode: "survival", difficulty: "normal", maxPlayers: 20, pvp: true, whitelist: false,
  allowCommands: false, onlineMode: true, allowFlight: false, forceGameMode: false, spawnProtection: 16,
  requireResourcePack: false, resourcePackUrl: "", resourcePackPrompt: "", worldName: "world",
  worldType: "minecraft:normal", worldSeed: "", generateStructures: true, hardcore: false,
  daylightCycle: true, spawnMonsters: true, spawnAnimals: true, viewDistance: 10, simulationDistance: 8,
};

const server: ServerProfile = {
  id: "lab", name: "Lab", rootPath: "C:\\Lab", serverType: "paper", minecraftVersion: "1.21.11",
  launchTarget: "paper.jar", javaPath: "java", javaMajor: 21, minMemoryMib: 1024, maxMemoryMib: 4096,
  port: 25565, eulaAcceptedAt: "now", pendingRestart: false, settings, createdAt: "now", updatedAt: "now",
};

const status: RuntimeStatus = {
  state: "stopped", playerCount: 0, maxPlayers: 20, onlinePlayers: [], memoryUsedMib: 0,
  uptimeSeconds: 0, address: "localhost:25565", cpuPercent: 0, tps: null, tpsSupported: true, pingLatencyMs: null,
};

function renderLab(overrides: Partial<Parameters<typeof ServerLabTab>[0]> = {}) {
  const props = {
    server, status, onUpdated: vi.fn(), notify: vi.fn(), fail: vi.fn(), ...overrides,
  };
  render(<I18nProvider><ServerLabTab {...props} /></I18nProvider>);
  return props;
}

describe("ServerLabTab", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("server-hub:language:v1", "ja");
    vi.restoreAllMocks();
    vi.spyOn(backend, "diagnose").mockResolvedValue({
      cpuName: "Test CPU", physicalCores: 8, logicalThreads: 16, cpuUsagePercent: 10,
      memoryTotalMib: 32768, memoryAvailableMib: 24000, gpuName: "Test GPU", os: "Windows",
      storageKind: "SSD", storageFreeGib: 100, storageAvailable: true, javaRuntimes: [],
      recommendedMemoryMib: 8192, recommendedPlayers: 20, recommendedViewDistance: 10,
      recommendedSimulationDistance: 8, warnings: [], privacyNote: "local",
    });
  });

  it("keeps presets in a visible draft until explicit apply", async () => {
    const update = vi.spyOn(backend, "updateSettings").mockResolvedValue({ ...server, settings: { ...settings, defaultGameMode: "creative" } });
    renderLab();
    fireEvent.click(screen.getByRole("button", { name: /クリエイティブ建築/ }));
    expect(await screen.findByText("gamemode")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "バックアップして全変更を保存" })).toBeEnabled();
  });

  it("saves, resets, and restores a server-specific local draft", async () => {
    renderLab();
    fireEvent.click(screen.getByRole("button", { name: /省電力/ }));
    fireEvent.click(screen.getByRole("button", { name: "下書きをこのPCへ保存" }));
    expect(localStorage.getItem("server-hub:server-lab-draft:v1:lab")).toContain('"viewDistance":5');
    fireEvent.click(screen.getByRole("button", { name: "未保存変更をリセット" }));
    expect(screen.queryByText("view-distance")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下書きを復元" }));
    expect(await screen.findByText("view-distance")).toBeInTheDocument();
  });

  it("applies the draft through the backup-first settings command", async () => {
    const updated: ServerProfile = { ...server, pendingRestart: true, settings: { ...settings, defaultGameMode: "creative", difficulty: "peaceful" } };
    const update = vi.spyOn(backend, "updateSettings").mockResolvedValue(updated);
    const props = renderLab();
    fireEvent.click(screen.getByRole("button", { name: /クリエイティブ建築/ }));
    fireEvent.click(screen.getByRole("button", { name: "バックアップして全変更を保存" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("lab", expect.objectContaining({ defaultGameMode: "creative" }), 4096, 25565));
    expect(props.onUpdated).toHaveBeenCalledWith(updated);
  });

  it("disables real saving while the server is running but keeps planning available", () => {
    renderLab({ status: { ...status, state: "running" } });
    fireEvent.click(screen.getByRole("button", { name: /平和な探索/ }));
    expect(screen.getByRole("button", { name: "バックアップして全変更を保存" })).toBeDisabled();
    expect(screen.getByText(/計算と下書きは起動中でも使えます/)).toBeInTheDocument();
  });
});
