import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import type { AutomationSettings, RuntimeStatus, UpdateCenterReport } from "../types";
import { OperationsCenterTab } from "./OperationsCenterTab";

const stopped: RuntimeStatus = {
  state: "stopped",
  playerCount: 0,
  maxPlayers: 20,
  memoryUsedMib: 0,
  uptimeSeconds: 0,
  address: "127.0.0.1:25565",
  cpuPercent: 0,
  tps: null,
  tpsSupported: false,
  pingLatencyMs: null,
};

const automation: AutomationSettings = {
  serverId: "demo-paper",
  autoStopEnabled: false,
  idleMinutes: 30,
  notifyStartup: true,
  notifyPlayerJoin: true,
  notifyCrash: true,
  notifyBackupFailure: true,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const server = (await backend.listServers()).find((item) => item.serverType === "paper")!;
  const notify = vi.fn();
  const fail = vi.fn();
  const onUpdated = vi.fn();
  vi.spyOn(backend, "getAutomationSettings").mockResolvedValue({ ...automation, serverId: server.id });
  return { server, notify, fail, onUpdated };
}

describe("運用センター", () => {
  it("Palworldでも自動停止の待機時間と通知を保存でき、Minecraft専用操作は表示しない", async () => {
    const { server: minecraft, notify, fail, onUpdated } = await fixture();
    const server = { ...minecraft, id: "palworld-automation", gameKind: "palworld" as const, serverType: "palworld" as const,
      palworldSettings: { restApiEnabled: true, restApiPort: 8212, maxPlayers: 32, serverDescription: "", backupEnabled: true } };
    vi.mocked(backend.getAutomationSettings).mockResolvedValue({ ...automation, serverId: server.id });
    const save = vi.spyOn(backend, "saveAutomationSettings").mockImplementation(async (settings) => settings);
    render(<OperationsCenterTab server={server} status={stopped} onUpdated={onUpdated} notify={notify} fail={fail} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /自動停止を使う/ }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ serverId: server.id, autoStopEnabled: true })));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "15" } });
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ serverId: server.id, autoStopEnabled: true, idleMinutes: 15 })));
    fireEvent.click(screen.getByRole("checkbox", { name: "プレイヤー参加" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ serverId: server.id, notifyPlayerJoin: false, idleMinutes: 15 })));
    expect(screen.getByText(/Failed player checks reset the timer/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移行ファイルを作成" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "今すぐ検査" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新候補を確認" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "バックアップ失敗" })).not.toBeInTheDocument();
    expect(fail).not.toHaveBeenCalled();
  });

  it("PalworldのRESTが無効なら設定に必要な条件を表示する", async () => {
    const { server, notify, fail, onUpdated } = await fixture();
    render(<OperationsCenterTab server={{ ...server, gameKind: "palworld", serverType: "palworld" }} status={stopped} onUpdated={onUpdated} notify={notify} fail={fail} />);
    await screen.findByRole("checkbox", { name: /自動停止を使う/ });
    expect(screen.getByText(/register an admin password in Settings/)).toBeInTheDocument();
  });

  it("自動停止とWindows通知を保存し、保存失敗も画面通知へ渡す", async () => {
    const { server, notify, fail, onUpdated } = await fixture();
    const save = vi.spyOn(backend, "saveAutomationSettings")
      .mockImplementationOnce(async (settings) => ({ ...settings, updatedAt: "2026-09-01T01:00:00.000Z" }))
      .mockRejectedValueOnce(new Error("settings-write-failed"));

    render(<OperationsCenterTab server={server} status={stopped} onUpdated={onUpdated} notify={notify} fail={fail} />);

    const autoStop = await screen.findByRole("checkbox", { name: /自動停止を使う/ });
    fireEvent.click(autoStop);
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ autoStopEnabled: true })));
    expect(notify).toHaveBeenCalledWith("自動運用とWindows通知の設定を保存しました");

    fireEvent.click(screen.getByRole("checkbox", { name: "クラッシュ" }));
    await waitFor(() => expect(fail).toHaveBeenCalledWith("Error: settings-write-failed"));
  });

  it("競合検査の警告と制限事項を表示する", async () => {
    const { server, notify, fail, onUpdated } = await fixture();
    vi.spyOn(backend, "checkExtensionConflicts").mockResolvedValue({
      checkedAt: "2026-09-01T00:00:00.000Z",
      blocking: true,
      scannedFiles: 4,
      managedFiles: 3,
      items: [{ severity: "error", code: "duplicate-mod", title: "Mod IDが重複しています", detail: "same.jar と copy.jar", files: ["same.jar", "copy.jar"], nextAction: "片方を外す" }],
      limitation: "起動時だけ判明する競合は検出できません。",
    });

    render(<OperationsCenterTab server={server} status={stopped} onUpdated={onUpdated} notify={notify} fail={fail} />);
    fireEvent.click(await screen.findByRole("button", { name: /今すぐ検査/ }));

    expect(await screen.findByText("Mod IDが重複しています")).toBeInTheDocument();
    expect(screen.getByText("起動前に修正が必要")).toBeInTheDocument();
    expect(screen.getByText("起動時だけ判明する競合は検出できません。")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("拡張機能の事前検査が完了しました");
  });

  it("選択したサーバー・Geyser・拡張機能だけを順に更新する", async () => {
    const { server, notify, fail, onUpdated } = await fixture();
    const report: UpdateCenterReport = {
      checkedAt: "2026-09-01T00:00:00.000Z",
      items: [
        { id: "server", kind: "server", name: "Paper", currentVersion: "1.21.10", availableVersion: "1.21.11", source: "PaperMC", managed: true, selectable: true, requiresClientUpdate: false, note: "server update" },
        { id: "geyser", kind: "geyser", name: "Geyser", currentVersion: "1", availableVersion: "2", source: "GeyserMC", managed: true, selectable: true, requiresClientUpdate: false, note: "proxy update" },
        { id: "plugin", kind: "plugin", name: "Example plugin", currentVersion: "3", availableVersion: "4", source: "Modrinth", managed: true, selectable: true, requiresClientUpdate: true, note: "client impact", projectId: "project", versionId: "version", extensionKind: "plugin" },
        { id: "manual", kind: "plugin", name: "Manual plugin", currentVersion: "1", availableVersion: "2", source: "manual", managed: false, selectable: false, requiresClientUpdate: false, note: "not managed" },
      ],
      unmanagedFiles: ["manual.jar"],
      disclaimer: "更新前に必ずバックアップします。",
    };
    vi.spyOn(backend, "getUpdateCenter")
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce({ ...report, items: [], unmanagedFiles: [] });
    vi.spyOn(backend, "checkUpdateSafety").mockResolvedValue({ checkedAt: report.checkedAt, safeToProceed: true, backupRecommended: true, compatibilityChecks: [], dependencyWarnings: ["依存関係を再確認"], affectedFiles: ["server.jar"], rollbackPossible: true, disclaimer: "" });
    const backup = { id: "backup", path: "C:\\backups\\before.zip", createdAt: report.checkedAt, sizeBytes: 10, serverName: server.name, minecraftVersion: server.minecraftVersion, serverType: server.serverType, extensionSummary: "Paper", sha256: "abc", valid: true, schemaVersion: 1, kind: "before_update" as const, displayName: "Before update", sourceSizeBytes: 10, fileCount: 1, pinned: false };
    vi.spyOn(backend, "applyServerUpdate").mockResolvedValue({ server: { ...server, minecraftVersion: "1.21.11" }, backup, changedFiles: ["server.jar"], message: "updated" });
    vi.spyOn(backend, "crossplayStatus").mockResolvedValue({ eligible: true, installed: true, bedrockPort: 19132, floodgateInstalled: true, configurationGenerated: true, configurationReady: true });
    const geyser = vi.spyOn(backend, "installCrossplay").mockResolvedValue({ backup, installedFiles: ["Geyser-Spigot.jar"], bedrockPort: 19132, restartRequired: true, message: "updated" });
    const extension = vi.spyOn(backend, "applyManagedExtensionUpdate").mockResolvedValue({ provider: "modrinth", minecraftVersion: server.minecraftVersion, loader: "paper", kind: "plugin", items: [], totalSizeBytes: 0, warnings: [], clientRequirement: "none" });

    render(<OperationsCenterTab server={server} status={stopped} onUpdated={onUpdated} notify={notify} fail={fail} />);
    fireEvent.click(await screen.findByRole("button", { name: /更新候補を確認/ }));
    expect(await screen.findByText("Example plugin")).toBeInTheDocument();
    expect(screen.getByText("manual.jar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /選択項目、参加者側への影響/ }));
    fireEvent.click(screen.getByRole("button", { name: /選択した3件をバックアップして更新/ }));

    await waitFor(() => expect(extension).toHaveBeenCalledWith({ serverId: server.id, projectId: "project", versionId: "version", kind: "plugin" }));
    expect(geyser).toHaveBeenCalledWith({ serverId: server.id, includeFloodgate: true, bedrockPort: 19132, acceptWarnings: true });
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ minecraftVersion: "1.21.11" }));
    expect(notify).toHaveBeenCalledWith("3件をバックアップ後に更新しました");
  });

  it("停止中だけ移行ファイルを作成し、実行中は理由を表示する", async () => {
    const { server, notify, fail, onUpdated } = await fixture();
    const migration = vi.spyOn(backend, "exportServerMigration").mockResolvedValue({
      path: "C:\\Downloads\\Demo.mshmove",
      manifest: { schemaVersion: 1, createdAt: automation.updatedAt, sourceServerName: server.name, serverType: server.serverType, minecraftVersion: server.minecraftVersion, launchTarget: server.launchTarget, javaMajor: server.javaMajor, minMemoryMib: server.minMemoryMib, maxMemoryMib: server.maxMemoryMib, port: server.port, settings: server.settings, fileCount: 42, sourceSizeBytes: 1024, archiveSha256: "sha256" },
    });
    const { rerender } = render(<OperationsCenterTab server={server} status={{ ...stopped, state: "running" }} onUpdated={onUpdated} notify={notify} fail={fail} />);
    expect(await screen.findByText("作成前にサーバーを安全停止してください。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移行ファイルを作成" })).toBeDisabled();

    rerender(<OperationsCenterTab server={server} status={stopped} onUpdated={onUpdated} notify={notify} fail={fail} />);
    fireEvent.click(screen.getByRole("button", { name: "移行ファイルを作成" }));
    await waitFor(() => expect(migration).toHaveBeenCalledWith(server.id, expect.stringMatching(/\.mshmove$/)));
    expect(notify).toHaveBeenCalledWith("引っ越しファイルを作成しました（42ファイル）");
  });
});
