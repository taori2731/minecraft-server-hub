import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import type { ExtensionInfo, RuntimeStatus } from "../types";
import { ExtensionsTab } from "./ExtensionsTab";

afterEach(() => vi.restoreAllMocks());

describe("拡張機能カタログ", () => {
  it("公式カタログの版・依存関係を確認して導入し、ローカル管理とGeyser導入も行う", async () => {
    const server = (await backend.listServers()).find((item) => item.serverType === "paper")!;
    const status: RuntimeStatus = { state: "stopped", playerCount: 0, maxPlayers: 20, memoryUsedMib: 0, uptimeSeconds: 0, address: "127.0.0.1:25565", cpuPercent: 0, tps: null, tpsSupported: false, pingLatencyMs: null };
    const installed: ExtensionInfo = { fileName: "managed-plugin.jar", kind: "plugin", enabled: true, sizeBytes: 2048, compatibility: "Paper 1.21.11", clientRequirement: "サーバー側のみ", manageable: true };
    vi.spyOn(backend, "listExtensions").mockResolvedValue([installed]);
    const toggle = vi.spyOn(backend, "setExtensionEnabled").mockResolvedValue(undefined);
    const remove = vi.spyOn(backend, "removeExtension").mockResolvedValue(undefined);
    const localInstall = vi.spyOn(backend, "installLocalExtension");
    const catalogInstall = vi.spyOn(backend, "installCatalogExtension");
    const crossplayInstall = vi.spyOn(backend, "installCrossplay");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const notify = vi.fn();
    const fail = vi.fn();

    render(<ExtensionsTab server={server} status={status} notify={notify} fail={fail} />);

    expect(await screen.findByText("ViaVersion")).toBeInTheDocument();
    expect(screen.getByText("managed-plugin.jar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "無効化" }));
    await waitFor(() => expect(toggle).toHaveBeenCalledWith(server.id, "managed-plugin.jar", "plugin", false));
    fireEvent.click(screen.getByRole("button", { name: "managed-plugin.jarを削除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(server.id, "managed-plugin.jar", "plugin"));

    fireEvent.click(screen.getByRole("button", { name: /ファイルから追加/ }));
    await waitFor(() => expect(localInstall).toHaveBeenCalledWith(server.id, "C:\\Downloads\\example-extension.jar", "plugin"));

    fireEvent.click(screen.getByRole("button", { name: /ViaVersion/ }));
    expect(await screen.findByText("example.jar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "導入内容を確認" }));
    expect(await screen.findByRole("dialog", { name: "導入内容の確認" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "バックアップして導入" }));
    await waitFor(() => expect(catalogInstall).toHaveBeenCalledWith(server.id, "demo-version", "plugin"));
    expect(notify).toHaveBeenCalledWith("プラグインと必須依存 0件をバックアップ後に導入しました");

    fireEvent.click(screen.getByRole("button", { name: /公式導入内容を確認/ }));
    expect(await screen.findByText("このPaperサーバーへ安全に導入できます")).toBeInTheDocument();
    expect(screen.getByText(/Geyser browser-demo/)).toBeInTheDocument();
    expect(screen.getByText(/Floodgate browser-demo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /バックアップ後もGeyser設定の確認/ }));
    fireEvent.click(screen.getByRole("button", { name: "バックアップして公式版を導入" }));
    await waitFor(() => expect(crossplayInstall).toHaveBeenCalledWith({ serverId: server.id, includeFloodgate: true, bedrockPort: 19132, acceptWarnings: true }));
    expect(await screen.findByText("クロスプレイ用ファイルを導入しました。公開はまだ完了していません")).toBeInTheDocument();
    expect(fail).not.toHaveBeenCalled();
  });

  it("統合版アドオンは手元のファイルだけを停止中に管理する", async () => {
    const base = (await backend.listServers()).find((item) => item.serverType === "paper")!;
    const server = { ...base, id: "bedrock-test", name: "Bedrock Test", serverType: "bedrock" as const, launchTarget: "bedrock_server.exe", javaPath: "", javaMajor: 0, port: 19132 };
    const stopped: RuntimeStatus = { state: "stopped", playerCount: 0, maxPlayers: 10, memoryUsedMib: 0, uptimeSeconds: 0, address: "127.0.0.1:19132", cpuPercent: 0, tps: null, tpsSupported: false, pingLatencyMs: null };
    const addon: ExtensionInfo = { fileName: "adventure.mcpack", kind: "behavior_pack", enabled: true, sizeBytes: 2_500_000, compatibility: "manifest v2", clientRequirement: "統合版クライアント", manageable: true };
    vi.spyOn(backend, "listExtensions").mockResolvedValue([addon]);
    const install = vi.spyOn(backend, "installLocalExtension").mockResolvedValue({ ...addon, fileName: "new-pack.mcpack", kind: "addon" });
    const toggle = vi.spyOn(backend, "setExtensionEnabled").mockResolvedValue(undefined);
    const remove = vi.spyOn(backend, "removeExtension").mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const notify = vi.fn();
    const fail = vi.fn();
    const { container, rerender } = render(<ExtensionsTab server={server} status={stopped} notify={notify} fail={fail} />);

    expect(await screen.findByText("統合版アドオンを追加")).toBeInTheDocument();
    expect(screen.getByText("adventure.mcpack")).toBeInTheDocument();
    const dropZone = container.querySelector(".bedrock-drop-zone")!;
    fireEvent.drop(dropZone, { dataTransfer: { files: [{ path: "C:\\Downloads\\new-pack.mcpack" }] } });
    await waitFor(() => expect(install).toHaveBeenCalledWith(server.id, "C:\\Downloads\\new-pack.mcpack", "addon"));

    fireEvent.click(screen.getByRole("button", { name: "無効化" }));
    await waitFor(() => expect(toggle).toHaveBeenCalledWith(server.id, "adventure.mcpack", "behavior_pack", false));
    fireEvent.click(screen.getByRole("button", { name: "adventure.mcpackを削除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(server.id, "adventure.mcpack", "behavior_pack"));

    rerender(<ExtensionsTab server={server} status={{ ...stopped, state: "running" }} notify={notify} fail={fail} />);
    expect(screen.getByText(/追加・削除・有効切替にはサーバー停止が必要/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ファイルから追加/ })).toBeDisabled();
    expect(fail).not.toHaveBeenCalled();
  });
});
