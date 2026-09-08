import type { AdvisoryScanResult, DeveloperInspectionReport, DeveloperUpdateInfo, LicenseEvidenceReport, LicenseLedgerBackupPreview, LicenseLedgerExportReceipt, LicenseLedgerRecoveryEntry, LicenseLedgerRecoveryList, LicenseLedgerRestoreReceipt, LicenseLedgerSnapshot, LicenseReviewDraft, LicenseReviewItem, LicenseReviewRecord, ReleaseApprovalPreview, ReleaseApprovalReceipt, ReleaseEvidenceExportReceipt, ReleaseEvidencePackPreview, ReleaseEvidenceVerification, ReleaseHandoffExportReceipt, ReleaseHandoffPreview, ReleaseHandoffVerification, SupplyChainReportVerification } from "./types";

const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const developerBackend = {
  isDesktop,
  async getDeveloperToolsVersion(): Promise<string> {
    if (!isDesktop) return "0.3.1";
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  },
  async checkDeveloperUpdate(): Promise<DeveloperUpdateInfo> {
    if (!isDesktop) return {
      configured: true,
      currentVersion: "0.3.1",
      available: false,
      endpoint: "https://raw.githubusercontent.com/taori2731/minecraft-server-hub-releases/main/developer-tools/latest.json",
    };
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<DeveloperUpdateInfo>("check_developer_update");
  },
  async installDeveloperUpdate(expectedVersion: string, confirmed: boolean): Promise<void> {
    if (!isDesktop) throw new Error("developer-update-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("install_developer_update", { expectedVersion, confirmed });
  },
  async discoverWorkspace(): Promise<string | undefined> {
    if (!isDesktop) return undefined;
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<string | null>("discover_workspace")) ?? undefined;
  },
  async chooseWorkspace(): Promise<string | undefined> {
    if (!isDesktop) return undefined;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false, title: "Minecraft Server Hub workspace" });
    return typeof selected === "string" ? selected : undefined;
  },
  async inspectWorkspace(workspaceRoot: string, checkRemoteFeed = true): Promise<DeveloperInspectionReport> {
    if (isDesktop) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<DeveloperInspectionReport>("inspect_workspace", { workspaceRoot, checkRemoteFeed });
    }
    const response = await fetch(`/__developer-tools/report?at=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<DeveloperInspectionReport>;
  },
  async scanDependencyAdvisories(workspaceRoot: string, expectedDigest: string): Promise<AdvisoryScanResult> {
    if (!isDesktop) throw new Error("advisory-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AdvisoryScanResult>("scan_dependency_advisories", { workspaceRoot, expectedDigest, consent: true });
  },
  async collectLicenseEvidence(workspaceRoot: string, expectedDigest: string): Promise<LicenseEvidenceReport> {
    if (!isDesktop) throw new Error("license-evidence-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LicenseEvidenceReport>("collect_license_evidence", { workspaceRoot, expectedDigest });
  },
  async loadLicenseReviewLedger(inventoryDigest: string): Promise<LicenseLedgerSnapshot> {
    if (!isDesktop) throw new Error("license-ledger-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LicenseLedgerSnapshot>("load_license_review_ledger", { inventoryDigest });
  },
  async appendLicenseReviewDecision(inventoryDigest: string, item: LicenseReviewItem, draft: LicenseReviewDraft): Promise<LicenseLedgerSnapshot> {
    if (!isDesktop) throw new Error("license-ledger-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LicenseLedgerSnapshot>("append_license_review_decision", {
      input: {
        inventoryDigest,
        itemId: item.id,
        ecosystem: item.ecosystem,
        name: item.name,
        version: item.version,
        license: item.license,
        licenseClass: item.licenseClass,
        source: item.source,
        integrity: item.integrity,
        componentIds: item.componentIds,
        decision: draft.decision,
        reviewer: draft.reviewer,
        rationale: draft.rationale,
        validityDays: draft.validityDays,
      },
    });
  },
  async resetLicenseReviewDecision(inventoryDigest: string, itemId: string): Promise<LicenseLedgerSnapshot> {
    if (!isDesktop) throw new Error("license-ledger-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LicenseLedgerSnapshot>("reset_license_review_decision", { inventoryDigest, itemId });
  },
  async migrateLicenseReviewRecords(inventoryDigest: string, records: LicenseReviewRecord[]): Promise<LicenseLedgerSnapshot> {
    if (!isDesktop) throw new Error("license-ledger-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LicenseLedgerSnapshot>("migrate_license_review_records", { inventoryDigest, records });
  },
  async exportLicenseReviewLedger(inventoryDigest: string): Promise<LicenseLedgerExportReceipt | undefined> {
    if (!isDesktop) throw new Error("license-ledger-native-only");
    const { save } = await import("@tauri-apps/plugin-dialog");
    const stamp = new Date().toISOString().slice(0, 10);
    const selected = await save({
      title: "Export verified license review ledger",
      defaultPath: `license-review-ledger-${inventoryDigest.slice(0, 12)}-${stamp}.mshlicense`,
      filters: [{ name: "MSH License Ledger", extensions: ["mshlicense"] }],
    });
    if (!selected) return undefined;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LicenseLedgerExportReceipt>("export_license_review_ledger", { inventoryDigest, destinationPath: selected });
  },
  async chooseLicenseReviewLedgerBackup(inventoryDigest: string): Promise<LicenseLedgerBackupPreview | undefined> {
    if (!isDesktop) throw new Error("license-ledger-native-only");
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Verify license review ledger backup",
      filters: [{ name: "MSH License Ledger", extensions: ["mshlicense"] }],
    });
    if (typeof selected !== "string") return undefined;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LicenseLedgerBackupPreview>("preview_license_review_ledger_backup", { inventoryDigest, sourcePath: selected });
  },
  async restoreLicenseReviewLedgerBackup(preview: LicenseLedgerBackupPreview, confirmed: boolean): Promise<LicenseLedgerRestoreReceipt> {
    if (!isDesktop) throw new Error("license-ledger-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LicenseLedgerRestoreReceipt>("restore_license_review_ledger_backup", {
      input: {
        inventoryDigest: preview.inventoryDigest,
        sourcePath: preview.sourcePath,
        expectedBackupHash: preview.backupLastHash,
        expectedBackupSha256: preview.backupSha256,
        expectedCurrentHash: preview.currentLastHash,
        confirmed,
      },
    });
  },
  async listLicenseReviewRecoveries(inventoryDigest: string): Promise<LicenseLedgerRecoveryList> {
    if (!isDesktop) throw new Error("license-ledger-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LicenseLedgerRecoveryList>("list_license_review_recoveries", { inventoryDigest });
  },
  async exportLicenseReviewRecovery(inventoryDigest: string, recovery: LicenseLedgerRecoveryEntry): Promise<LicenseLedgerExportReceipt | undefined> {
    if (!isDesktop) throw new Error("license-ledger-native-only");
    if (recovery.integrity !== "verified") throw new Error("license-ledger-recovery-invalid");
    const { save } = await import("@tauri-apps/plugin-dialog");
    const base = recovery.fileName.replace(/\.json$/i, "");
    const selected = await save({
      title: "Export verified recovery ledger",
      defaultPath: `${base}.mshlicense`,
      filters: [{ name: "MSH License Ledger", extensions: ["mshlicense"] }],
    });
    if (!selected) return undefined;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LicenseLedgerExportReceipt>("export_license_review_recovery", {
      input: {
        inventoryDigest,
        fileName: recovery.fileName,
        expectedSha256: recovery.sha256,
        expectedLastHash: recovery.lastHash,
        destinationPath: selected,
      },
    });
  },
  async exportSupplyChainReport(filename: string, mime: string, content: string): Promise<string | undefined> {
    if (!isDesktop) {
      const anchor = document.createElement("a");
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      return filename;
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const extension = filename.endsWith(".csv") ? "csv" : filename.endsWith(".md") ? "md" : "json";
    const selected = await save({
      title: "Export supply-chain report",
      defaultPath: filename,
      filters: [{ name: extension === "csv" ? "CSV" : extension === "md" ? "Markdown" : "JSON", extensions: [extension] }],
    });
    if (!selected) return undefined;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("write_supply_chain_report", { path: selected, contents: content });
  },
  async verifySupplyChainReport(expectedDigest: string): Promise<SupplyChainReportVerification | undefined> {
    if (!isDesktop) throw new Error("audit-verification-native-only");
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Verify Windows x64 license evidence",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof selected !== "string") return undefined;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SupplyChainReportVerification>("verify_supply_chain_report", { path: selected, expectedDigest });
  },
  async previewReleaseEvidencePack(workspaceRoot: string): Promise<ReleaseEvidencePackPreview> {
    if (!isDesktop) throw new Error("release-evidence-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ReleaseEvidencePackPreview>("preview_release_evidence_pack", { workspaceRoot });
  },
  async exportReleaseEvidencePack(workspaceRoot: string, preview: ReleaseEvidencePackPreview, confirmed: boolean): Promise<ReleaseEvidenceExportReceipt | undefined> {
    if (!isDesktop) throw new Error("release-evidence-native-only");
    const { save } = await import("@tauri-apps/plugin-dialog");
    const stamp = preview.generatedAt.replace(/[:.]/g, "-");
    const selected = await save({
      title: "Export verified release evidence pack",
      defaultPath: `minecraft-server-hub-${preview.projectVersion}-${stamp}.mshrelease`,
      filters: [{ name: "MSH Release Evidence", extensions: ["mshrelease"] }],
    });
    if (!selected) return undefined;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ReleaseEvidenceExportReceipt>("export_release_evidence_pack", { input: {
      workspaceRoot,
      generatedAt: preview.generatedAt,
      expectedPayloadSha256: preview.payloadSha256,
      destinationPath: selected,
      confirmed,
    } });
  },
  async chooseAndVerifyReleaseEvidencePack(workspaceRoot: string): Promise<ReleaseEvidenceVerification | undefined> {
    if (!isDesktop) throw new Error("release-evidence-native-only");
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Verify release evidence pack",
      filters: [{ name: "MSH Release Evidence", extensions: ["mshrelease"] }],
    });
    if (typeof selected !== "string") return undefined;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ReleaseEvidenceVerification>("verify_release_evidence_pack", { workspaceRoot, sourcePath: selected });
  },
  async previewReleaseApproval(workspaceRoot: string): Promise<ReleaseApprovalPreview> {
    if (!isDesktop) throw new Error("release-approval-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ReleaseApprovalPreview>("preview_release_approval", { workspaceRoot });
  },
  async recordReleaseApproval(
    workspaceRoot: string,
    preview: ReleaseApprovalPreview,
    input: { reviewer: string; rationale: string; confirmationText: string; warningsConfirmed: boolean; confirmed: boolean },
  ): Promise<ReleaseApprovalReceipt> {
    if (!isDesktop) throw new Error("release-approval-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ReleaseApprovalReceipt>("record_release_approval", { input: {
      workspaceRoot,
      generatedAt: preview.generatedAt,
      expectedApprovalDigest: preview.approvalDigest,
      confirmationText: input.confirmationText,
      reviewer: input.reviewer,
      rationale: input.rationale,
      warningsConfirmed: input.warningsConfirmed,
      confirmed: input.confirmed,
    } });
  },
  async previewReleaseHandoff(workspaceRoot: string): Promise<ReleaseHandoffPreview> {
    if (!isDesktop) throw new Error("release-handoff-native-only");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ReleaseHandoffPreview>("preview_release_handoff", { workspaceRoot });
  },
  async exportReleaseHandoff(workspaceRoot: string, preview: ReleaseHandoffPreview, confirmed: boolean): Promise<ReleaseHandoffExportReceipt | undefined> {
    if (!isDesktop) throw new Error("release-handoff-native-only");
    const { save } = await import("@tauri-apps/plugin-dialog");
    const stamp = preview.generatedAt.replace(/[:.]/g, "-");
    const selected = await save({
      title: "Export verified release handoff pack",
      defaultPath: `minecraft-server-hub-${preview.projectVersion}-${stamp}.mshhandoff`,
      filters: [{ name: "MSH Release Handoff", extensions: ["mshhandoff"] }],
    });
    if (!selected) return undefined;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ReleaseHandoffExportReceipt>("export_release_handoff", { input: {
      workspaceRoot,
      generatedAt: preview.generatedAt,
      expectedPayloadSha256: preview.payloadSha256,
      destinationPath: selected,
      confirmed,
    } });
  },
  async chooseAndVerifyReleaseHandoff(workspaceRoot: string, expectedFileSha256 = ""): Promise<ReleaseHandoffVerification | undefined> {
    if (!isDesktop) throw new Error("release-handoff-native-only");
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Verify release handoff pack",
      filters: [{ name: "MSH Release Handoff", extensions: ["mshhandoff"] }],
    });
    if (typeof selected !== "string") return undefined;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ReleaseHandoffVerification>("verify_release_handoff", {
      workspaceRoot,
      sourcePath: selected,
      expectedFileSha256: expectedFileSha256.trim(),
    });
  },
};
