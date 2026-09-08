import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LicenseReviewCenter } from "./LicenseReviewCenter";
import { loadLocalePack, locales } from "./locale";
import { reviewLabels } from "./reviewLocale";
import type { LicenseEvidenceReport, LicenseLedgerBackupPreview, LicenseLedgerRecoveryList, LicenseLedgerSnapshot, LicenseReviewState } from "./types";

const digest = "A".repeat(64);
beforeAll(async () => { await Promise.all(locales.map(loadLocalePack)); });
const state: LicenseReviewState = {
  inventoryDigest: digest,
  items: [
    { id: "cargo:unknown@1.0.0:AAAA", ecosystem: "cargo", name: "unknown", version: "1.0.0", license: "", licenseClass: "unknown", source: "registry+https://github.com/rust-lang/crates.io-index", integrity: "B".repeat(64), integrityPresent: true, direct: true, development: false, componentIds: ["app-cargo"], reason: "unknown-license" },
    { id: "npm:reciprocal@2.0.0:BBBB", ecosystem: "npm", name: "reciprocal", version: "2.0.0", license: "MPL-2.0", licenseClass: "reciprocal", source: "https://registry.npmjs.org/reciprocal.tgz", integrity: "sha512-demo", integrityPresent: true, direct: false, development: true, componentIds: ["website-npm"], reason: "reciprocal-license" },
  ],
  records: [],
  expiredRecords: [],
  summary: { total: 2, pending: 2, approved: 0, restricted: 0, blocked: 0, expired: 0, stale: 0 },
};

const evidence: LicenseEvidenceReport = {
  schemaVersion: 3,
  scannedAt: "2026-09-01T00:00:00.000Z",
  inventoryDigest: digest,
  localOnly: true,
  summary: {
    total: 1, complete: 0, partial: 0, missing: 1, mismatch: 0, integrityVerified: 0, evidenceFiles: 0,
    applicability: { applicable: 0, excluded: 1, unknown: 0, actionableGaps: 0, excludedGaps: 1, unknownGaps: 0 },
  },
  items: [{ ecosystem: "cargo", name: "unknown", version: "1.0.0", declaredLicense: "", manifestLicense: "", componentIds: ["app-cargo"], status: "missing", reason: "local-manifest-missing", manifestSource: "cargo-registry/Cargo.toml", integrity: "unavailable", hostApplicability: "excluded", applicabilityReason: "npm-os-excluded", files: [] }],
};

const ledger: LicenseLedgerSnapshot = {
  schemaVersion: 1,
  inventoryDigest: digest,
  storage: "app-data",
  integrity: "verified",
  eventCount: 2,
  expiringSoon: 1,
  lastHash: "C".repeat(64),
  updatedAt: "2026-09-01T00:00:00.000Z",
  records: [],
  history: [
    { sequence: 2, action: "reset", itemId: state.items[0].id, name: "unknown", version: "1.0.0", decision: "", reviewer: "", rationale: "", occurredAt: "2026-09-01T00:00:00.000Z", expiresAt: "", eventHash: "C".repeat(64) },
    { sequence: 1, action: "migration", itemId: state.items[0].id, name: "unknown", version: "1.0.0", decision: "approved", reviewer: "Release team", rationale: "Checked the exact license obligations.", occurredAt: "2026-08-31T00:00:00.000Z", expiresAt: "2027-02-27T00:00:00.000Z", eventHash: "B".repeat(64) },
  ],
};

const forwardBackup: LicenseLedgerBackupPreview = {
  sourcePath: "C:\\backups\\release-forward.mshlicense",
  inventoryDigest: digest,
  relation: "incoming-ahead",
  canRestore: true,
  reason: "backup-extends-current-ledger",
  currentEventCount: 2,
  backupEventCount: 4,
  commonEventCount: 2,
  activeRecords: 2,
  expiringSoon: 0,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-09-01T01:00:00.000Z",
  sizeBytes: 4096,
  backupSha256: "D".repeat(64),
  backupLastHash: "E".repeat(64),
  currentLastHash: ledger.lastHash,
};

