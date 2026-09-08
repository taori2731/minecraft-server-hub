import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriKey = "__TAURI_INTERNALS__" as keyof Window;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete (window as unknown as Record<string, unknown>)[tauriKey as string];
});

describe("Developer Tools backend browser boundary", () => {
  it("ブラウザでは読取専用レポートを取得し、ネイティブ専用操作を拒否する", async () => {
    const report = { schemaVersion: 6, generatedAt: "2026-09-01T00:00:00.000Z" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(report), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { developerBackend } = await import("./developerBackend");

    expect(developerBackend.isDesktop).toBe(false);
    expect(await developerBackend.discoverWorkspace()).toBeUndefined();
    expect(await developerBackend.chooseWorkspace()).toBeUndefined();
    expect(await developerBackend.inspectWorkspace("C:\\workspace", false)).toEqual(report);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/__developer-tools\/report\?at=\d+$/), { cache: "no-store" });
    await expect(developerBackend.scanDependencyAdvisories("C:\\workspace", "digest")).rejects.toThrow("advisory-native-only");
    await expect(developerBackend.collectLicenseEvidence("C:\\workspace", "digest")).rejects.toThrow("license-evidence-native-only");
    await expect(developerBackend.loadLicenseReviewLedger("digest")).rejects.toThrow("license-ledger-native-only");
    await expect(developerBackend.appendLicenseReviewDecision("digest", {} as never, {} as never)).rejects.toThrow("license-ledger-native-only");
    await expect(developerBackend.resetLicenseReviewDecision("digest", "item")).rejects.toThrow("license-ledger-native-only");
    await expect(developerBackend.migrateLicenseReviewRecords("digest", [])).rejects.toThrow("license-ledger-native-only");
    await expect(developerBackend.exportLicenseReviewLedger("digest")).rejects.toThrow("license-ledger-native-only");
    await expect(developerBackend.chooseLicenseReviewLedgerBackup("digest")).rejects.toThrow("license-ledger-native-only");
    await expect(developerBackend.restoreLicenseReviewLedgerBackup({} as never, true)).rejects.toThrow("license-ledger-native-only");
    await expect(developerBackend.listLicenseReviewRecoveries("digest")).rejects.toThrow("license-ledger-native-only");
    await expect(developerBackend.exportLicenseReviewRecovery("digest", {} as never)).rejects.toThrow("license-ledger-native-only");
    await expect(developerBackend.verifySupplyChainReport("digest")).rejects.toThrow("audit-verification-native-only");
    await expect(developerBackend.previewReleaseEvidencePack("C:\\workspace")).rejects.toThrow("release-evidence-native-only");
    await expect(developerBackend.exportReleaseEvidencePack("C:\\workspace", {} as never, true)).rejects.toThrow("release-evidence-native-only");
    await expect(developerBackend.chooseAndVerifyReleaseEvidencePack("C:\\workspace")).rejects.toThrow("release-evidence-native-only");
    await expect(developerBackend.previewReleaseApproval("C:\\workspace")).rejects.toThrow("release-approval-native-only");
    await expect(developerBackend.recordReleaseApproval("C:\\workspace", {} as never, {} as never)).rejects.toThrow("release-approval-native-only");
    await expect(developerBackend.previewReleaseHandoff("C:\\workspace")).rejects.toThrow("release-handoff-native-only");
    await expect(developerBackend.exportReleaseHandoff("C:\\workspace", {} as never, true)).rejects.toThrow("release-handoff-native-only");
    await expect(developerBackend.chooseAndVerifyReleaseHandoff("C:\\workspace")).rejects.toThrow("release-handoff-native-only");
  });

  it("HTTP失敗を成功レポートとして扱わない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("failure", { status: 503 })));
    const { developerBackend } = await import("./developerBackend");
    await expect(developerBackend.inspectWorkspace("C:\\workspace")).rejects.toThrow("HTTP 503");
  });

  it("ブラウザのエクスポートはBlobを一時URLでダウンロードして解放する", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:quality-report");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { developerBackend } = await import("./developerBackend");

    await expect(developerBackend.exportSupplyChainReport("report.json", "application/json", "{\"ok\":true}"))
      .resolves.toBe("report.json");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:quality-report");
  });
});

