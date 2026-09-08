import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { backend } from "../lib/backend";
import type { BasicSettings, RuntimeStatus, ServerProfile } from "../types";
import { ConsoleTab } from "./ConsoleTab";
import { PalworldOverviewTab } from "./PalworldOverviewTab";
import { PalworldPlayersTab } from "./PalworldPlayersTab";
import { PalworldSettingsTab } from "./PalworldSettingsTab";
import { PalworldInviteDialog } from "./PalworldInviteDialog";

const settings: BasicSettings = {
  defaultGameMode: "survival", difficulty: "normal", maxPlayers: 32, pvp: true, whitelist: false,
  allowCommands: false, onlineMode: true, allowFlight: false, forceGameMode: false, spawnProtection: 0,
  requireResourcePack: false, resourcePackUrl: "", resourcePackPrompt: "", worldName: "Palworld",
  daylightCycle: true, spawnMonsters: true, spawnAnimals: true, viewDistance: 10, simulationDistance: 8,
};

const server: ServerProfile = {
  id: "palworld", name: "Palworld Friends", rootPath: "C:\\Servers\\Palworld", gameKind: "palworld",
  serverType: "palworld", minecraftVersion: "0.6.5.0", launchTarget: "PalServer.exe", javaPath: "", javaMajor: 0,
  minMemoryMib: 0, maxMemoryMib: 0, port: 8211, eulaAcceptedAt: "", pendingRestart: false, settings,
  palworldSettings: { serverDescription: "Friends", maxPlayers: 32, restApiPort: 8212, restApiEnabled: true, backupEnabled: true },
  createdAt: "now", updatedAt: "now",
};

const status: RuntimeStatus = {
  state: "running", playerCount: 1, maxPlayers: 32, memoryUsedMib: 2048, uptimeSeconds: 75,
  address: "localhost:8211", cpuPercent: 12, tps: null, tpsSupported: false, pingLatencyMs: null,
  palworld: {
    apiReachable: true, version: "0.6.5.0", serverName: "Palworld Friends", worldGuid: "world-guid-secret",
    serverFps: 60, serverFrameTimeMs: 16.7, baseCampCount: 2, worldDays: 4,
    players: [{ name: "Lamball", accountName: "SteamFriend", playerId: "player-id-secret", userId: "user-id-secret", ping: 25, level: 18, buildingCount: 4 }],
  },
};

function wrap(node: React.ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

describe("Palworld UI", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("server-hub:language:v1", "en");
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts a stopped Palworld server and automatically publishes its UDP address", async () => {
    vi.spyOn(backend, "publicAccessStatus").mockResolvedValue({ state: "stopped", inviteName: "Palworld", hostnameState: "not_configured", hostnameMessage: "", method: "UPnP", message: "", homeIpExposed: true });
    vi.spyOn(backend, "tunnelStatus").mockResolvedValue({ serverId: server.id, providerId: "playit", state: "unconfigured", localHost: "127.0.0.1", localPort: 8211, transport: "udp", agentVerified: false, termsAcknowledged: false, accountState: "unknown", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "", lastCheckedAt: "now", recentLogs: [] });
    const statusSpy = vi.spyOn(backend, "status").mockResolvedValueOnce({ ...status, state: "stopped", palworld: undefined }).mockResolvedValue(status);
    const startSpy = vi.spyOn(backend, "start").mockResolvedValue(undefined);
    const publishSpy = vi.spyOn(backend, "publishPalworldUpnp").mockResolvedValue({ state: "published", address: "203.0.113.42:8211", inviteName: "Palworld", hostnameState: "not_configured", hostnameMessage: "", method: "UPnP", message: "", homeIpExposed: true });
    wrap(<PalworldInviteDialog server={server} onClose={vi.fn()} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare for friends" }));
    expect(await screen.findByText("203.0.113.42:8211")).toBeInTheDocument();
    expect(statusSpy).toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalledWith(server.id);
    expect(publishSpy).toHaveBeenCalledWith(server.id);
  });

  it("shows localized local REST monitoring without exposing world identifiers", () => {
    wrap(<PalworldOverviewTab server={server} status={status} onCopyAddress={vi.fn()} notify={vi.fn()} fail={vi.fn()} />);
    expect(screen.getAllByRole("heading", { name: "Local monitoring" }).length).toBeGreaterThan(0);
    expect(screen.getByText("localhost:8211")).toBeInTheDocument();
    expect(screen.queryByText("world-guid-secret")).not.toBeInTheDocument();
  });

  it("shows safe player metrics but never renders player or user IDs", () => {
    wrap(<PalworldPlayersTab server={server} status={status} />);
    expect(screen.getByText("Lamball")).toBeInTheDocument();
    expect(screen.getByText("SteamFriend")).toBeInTheDocument();
    expect(screen.queryByText("player-id-secret")).not.toBeInTheDocument();
    expect(screen.queryByText("user-id-secret")).not.toBeInTheDocument();
  });

  it("shows editable Palworld settings but locks them while the server is running", () => {
    wrap(<PalworldSettingsTab server={server} status={status} onUpdated={vi.fn()} notify={vi.fn()} fail={vi.fn()} />);
    expect(screen.getByLabelText("REST management port (TCP, local only)")).toHaveValue(8212);
    expect(screen.getByLabelText("REST management port (TCP, local only)")).toBeDisabled();
    expect(screen.getByText(/Block the REST management TCP port from LAN and Internet access with Windows Firewall/)).toBeInTheDocument();
    expect(screen.getByText("Safely stop the server before changing settings.")).toBeInTheDocument();
  });

  it("saves connection, password, and gameplay settings through one guarded update", async () => {
    const stopped = { ...status, state: "stopped" } as RuntimeStatus;
    const updated = { ...server, name: "New Pal", port: 8311, pendingRestart: true };
    const update = vi.spyOn(backend, "updatePalworldSettings").mockResolvedValue(updated);
    const onUpdated = vi.fn();
    wrap(<PalworldSettingsTab server={server} status={stopped} onUpdated={onUpdated} notify={vi.fn()} fail={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Server name"), { target: { value: "New Pal" } });
    fireEvent.change(screen.getByLabelText("Game connection port (UDP)"), { target: { value: "8311" } });
    fireEvent.change(screen.getByLabelText("Join password"), { target: { value: "FriendsOnly" } });
    fireEvent.change(screen.getByLabelText("Experience rate"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings safely" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toMatchObject({ name: "New Pal", gamePort: 8311, serverPassword: "FriendsOnly", settings: { expRate: 2 } });
    expect(onUpdated).toHaveBeenCalledWith(updated);
  });

  it("supports read-only Palworld logs without a command input", () => {
    render(<ConsoleTab logs={[]} running commandsEnabled={false} commandUnavailableMessage="Palworld logs are read-only" onClear={vi.fn()} onCopy={vi.fn()} onSave={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByText("Palworld logs are read-only")).toBeInTheDocument();
    expect(screen.queryByLabelText("サーバーコマンド")).not.toBeInTheDocument();
  });
});
