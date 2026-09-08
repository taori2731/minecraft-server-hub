import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import { CrossplayInviteDialog, splitBedrockEndpoint } from "./CrossplayInviteDialog";

afterEach(() => vi.restoreAllMocks());

describe("統合版用公開接続先", () => {
  it("Minecraft統合版の入力欄に合わせてホスト名とポートを分離する", () => {
    expect(splitBedrockEndpoint("olds-saga.tun.ply.gg:50050")).toEqual({
      address: "olds-saga.tun.ply.gg",
      port: "50050",
      complete: true,
    });
  });

  it("ブラケット付きIPv6を安全に分離する", () => {
    expect(splitBedrockEndpoint("[2001:db8::10]:19132")).toEqual({
      address: "2001:db8::10",
      port: "19132",
      complete: true,
    });
  });

  it("不正またはポートなしの値を推測で分離しない", () => {
    expect(splitBedrockEndpoint("bedrock.example.net")).toEqual({
      address: "bedrock.example.net",
      port: "",
      complete: false,
    });
    expect(splitBedrockEndpoint("bedrock.example.net:70000").complete).toBe(false);
    expect(splitBedrockEndpoint("2001:db8::10").complete).toBe(false);
  });

  it("統合版の入力画面どおりにアドレスとポートを別々に案内する", async () => {
    const server = (await backend.listServers()).find((item) => item.serverType === "paper")!;
    const runtime = await backend.status(server.id);
    vi.spyOn(backend, "crossplayStatus").mockResolvedValue({ eligible: true, installed: true, bedrockPort: 19132, floodgateInstalled: true, configurationGenerated: true, configurationReady: true });
    vi.spyOn(backend, "crossplayTunnelStatus").mockResolvedValue({ serverId: server.id, providerId: "playit", state: "running", localHost: "127.0.0.1", localPort: 19132, transport: "udp", agentVerified: true, termsAcknowledged: true, accountState: "verified", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: true, publicEndpoint: "olds-saga.tun.ply.gg:50050", message: "接続先を取得しました", recentLogs: [] });

    render(<CrossplayInviteDialog server={server} status={runtime} onClose={() => undefined} notify={() => undefined} />);

    expect(await screen.findByText("olds-saga.tun.ply.gg")).toBeInTheDocument();
    expect(screen.getByText("50050")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("Java版用の 25565 を残さず") === true)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "アドレスをコピー" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ポートをコピー" })).toBeEnabled();
  });

  it("公式導入計画を確認し、実行中のPaperを停止してGeyserを導入する", async () => {
    const server = (await backend.listServers()).find((item) => item.serverType === "paper")!;
    const runtime = { ...(await backend.status(server.id)), state: "running" as const };
    const initial = { eligible: true, installed: false, floodgateInstalled: false, configurationGenerated: false, configurationReady: false };
    const installed = { ...initial, installed: true, bedrockPort: 19132, floodgateInstalled: true, configurationGenerated: true, configurationReady: true };
    vi.spyOn(backend, "crossplayStatus").mockResolvedValueOnce(initial).mockResolvedValueOnce(installed);
    vi.spyOn(backend, "getCrossplayPlan").mockResolvedValue({ eligible: true, bedrockPort: 19132, warnings: ["再起動が必要です"], nextSteps: ["導入"], sourceUrl: "https://geysermc.org/" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const stop = vi.spyOn(backend, "stop").mockResolvedValue(undefined);
    const install = vi.spyOn(backend, "installCrossplay").mockResolvedValue({ backup: { id: "backup", createdAt: "2026-09-01T00:00:00.000Z", sizeBytes: 1, path: "C:\\backup.zip", serverName: server.name, minecraftVersion: server.minecraftVersion, serverType: server.serverType, extensionSummary: "Geyser", sha256: "sha", valid: true, schemaVersion: 1, kind: "before_crossplay_install", displayName: "Before Geyser", sourceSizeBytes: 1, fileCount: 1, pinned: false }, installedFiles: ["Geyser-Spigot.jar"], bedrockPort: 19132, restartRequired: true, message: "installed" });
    vi.spyOn(backend, "crossplayTunnelStatus").mockResolvedValue({ serverId: server.id, providerId: "playit", state: "unconfigured", localHost: "127.0.0.1", localPort: 19132, agentVerified: false, termsAcknowledged: false, accountState: "not_configured", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "not configured", recentLogs: [] });
    const notify = vi.fn();

    render(<CrossplayInviteDialog server={server} status={runtime} onClose={() => undefined} notify={notify} />);
    fireEvent.click(await screen.findByRole("button", { name: /公式導入内容を確認/ }));
    expect(await screen.findByText("このPaperサーバーへ導入できます")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /バックアップ後に公式Geyser/ }));
    fireEvent.click(screen.getByRole("button", { name: /停止・バックアップして導入/ }));

    await waitFor(() => expect(install).toHaveBeenCalledWith({ serverId: server.id, includeFloodgate: true, bedrockPort: 19132, acceptWarnings: true }));
    expect(stop).toHaveBeenCalledWith(server.id);
    expect(notify).toHaveBeenCalledWith("Geyserと統合版招待の準備を追加しました");
  });

  it("確認済みGeyserから公式エージェントを使ってUDP公開し、診断・外部テスト・停止を行う", async () => {
    const server = (await backend.listServers()).find((item) => item.serverType === "paper")!;
    const runtime = { ...(await backend.status(server.id)), state: "stopped" as const };
    const crossplay = { eligible: true, installed: true, bedrockPort: 19132, floodgateInstalled: true, configurationGenerated: true, configurationReady: true };
    const stoppedTunnel = { serverId: server.id, providerId: "playit", state: "unconfigured" as const, localHost: "127.0.0.1", localPort: 19132, transport: "udp" as const, agentVerified: true, termsAcknowledged: false, accountState: "verified", pendingTunnelCount: 0, providerNotices: [], matchingTunnel: false, message: "stopped", recentLogs: [] };
    const connectedTunnel = { ...stoppedTunnel, state: "connected" as const, termsAcknowledged: true, matchingTunnel: true, publicEndpoint: "bedrock.example.net:50050", message: "connected" };
    vi.spyOn(backend, "crossplayStatus").mockResolvedValue(crossplay);
    vi.spyOn(backend, "crossplayTunnelStatus").mockResolvedValueOnce(stoppedTunnel).mockResolvedValue(connectedTunnel);
    vi.spyOn(backend, "tunnelAgentInstallPlan").mockResolvedValue({ providerId: "playit", version: "1.0.0", sourceUrl: "https://example.invalid/playit.msi", sizeBytes: 1024, checksumSha256: "sha", publisher: "playit.gg", licenseName: "terms", licenseUrl: "https://playit.gg/terms/", installScope: "machine", installPath: "C:\\Program Files\\playit", temporaryPath: "C:\\Temp\\playit.msi", alreadyInstalled: true, installedValidation: { valid: true, providerId: "playit", agentPath: "C:\\Program Files\\playit\\playit.exe", sha256: "sha", verificationMethod: "Authenticode", message: "verified" } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(backend, "status").mockResolvedValue(runtime);
    const start = vi.spyOn(backend, "start").mockResolvedValue(undefined);
    const quickStart = vi.spyOn(backend, "quickStartCrossplayTunnel").mockResolvedValue(connectedTunnel);
    vi.spyOn(backend, "diagnoseCrossplayTunnel").mockResolvedValue({ checkedAt: "2026-09-01T00:00:00.000Z", serverRunning: true, localPortListening: true, agentConfigured: true, agentVerified: true, agentRunning: true, providerAuthenticated: true, matchingTunnel: true, tunnelConnected: true, endpointAvailable: true, items: ["すべて正常です"], transport: "udp" });
    vi.spyOn(backend, "probeCrossplayTunnelEndpoint").mockResolvedValue({ checkedAt: "2026-09-01T00:00:00.000Z", attempted: true, reachable: true, endpoint: connectedTunnel.publicEndpoint, scope: "host-network", message: "RakNet応答を確認", transport: "udp" });
    vi.spyOn(backend, "stopCrossplayTunnel").mockResolvedValue({ ...connectedTunnel, state: "disconnected" });
    const notify = vi.fn();

    render(<CrossplayInviteDialog server={server} status={runtime} onClose={() => undefined} notify={notify} />);
    const terms = await screen.findByRole("checkbox", { name: /利用規約/ });
    fireEvent.click(terms);
    fireEvent.click(screen.getByRole("button", { name: "統合版用アドレスを作る" }));

    expect(await screen.findByText("bedrock.example.net")).toBeInTheDocument();
    expect(start).toHaveBeenCalledWith(server.id);
    expect(quickStart).toHaveBeenCalledWith({ serverId: server.id, termsAccepted: true });
    fireEvent.click(screen.getByRole("button", { name: "接続診断" }));
    expect(await screen.findByText("すべて正常です")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "外部経路をテスト" }));
    expect(await screen.findByText("Bedrock UDP/RakNet応答あり")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "統合版の招待を停止" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("統合版の招待を停止しました"));
  });
});