const recoveries: LicenseLedgerRecoveryList = {
  inventoryDigest: digest,
  generatedAt: "2026-09-01T02:00:00.000Z",
  totalFiles: 2,
  returnedFiles: 2,
  verifiedFiles: 1,
  invalidFiles: 1,
  totalSizeBytes: 6144,
  retentionLimit: 20,
  truncated: false,
  entries: [
    {
      fileName: "license-review-ledger-recovery-20260901.json", integrity: "verified", error: "", relation: "current-ahead", commonEventCount: 2, eventCount: 2, activeRecords: 1, expiringSoon: 0, createdAt: "2026-08-31T00:00:00.000Z", updatedAt: "2026-09-01T01:00:00.000Z", sizeBytes: 4096, sha256: "F".repeat(64), lastHash: "E".repeat(64), differenceCount: 1,
      differences: [{ itemId: state.items[0].id, name: "unknown", version: "1.0.0", kind: "changed", currentDecision: "blocked", recoveryDecision: "approved" }],
    },
    {
      fileName: "license-review-ledger-recovery-corrupt.json", integrity: "invalid", error: "license-ledger-hash-mismatch", relation: "invalid", commonEventCount: 0, eventCount: 0, activeRecords: 0, expiringSoon: 0, createdAt: "", updatedAt: "", sizeBytes: 2048, sha256: "", lastHash: "", differenceCount: 0, differences: [],
    },
  ],
};