describe("Developer Tools backend native boundary", () => {
  it("passes the exact handoff digest and explicit export confirmation to native code", async () => {
    Object.defineProperty(window, tauriKey, { configurable: true, value: {} });
    const preview = { generatedAt: "2026-09-01T00:00:00Z", projectVersion: "0.3.2", payloadSha256: "A".repeat(64) };
    const invoke = vi.fn(async (command: string) => command === "preview_release_handoff" ? preview : command === "verify_release_handoff" ? { integrity: "verified" } : { fileSha256: "B".repeat(64) });
    const save = vi.fn().mockResolvedValue("C:\\exports\\release.mshhandoff");
    const open = vi.fn().mockResolvedValue("C:\\exports\\release.mshhandoff");
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open, save }));
    const { developerBackend } = await import("./developerBackend");

    await expect(developerBackend.previewReleaseHandoff("C:\\workspace")).resolves.toEqual(preview);
    await developerBackend.exportReleaseHandoff("C:\\workspace", preview as never, true);
    await developerBackend.chooseAndVerifyReleaseHandoff("C:\\workspace", "C".repeat(64));
    expect(invoke).toHaveBeenCalledWith("preview_release_handoff", { workspaceRoot: "C:\\workspace" });
    expect(invoke).toHaveBeenCalledWith("export_release_handoff", { input: {
      workspaceRoot: "C:\\workspace", generatedAt: preview.generatedAt, expectedPayloadSha256: preview.payloadSha256,
      destinationPath: "C:\\exports\\release.mshhandoff", confirmed: true,
    } });
    expect(invoke).toHaveBeenCalledWith("verify_release_handoff", {
      workspaceRoot: "C:\\workspace",
      sourcePath: "C:\\exports\\release.mshhandoff",
      expectedFileSha256: "C".repeat(64),
    });
  });

  it("passes the exact approval preview digest and explicit confirmations to native code", async () => {
    Object.defineProperty(window, tauriKey, { configurable: true, value: {} });
    const preview = { generatedAt: "2026-09-01T00:00:00Z", approvalDigest: "A".repeat(64) };
    const invoke = vi.fn(async (command: string) => command === "preview_release_approval" ? preview : { event: { eventHash: "B".repeat(64) } });
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
    const { developerBackend } = await import("./developerBackend");

    await expect(developerBackend.previewReleaseApproval("C:\\workspace")).resolves.toEqual(preview);
    await developerBackend.recordReleaseApproval("C:\\workspace", preview as never, {
      reviewer: "Release Team", rationale: "All current release gates were reviewed.", confirmationText: "APPROVE 0.3.2", warningsConfirmed: true, confirmed: true,
    });
    expect(invoke).toHaveBeenCalledWith("preview_release_approval", { workspaceRoot: "C:\\workspace" });
    expect(invoke).toHaveBeenCalledWith("record_release_approval", { input: {
      workspaceRoot: "C:\\workspace", generatedAt: preview.generatedAt, expectedApprovalDigest: preview.approvalDigest,
      confirmationText: "APPROVE 0.3.2", reviewer: "Release Team", rationale: "All current release gates were reviewed.", warningsConfirmed: true, confirmed: true,
    } });
  });

  it("ワークスペース、検査、脆弱性照会、保存を正しいIPC引数で呼ぶ", async () => {
    Object.defineProperty(window, tauriKey, { configurable: true, value: {} });
    const invoke = vi.fn(async (command: string) => {
      if (command === "discover_workspace") return "C:\\workspace";
      if (command === "inspect_workspace") return { schemaVersion: 6 };
      if (command === "scan_dependency_advisories") return { status: "complete" };
      if (command === "collect_license_evidence") return { schemaVersion: 3, localOnly: true };
      if (command === "load_license_review_ledger") return { integrity: "verified", eventCount: 0 };
      if (command === "append_license_review_decision") return { integrity: "verified", eventCount: 1 };
      if (command === "reset_license_review_decision") return { integrity: "verified", eventCount: 2 };
      if (command === "migrate_license_review_records") return { integrity: "verified", eventCount: 1 };
      if (command === "export_license_review_ledger") return { path: "C:\\exports\\ledger.mshlicense", eventCount: 1, lastHash: "B".repeat(64), sizeBytes: 2048, sha256: "C".repeat(64) };
      if (command === "preview_license_review_ledger_backup") return { sourcePath: "C:\\exports\\ledger.mshlicense", relation: "incoming-ahead", canRestore: true };
      if (command === "restore_license_review_ledger_backup") return { snapshot: { integrity: "verified", eventCount: 2 }, recoveryCreated: true, recoveryFile: "recovery.json" };
      if (command === "list_license_review_recoveries") return { inventoryDigest: "expected-digest", totalFiles: 1, returnedFiles: 1, verifiedFiles: 1, invalidFiles: 0, entries: [] };
      if (command === "export_license_review_recovery") return { path: "C:\\exports\\recovery.mshlicense", eventCount: 1, lastHash: "D".repeat(64), sizeBytes: 1024, sha256: "E".repeat(64) };
      if (command === "write_supply_chain_report") return "C:\\exports\\report.csv";
      if (command === "verify_supply_chain_report") return { documentType: "minecraft-server-hub-windows-x64-license-evidence", sha256: "A".repeat(64) };
      return undefined;
    });
    const open = vi.fn().mockResolvedValueOnce("C:\\chosen").mockResolvedValueOnce("C:\\exports\\ledger.mshlicense").mockResolvedValueOnce("C:\\exports\\evidence.json");
    const save = vi.fn().mockResolvedValueOnce("C:\\exports\\ledger.mshlicense").mockResolvedValueOnce("C:\\exports\\recovery.mshlicense").mockResolvedValueOnce("C:\\exports\\report.csv");
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open, save }));
    const { developerBackend } = await import("./developerBackend");

    expect(developerBackend.isDesktop).toBe(true);
    await expect(developerBackend.discoverWorkspace()).resolves.toBe("C:\\workspace");
    await expect(developerBackend.chooseWorkspace()).resolves.toBe("C:\\chosen");
    await expect(developerBackend.inspectWorkspace("C:\\workspace", false)).resolves.toEqual({ schemaVersion: 6 });
    await expect(developerBackend.scanDependencyAdvisories("C:\\workspace", "expected-digest")).resolves.toEqual({ status: "complete" });
    await expect(developerBackend.collectLicenseEvidence("C:\\workspace", "expected-digest")).resolves.toEqual({ schemaVersion: 3, localOnly: true });
    const item = { id: "cargo:demo@1.0.0:AAAA", ecosystem: "cargo", name: "demo", version: "1.0.0", license: "MPL-2.0", licenseClass: "reciprocal", source: "registry+https://example.invalid", integrity: "A".repeat(64), componentIds: ["app-cargo"] } as const;
    const draft = { decision: "approved", reviewer: "Release team", rationale: "Checked exact license obligations.", validityDays: 180 } as const;
    await expect(developerBackend.loadLicenseReviewLedger("expected-digest")).resolves.toMatchObject({ eventCount: 0 });
    await expect(developerBackend.appendLicenseReviewDecision("expected-digest", item as never, draft)).resolves.toMatchObject({ eventCount: 1 });
    await expect(developerBackend.resetLicenseReviewDecision("expected-digest", item.id)).resolves.toMatchObject({ eventCount: 2 });
    await expect(developerBackend.migrateLicenseReviewRecords("expected-digest", [])).resolves.toMatchObject({ eventCount: 1 });
    const exported = await developerBackend.exportLicenseReviewLedger("expected-digest");
    expect(exported).toMatchObject({ path: "C:\\exports\\ledger.mshlicense", eventCount: 1 });
    const preview = await developerBackend.chooseLicenseReviewLedgerBackup("expected-digest");
    expect(preview).toMatchObject({ relation: "incoming-ahead", canRestore: true });
    await expect(developerBackend.restoreLicenseReviewLedgerBackup({ inventoryDigest: "expected-digest", sourcePath: "C:\\exports\\ledger.mshlicense", backupLastHash: "B".repeat(64), backupSha256: "C".repeat(64), currentLastHash: "A".repeat(64) } as never, true)).resolves.toMatchObject({ recoveryCreated: true });
    await expect(developerBackend.listLicenseReviewRecoveries("expected-digest")).resolves.toMatchObject({ verifiedFiles: 1 });
    const recovery = { fileName: "license-review-ledger-recovery-20260901.json", integrity: "verified", sha256: "C".repeat(64), lastHash: "D".repeat(64) } as never;
    await expect(developerBackend.exportLicenseReviewRecovery("expected-digest", recovery)).resolves.toMatchObject({ path: "C:\\exports\\recovery.mshlicense" });
    await expect(developerBackend.exportSupplyChainReport("report.csv", "text/csv", "name,version")).resolves.toBe("C:\\exports\\report.csv");
    await expect(developerBackend.verifySupplyChainReport("expected-digest")).resolves.toMatchObject({ documentType: "minecraft-server-hub-windows-x64-license-evidence" });

    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }));
    expect(invoke).toHaveBeenCalledWith("inspect_workspace", { workspaceRoot: "C:\\workspace", checkRemoteFeed: false });
    expect(invoke).toHaveBeenCalledWith("scan_dependency_advisories", { workspaceRoot: "C:\\workspace", expectedDigest: "expected-digest", consent: true });
    expect(invoke).toHaveBeenCalledWith("collect_license_evidence", { workspaceRoot: "C:\\workspace", expectedDigest: "expected-digest" });
    expect(invoke).toHaveBeenCalledWith("load_license_review_ledger", { inventoryDigest: "expected-digest" });
    expect(invoke).toHaveBeenCalledWith("append_license_review_decision", { input: expect.objectContaining({ inventoryDigest: "expected-digest", itemId: item.id, decision: "approved", validityDays: 180 }) });
    expect(invoke).toHaveBeenCalledWith("reset_license_review_decision", { inventoryDigest: "expected-digest", itemId: item.id });
    expect(invoke).toHaveBeenCalledWith("migrate_license_review_records", { inventoryDigest: "expected-digest", records: [] });
    expect(invoke).toHaveBeenCalledWith("export_license_review_ledger", { inventoryDigest: "expected-digest", destinationPath: "C:\\exports\\ledger.mshlicense" });
    expect(invoke).toHaveBeenCalledWith("preview_license_review_ledger_backup", { inventoryDigest: "expected-digest", sourcePath: "C:\\exports\\ledger.mshlicense" });
    expect(invoke).toHaveBeenCalledWith("restore_license_review_ledger_backup", { input: { inventoryDigest: "expected-digest", sourcePath: "C:\\exports\\ledger.mshlicense", expectedBackupHash: "B".repeat(64), expectedBackupSha256: "C".repeat(64), expectedCurrentHash: "A".repeat(64), confirmed: true } });
    expect(invoke).toHaveBeenCalledWith("list_license_review_recoveries", { inventoryDigest: "expected-digest" });
    expect(invoke).toHaveBeenCalledWith("export_license_review_recovery", { input: { inventoryDigest: "expected-digest", fileName: "license-review-ledger-recovery-20260901.json", expectedSha256: "C".repeat(64), expectedLastHash: "D".repeat(64), destinationPath: "C:\\exports\\recovery.mshlicense" } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "report.csv", filters: [{ name: "CSV", extensions: ["csv"] }] }));
    expect(invoke).toHaveBeenCalledWith("write_supply_chain_report", { path: "C:\\exports\\report.csv", contents: "name,version" });
    expect(invoke).toHaveBeenCalledWith("verify_supply_chain_report", { path: "C:\\exports\\evidence.json", expectedDigest: "expected-digest" });
  });

  it("キャンセルとnullのネイティブ応答をundefinedへ正規化する", async () => {
    Object.defineProperty(window, tauriKey, { configurable: true, value: {} });
    const invoke = vi.fn().mockResolvedValue(null);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn().mockResolvedValue(["not-a-string"]), save: vi.fn().mockResolvedValue(undefined) }));
    const { developerBackend } = await import("./developerBackend");

    await expect(developerBackend.discoverWorkspace()).resolves.toBeUndefined();
    await expect(developerBackend.chooseWorkspace()).resolves.toBeUndefined();
    await expect(developerBackend.exportLicenseReviewLedger("digest")).resolves.toBeUndefined();
    await expect(developerBackend.chooseLicenseReviewLedgerBackup("digest")).resolves.toBeUndefined();
    await expect(developerBackend.exportLicenseReviewRecovery("digest", { fileName: "recovery.json", integrity: "verified" } as never)).resolves.toBeUndefined();
    await expect(developerBackend.exportSupplyChainReport("report.json", "application/json", "{}" )).resolves.toBeUndefined();
    await expect(developerBackend.verifySupplyChainReport("digest")).resolves.toBeUndefined();
  });

  it("整合性未検証の復旧ファイルは保存ダイアログ前に拒否する", async () => {
    Object.defineProperty(window, tauriKey, { configurable: true, value: {} });
    const invoke = vi.fn();
    const save = vi.fn();
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save }));
    const { developerBackend } = await import("./developerBackend");

    await expect(developerBackend.exportLicenseReviewRecovery("digest", { integrity: "invalid" } as never)).rejects.toThrow("license-ledger-recovery-invalid");
    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
