import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import type { ImportPreview, MigrationManifest } from "../types";
import { ImportServerWizard } from "./ImportServerWizard";

afterEach(() => vi.restoreAllMocks());

describe("既存サーバー取り込み", () => {
  it("読み取りスキャンの確認内容だけをユーザー承認後に登録する", async () => {
    const imported = vi.fn();
    const inspect = vi.spyOn(backend, "inspectExistingServer");
    const importServer = vi.spyOn(backend, "importExistingServer");
    render(<ImportServerWizard onClose={() => undefined} onImported={imported} />);

    fireEvent.click(screen.getByRole("button", { name: "選択" }));
    expect(await screen.findByDisplayValue("C:\\Servers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "安全にスキャン" }));

    expect(await screen.findByText("Paper / 1.21.11")).toBeInTheDocument();
    expect(screen.getByText("ブラウザデモでは実フォルダーを読み取りません。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("アプリ内の表示名"), { target: { value: "Imported Paper" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /登録時に初回バックアップ/ }));
    fireEvent.click(screen.getByRole("button", { name: "この内容で登録" }));

    await waitFor(() => expect(imported).toHaveBeenCalledWith(expect.objectContaining({ name: "Imported Paper" })));
    expect(inspect).toHaveBeenCalledWith("C:\\Servers");
    expect(importServer).toHaveBeenCalledWith(expect.objectContaining({ rootPath: "C:\\Servers", name: "Imported Paper", javaMajor: 21, createInitialBackup: false, sourceFingerprint: "demo-fingerprint" }));
  });

  it("非互換Javaでは登録せず理由を表示する", async () => {
    const base = await backend.inspectExistingServer("C:\\incompatible");
    const incompatible: ImportPreview = { ...base, javaRuntimes: [{ ...base.javaRuntimes[0], compatible: false, compatibilityMessage: "Java 17は非対応" }] };
    vi.spyOn(backend, "inspectExistingServer").mockResolvedValue(incompatible);
    const imported = vi.fn();
    render(<ImportServerWizard onClose={() => undefined} onImported={imported} />);

    fireEvent.click(screen.getByRole("button", { name: "選択" }));
    fireEvent.click(await screen.findByRole("button", { name: "安全にスキャン" }));
    await screen.findByText("このサーバーに合うJavaがありません");
    fireEvent.click(screen.getByRole("button", { name: "この内容で登録" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("互換性のあるJavaを選択してください");
    expect(imported).not.toHaveBeenCalled();
  });

  it("mshmoveを検証し、新PCの保存先とJavaを明示して復元する", async () => {
    const server = (await backend.listServers()).find((item) => item.serverType === "paper")!;
    const manifest: MigrationManifest = { schemaVersion: 1, createdAt: "2026-09-01T00:00:00.000Z", sourceServerName: "Moved Paper", serverType: "paper", minecraftVersion: server.minecraftVersion, launchTarget: server.launchTarget, javaMajor: 21, minMemoryMib: server.minMemoryMib, maxMemoryMib: server.maxMemoryMib, port: server.port, settings: server.settings, fileCount: 42, sourceSizeBytes: 1024, archiveSha256: "sha256" };
    vi.spyOn(backend, "inspectServerMigration").mockResolvedValue(manifest);
    const runtimes = await backend.detectJava("paper", server.minecraftVersion);
    vi.spyOn(backend, "detectJava").mockResolvedValue(runtimes);
    const restored = { ...server, id: "restored", name: "Moved Paper", rootPath: "C:\\Servers\\Moved Paper" };
    const restore = vi.spyOn(backend, "restoreServerMigration").mockResolvedValue(restored);
    const imported = vi.fn();
    render(<ImportServerWizard onClose={() => undefined} onImported={imported} />);

    fireEvent.click(screen.getByRole("button", { name: /移行ファイルから復元/ }));
    expect(await screen.findByText("移行ファイルを検証しました")).toBeInTheDocument();
    expect(screen.getByText(/42ファイル/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "選択" }));
    await waitFor(() => expect(screen.getByPlaceholderText("復元先の親フォルダー")).toHaveValue("C:\\Servers"));
    const restoreButton = screen.getByRole("button", { name: "新PCへ復元して登録" });
    await waitFor(() => expect(restoreButton).toBeEnabled());
    fireEvent.click(restoreButton);

    await waitFor(() => expect(imported).toHaveBeenCalledWith(restored));
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ archivePath: "C:\\Downloads\\server.mshmove", parentPath: "C:\\Servers", serverName: "Moved Paper", javaMajor: 21 }));
  });
});
