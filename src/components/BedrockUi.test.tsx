import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import type { BasicSettings, RuntimeStatus, ServerProfile } from "../types";
import { CreateServerWizard } from "./CreateServerWizard";
import { ExtensionsTab } from "./ExtensionsTab";
import { FilesPlayersTab } from "./FilesPlayersTab";
import { OverviewTab } from "./OverviewTab";
import { SafetyToolsTab } from "./SafetyToolsTab";
import { SettingsTab } from "./SettingsTab";

const settings: BasicSettings = {
  defaultGameMode: "survival", difficulty: "normal", maxPlayers: 10, pvp: true, whitelist: true,
  allowCommands: false, onlineMode: true, allowFlight: false, forceGameMode: false, spawnProtection: 16,
  requireResourcePack: false, resourcePackUrl: "", resourcePackPrompt: "", worldName: "Bedrock level",
  worldType: "DEFAULT", worldSeed: "", generateStructures: true, hardcore: false, daylightCycle: true,
  spawnMonsters: true, spawnAnimals: true, viewDistance: 10, simulationDistance: 4,
  defaultPlayerPermissionLevel: "member", serverPortV6: 19133, enableLanVisibility: true,
};

const server: ServerProfile = {
  id: "bedrock-ui-test", name: "Bedrock Friends", rootPath: "C:\\Servers\\Bedrock", serverType: "bedrock",
  minecraftVersion: "1.21.100", launchTarget: "bedrock_server.exe", javaPath: "", javaMajor: 0,
  minMemoryMib: 0, maxMemoryMib: 0, port: 19132, eulaAcceptedAt: "test", pendingRestart: false,
  settings, createdAt: "test", updatedAt: "test",
};

const status: RuntimeStatus = {
  state: "stopped", playerCount: 0, maxPlayers: 10, memoryUsedMib: 0, uptimeSeconds: 0,
  address: "127.0.0.1:19132", cpuPercent: 0, tps: null, tpsSupported: false, pingLatencyMs: null,
};

