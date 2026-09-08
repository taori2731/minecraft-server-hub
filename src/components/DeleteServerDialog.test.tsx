import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import { minecraftDeleteCopy, palworldDeleteCopy } from "../lib/deleteServerLocale";
import type { AppLocale } from "../lib/i18n";
import type { BasicSettings, RuntimeStatus, ServerProfile } from "../types";
import { DeleteServerDialog } from "./DeleteServerDialog";

const settings: BasicSettings = {
  defaultGameMode: "survival", difficulty: "normal", maxPlayers: 32, pvp: true, whitelist: false,
  allowCommands: false, onlineMode: true, allowFlight: false, forceGameMode: false, spawnProtection: 0,
  requireResourcePack: false, resourcePackUrl: "", resourcePackPrompt: "", worldName: "Palworld",
  daylightCycle: true, spawnMonsters: true, spawnAnimals: true, viewDistance: 10, simulationDistance: 8,
};

const status: RuntimeStatus = {
  state: "stopped", playerCount: 0, maxPlayers: 32, memoryUsedMib: 0, uptimeSeconds: 0,
  address: "localhost:8211", cpuPercent: 0, tps: null, tpsSupported: false, pingLatencyMs: null,
};

function profile(gameKind: "minecraft" | "palworld", serverType: "paper" | "palworld"): ServerProfile {
  return {
    id: serverType, name: serverType, rootPath: `C:\\Servers\\${serverType}`, gameKind, serverType,
    minecraftVersion: gameKind === "palworld" ? "" : "1.21.11", launchTarget: gameKind === "palworld" ? "PalServer.exe" : "server.jar",
    javaPath: gameKind === "palworld" ? "" : "java.exe", javaMajor: gameKind === "palworld" ? 0 : 21,
    minMemoryMib: 0, maxMemoryMib: 0, port: gameKind === "palworld" ? 8211 : 25565,
    eulaAcceptedAt: "", pendingRestart: false, settings,
    palworldSettings: gameKind === "palworld" ? { serverDescription: "", maxPlayers: 32, restApiPort: 8212, restApiEnabled: true, backupEnabled: true } : null,
    createdAt: "now", updatedAt: "now",
  };
}

describe("DeleteServerDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("offers and submits essential-data fast deletion for Palworld", async () => {
    const onDeleted = vi.fn();
    const deleteServer = vi.spyOn(backend, "deleteServer").mockResolvedValue({ deletedFiles: true, backupPath: "C:\\Backups\\palworld-final.zip" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeleteServerDialog server={profile("palworld", "palworld")} status={status} onClose={vi.fn()} onDeleted={onDeleted} fail={vi.fn()} />);
    fireEvent.click(screen.getByText(/Save essential data and delete quickly \(recommended\)/));
    expect(screen.getByText(/essential data may contain join and administrator passwords/)).toBeInTheDocument();
    expect(screen.getByText(/download the official server with SteamCMD/)).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: /Save essential data and delete quickly/ });
    expect(remove).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Delete"), { target: { value: "Delete" } });
    fireEvent.click(remove);
    await waitFor(() => expect(deleteServer).toHaveBeenCalledWith({ serverId: "palworld", deleteFiles: true, backupMode: "essential", confirmationText: "Delete" }));
    expect(onDeleted).toHaveBeenCalledWith({ deletedFiles: true, backupPath: "C:\\Backups\\palworld-final.zip" });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Official files will not be included"));
  });

  it("submits immediate Palworld deletion without creating a backup", async () => {
    const deleteServer = vi.spyOn(backend, "deleteServer").mockResolvedValue({ deletedFiles: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeleteServerDialog server={profile("palworld", "palworld")} status={status} onClose={vi.fn()} onDeleted={vi.fn()} fail={vi.fn()} />);
    fireEvent.click(screen.getByText("Delete now without a backup"));
    expect(screen.getByText(/No final backup will be created/)).toBeInTheDocument();
    expect(screen.queryByText(/administrator passwords/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Delete"), { target: { value: "Delete" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete now" }));
    await waitFor(() => expect(deleteServer).toHaveBeenCalledWith({ serverId: "palworld", deleteFiles: true, backupMode: "none", confirmationText: "Delete" }));
  });

  it("keeps the backed-up option and offers immediate deletion for Minecraft", () => {
    render(<DeleteServerDialog server={profile("minecraft", "paper")} status={status} onClose={vi.fn()} onDeleted={vi.fn()} fail={vi.fn()} />);
    expect(screen.getByText("フォルダーも削除")).toBeInTheDocument();
    expect(screen.getByText("Delete now without a backup")).toBeInTheDocument();
  });

  it("submits immediate Minecraft deletion without creating a backup", async () => {
    const deleteServer = vi.spyOn(backend, "deleteServer").mockResolvedValue({ deletedFiles: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeleteServerDialog server={profile("minecraft", "paper")} status={status} onClose={vi.fn()} onDeleted={vi.fn()} fail={vi.fn()} />);
    fireEvent.click(screen.getByText("Delete now without a backup"));
    expect(screen.getByText(/cannot restore deleted worlds, settings, mods, or plugins/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Delete"), { target: { value: "Delete" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete now" }));
    await waitFor(() => expect(deleteServer).toHaveBeenCalledWith({ serverId: "paper", deleteFiles: true, backupMode: "none", confirmationText: "Delete" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Minecraft server folder"));
  });

  it("provides complete fast and immediate deletion copy in all nine languages", () => {
    const locales: AppLocale[] = ["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"];
    for (const locale of locales) {
      const copy = palworldDeleteCopy(locale);
      expect(Object.values(copy)).toHaveLength(15);
      expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(true);
      expect(copy.essentialTitle).not.toBe(copy.noneTitle);
      const minecraftCopy = minecraftDeleteCopy(locale);
      expect(Object.values(minecraftCopy)).toHaveLength(7);
      expect(Object.values(minecraftCopy).every((value) => value.trim().length > 0)).toBe(true);
    }
  });
});