describe("LicenseReviewCenter", () => {
  it("requires a reviewer and rationale before saving a decision", () => {
    const onSave = vi.fn();
    render(<LicenseReviewCenter state={state} locale="en" onSave={onSave} onRemove={vi.fn()} onExport={vi.fn()} exporting={false} exportMessage="" />);
    fireEvent.click(screen.getByText("unknown"));
    const save = screen.getAllByRole("button", { name: "Save review" })[0];
    expect(save).toBeDisabled();
    fireEvent.change(screen.getAllByLabelText("Decision")[0], { target: { value: "approved" } });
    fireEvent.change(screen.getAllByLabelText("Reviewer")[0], { target: { value: "Release team" } });
    fireEvent.change(screen.getAllByLabelText("Evidence and reason")[0], { target: { value: "Verified the exact manifest and distribution obligations." } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(state.items[0], { decision: "approved", reviewer: "Release team", rationale: "Verified the exact manifest and distribution obligations.", validityDays: 180 });
  });

  it("filters by decision and exports only after an explicit action", () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    render(<LicenseReviewCenter state={state} locale="en" onSave={vi.fn()} onRemove={vi.fn()} onExport={onExport} exporting={false} exportMessage="" />);
    fireEvent.change(screen.getByLabelText("All decisions"), { target: { value: "approved" } });
    expect(screen.getByText("No review item matches these filters.")).toBeInTheDocument();
    expect(onExport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Export review register" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("shows host applicability next to collected evidence in the review register", () => {
    render(<LicenseReviewCenter state={state} evidence={evidence} locale="en" onSave={vi.fn()} onRemove={vi.fn()} onExport={vi.fn()} exporting={false} exportMessage="" />);
    fireEvent.click(screen.getByText("unknown"));
    expect(screen.getByText(/Local files missing.*Excluded by package metadata/)).toBeInTheDocument();
  });

  it("shows the verified native ledger, near-expiry count, and append-only history", () => {
    render(<LicenseReviewCenter state={state} ledger={ledger} locale="en" onSave={vi.fn()} onRemove={vi.fn()} onExport={vi.fn()} exporting={false} exportMessage="" />);
    expect(screen.getByText(/SHA-256 chain verified/)).toBeInTheDocument();
    expect(screen.getByText("Expiring within 30 days").nextElementSibling).toHaveTextContent("1");
    fireEvent.click(screen.getByText("Decision history"));
    expect(screen.getByText("Migrated")).toBeInTheDocument();
    expect(screen.getByText("Reset")).toBeInTheDocument();
    expect(screen.getAllByText(/CCCCCCCCCCCC/)).toHaveLength(2);
  });

  it("fails closed and explains that no saved decision is used when the native ledger cannot load", () => {
    render(<LicenseReviewCenter state={state} ledgerError="license-ledger-hash-mismatch" locale="en" onSave={vi.fn()} onRemove={vi.fn()} onExport={vi.fn()} exporting={false} exportMessage="" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Native ledger unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent("No saved decision is being used");
    expect(screen.getByRole("alert")).toHaveTextContent("license-ledger-hash-mismatch");
  });

  it("verifies a forward backup and requires explicit confirmation before restoring", async () => {
    const onExportLedger = vi.fn().mockResolvedValue({ path: "C:\\backups\\ledger.mshlicense", sha256: "F".repeat(64), sizeBytes: 4096, eventCount: 2, lastHash: ledger.lastHash });
    const onChooseBackup = vi.fn().mockResolvedValue(forwardBackup);
    const onRestoreBackup = vi.fn().mockResolvedValue({ snapshot: { ...ledger, eventCount: 4, lastHash: forwardBackup.backupLastHash }, recoveryCreated: true, recoveryFile: "license-review-ledger-recovery-20260901.json" });
    render(<LicenseReviewCenter state={state} ledger={ledger} locale="en" onSave={vi.fn()} onRemove={vi.fn()} onExport={vi.fn()} onExportLedger={onExportLedger} onChooseBackup={onChooseBackup} onRestoreBackup={onRestoreBackup} exporting={false} exportMessage="" />);

    fireEvent.click(screen.getByRole("button", { name: "Export verified backup" }));
    await waitFor(() => expect(onExportLedger).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Verified backup exported: ledger\.mshlicense/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose and verify backup" }));
    expect(await screen.findByText("release-forward.mshlicense")).toBeInTheDocument();
    expect(screen.getByText("Forward history")).toBeInTheDocument();
    const restore = screen.getByRole("button", { name: "Restore verified backup" });
    expect(restore).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(restore).toBeEnabled();
    fireEvent.click(restore);
    await waitFor(() => expect(onRestoreBackup).toHaveBeenCalledWith(forwardBackup));
    expect(await screen.findByText(/Verified backup restored.*license-review-ledger-recovery-20260901\.json/)).toBeInTheDocument();
  });

  it("shows an older backup as verified but never offers restore", async () => {
    const onChooseBackup = vi.fn().mockResolvedValue({ ...forwardBackup, relation: "current-ahead", canRestore: false });
    render(<LicenseReviewCenter state={state} ledger={ledger} locale="en" onSave={vi.fn()} onRemove={vi.fn()} onExport={vi.fn()} onChooseBackup={onChooseBackup} exporting={false} exportMessage="" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose and verify backup" }));
    expect(await screen.findByText("Older backup")).toBeInTheDocument();
    expect(screen.getByText(/Restore is blocked/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore verified backup" })).not.toBeInTheDocument();
  });

  it("lists verified and invalid recoveries, shows decision differences, and exports only the verified entry", async () => {
    const onRefreshRecoveries = vi.fn().mockResolvedValue(recoveries);
    const onExportRecovery = vi.fn().mockResolvedValue({ path: "C:\\exports\\recovery.mshlicense", sha256: "A".repeat(64), sizeBytes: 4096, eventCount: 2, lastHash: "E".repeat(64) });
    render(<LicenseReviewCenter state={state} ledger={ledger} recoveries={recoveries} locale="en" onSave={vi.fn()} onRemove={vi.fn()} onExport={vi.fn()} onRefreshRecoveries={onRefreshRecoveries} onExportRecovery={onExportRecovery} exporting={false} exportMessage="" />);

    expect(screen.getByRole("heading", { name: "Recovery history center" })).toBeInTheDocument();
    expect(screen.getByText("Recovery files").nextElementSibling).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "Refresh recovery history" }));
    await waitFor(() => expect(onRefreshRecoveries).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByText("license-review-ledger-recovery-20260901.json"));
    expect(screen.getByText("Current vs recovery decisions")).toBeInTheDocument();
    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.getByText(/Current:/)).toHaveTextContent("Block release");
    expect(screen.getByText(/Recovery:/)).toHaveTextContent("Approved for distribution");
    fireEvent.click(screen.getByRole("button", { name: "Export as .mshlicense" }));
    await waitFor(() => expect(onExportRecovery).toHaveBeenCalledWith(recoveries.entries[0]));
    expect(await screen.findByText(/Verified recovery exported: recovery\.mshlicense/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("license-review-ledger-recovery-corrupt.json"));
    expect(screen.getByText(/cannot be exported because integrity verification failed/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Export as .mshlicense" })).toHaveLength(1);
  });

  it("provides a complete localized catalog for all nine languages", () => {
    expect(locales).toHaveLength(9);
    const englishKeys = Object.keys(reviewLabels.en).sort();
    for (const locale of locales) {
      expect(Object.keys(reviewLabels[locale]).sort()).toEqual(englishKeys);
      expect(Object.values(reviewLabels[locale]).every((value) => value.trim().length > 0)).toBe(true);
      if (locale !== "en") expect(reviewLabels[locale].title).not.toBe(reviewLabels.en.title);
    }
  });

  it("renders the decision-validity control in all nine languages", () => {
    for (const locale of locales) {
      const labels = reviewLabels[locale];
      const view = render(<LicenseReviewCenter state={state} locale={locale} onSave={vi.fn()} onRemove={vi.fn()} onExport={vi.fn()} exporting={false} exportMessage="" />);
      const packageName = screen.getByText("unknown");
      fireEvent.click(packageName);
      const entry = packageName.closest("details");
      expect(entry).not.toBeNull();
      const review = within(entry as HTMLElement);
      const validity = review.getByLabelText(labels.validity) as HTMLSelectElement;
      expect(validity.value).toBe("180");
      expect(review.getByRole("option", { name: labels.validity30 })).toBeInTheDocument();
      expect(review.getByRole("option", { name: labels.validity180 })).toBeInTheDocument();
      expect(review.getByRole("option", { name: labels.validity365 })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("renders localized backup maintenance labels in all nine languages", () => {
    for (const locale of locales) {
      const labels = reviewLabels[locale];
      const view = render(<LicenseReviewCenter state={state} ledger={ledger} locale={locale} onSave={vi.fn()} onRemove={vi.fn()} onExport={vi.fn()} exporting={false} exportMessage="" />);
      expect(screen.getByRole("heading", { name: labels.ledgerBackupTitle })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: labels.exportLedger })).toBeDisabled();
      expect(screen.getByRole("button", { name: labels.verifyBackup })).toBeDisabled();
      view.unmount();
    }
  });

  it("renders localized recovery-history labels in all nine languages", () => {
    for (const locale of locales) {
      const labels = reviewLabels[locale];
      const view = render(<LicenseReviewCenter state={state} ledger={ledger} recoveries={{ ...recoveries, entries: [] }} locale={locale} onSave={vi.fn()} onRemove={vi.fn()} onExport={vi.fn()} onRefreshRecoveries={vi.fn()} exporting={false} exportMessage="" />);
      expect(screen.getByRole("heading", { name: labels.recoveryTitle })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: labels.refreshRecoveries })).toBeEnabled();
      expect(screen.getByText(labels.noRecoveries)).toBeInTheDocument();
      view.unmount();
    }
  });
});