describe("Bedrock UI", () => {
  it("does not reuse Java version samples for the Bedrock browser demo", async () => {
    await expect(backend.listVersions("bedrock")).resolves.toEqual([
      { id: "BDS latest (desktop check)", channel: "stable" },
    ]);
  });

  it("lets the user choose Bedrock before PC diagnosis", () => {
    render(<CreateServerWizard onClose={vi.fn()} onCreated={vi.fn()} isFirstServer />);
    fireEvent.click(screen.getByText("Minecraft 統合版").closest("button")!);
    expect(screen.getByText(/CPU・メモリ・Windows環境・保存先/)).toBeInTheDocument();
    expect(screen.getByText(/Bedrock Dedicated Server/)).toBeInTheDocument();
  });

  it("shows Bedrock properties without Java-only memory and resource URL controls", () => {
    render(<SettingsTab server={server} status={status} onServerIconChanged={vi.fn()} onUpdated={vi.fn()} notify={vi.fn()} fail={vi.fn()} />);
    expect(screen.getByText("Xboxアカウント認証")).toBeInTheDocument();
    expect(screen.getByText("ティック距離")).toBeInTheDocument();
    expect(screen.getByText("WindowsとBDSが自動管理")).toBeInTheDocument();
    expect(screen.getByText(/統合版のリソースパックは/)).toBeInTheDocument();
    expect(screen.queryByText("Java起動設定")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("https://example.com/server-pack.zip")).not.toBeInTheDocument();
  });

  it("does not offer the Java JAR updater for Bedrock", () => {
    render(<SafetyToolsTab server={server} status={status} onUpdated={vi.fn()} notify={vi.fn()} fail={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "統合版サーバーの更新" })).toBeInTheDocument();
    expect(screen.getByText("自動適用しません")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "安全確認" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /バックアップして更新を適用/ })).not.toBeInTheDocument();
  });

  it("shows Windows-managed memory without NaN for Bedrock", () => {
    render(<OverviewTab server={server} status={status} logs={[]} onCopyAddress={vi.fn()} onOpenFolder={vi.fn()} notify={vi.fn()} fail={vi.fn()} onUpdated={vi.fn()} />);
    expect(screen.getByText("0.0 GB / Windows管理")).toBeInTheDocument();
    expect(screen.getByText("WindowsとBDSが自動管理")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("uses Bedrock allowlist and permissions wording", async () => {
    render(<FilesPlayersTab server={server} status={status} notify={vi.fn()} fail={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^許可リスト参加/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^権限ビジター/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /BANしたIP/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/allowlist\.json/)).toBeInTheDocument());
  });

  it("refreshes a running Bedrock operator list until a pending XUID is resolved", async () => {
    vi.useFakeTimers();
    let operatorCalls = 0;
    const playerAccess = vi.spyOn(backend, "playerAccess").mockImplementation(async (_serverId, kind) => {
      if (kind !== "operators") return [];
      operatorCalls += 1;
      return operatorCalls === 1
        ? [{ id: "pending-test", label: "JoinedPlayer", detail: "XUID待ち・権限はまだ未反映", pending: true }]
        : [{ id: "2533274790000099", label: "XUID 2533274790000099", detail: "operator", level: 4, pending: false }];
    });
    try {
      render(<FilesPlayersTab server={server} status={{ ...status, state: "running" }} notify={vi.fn()} fail={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: /^権限ビジター/ }));
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText("JoinedPlayer")).toBeInTheDocument();
      expect(screen.getByText(/最大3秒ほどでXUID/)).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });
      expect(screen.getByText("XUID 2533274790000099")).toBeInTheDocument();
      expect(screen.getByText("権限レベル: 4")).toBeInTheDocument();
    } finally {
      playerAccess.mockRestore();
      vi.useRealTimers();
    }
  });

  it("shows local Bedrock add-ons and does not open the Modrinth Java catalog", async () => {
    render(<ExtensionsTab server={server} status={status} notify={vi.fn()} fail={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "統合版アドオンを追加" })).toBeInTheDocument();
    expect(screen.getAllByText(/\.mcaddon／\.mcpack／ZIP/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("heading", { name: "Java版の友達とも遊びたい場合" })).toBeInTheDocument();
    expect(screen.queryByText("POPULAR ON MODRINTH")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/公式BDS同梱パックは安全のため一覧から除外/)).toBeInTheDocument());
  });

  it("previews the official Geyser and optional Floodgate install for Paper", async () => {
    const paperServer: ServerProfile = {
      ...server,
      id: "demo-paper",
      serverType: "paper",
      minecraftVersion: "1.21.11",
      launchTarget: "server.jar",
      javaPath: "C:\\Java\\bin\\java.exe",
      javaMajor: 21,
      minMemoryMib: 1024,
      maxMemoryMib: 4096,
      port: 25565,
    };
    vi.spyOn(backend, "getCrossplayPlan").mockResolvedValueOnce({
      eligible: true,
      bedrockPort: 19132,
      geyser: { project: "geyser", version: "test", build: 1, fileName: "Geyser-Spigot.jar", sha256: "test", installed: false },
      floodgate: { project: "floodgate", version: "test", build: 1, fileName: "floodgate-spigot.jar", sha256: "test", installed: false },
      warnings: [],
      nextSteps: ["Paper再起動後にGeyser設定を確認します。"],
      sourceUrl: "https://download.geysermc.org/",
    });
    render(<ExtensionsTab server={paperServer} status={status} notify={vi.fn()} fail={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "統合版の友達も参加できるようにする" })).toBeInTheDocument();
    expect(screen.getByText("Java版から参加")).toBeInTheDocument();
    expect(screen.getByText("統合版から参加")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /公式導入内容を確認/ }));
    await waitFor(() => expect(screen.getByText("Geyser test")).toBeInTheDocument());
    expect(screen.getByText("Floodgate test")).toBeInTheDocument();
    const install = screen.getByRole("button", { name: /バックアップして公式版を導入/ });
    expect(install).toBeDisabled();
    const consent = screen.getByRole("checkbox", { name: /別のMinecraft Bedrock UDP公開先が必要/ });
    fireEvent.click(consent);
    expect(install).toBeEnabled();
    expect(screen.getByText("参加先は設定・公開後に確定")).toBeInTheDocument();
    expect(screen.getByText(/Java版と同じホスト名になるとは限りません/)).toBeInTheDocument();
  });
});
