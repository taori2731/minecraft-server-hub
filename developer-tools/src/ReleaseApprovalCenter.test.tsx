import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { developerBackend } from "./developerBackend";
import { loadLocalePack, locales } from "./locale";
import { ReleaseApprovalCenter } from "./ReleaseApprovalCenter";
import { releaseApprovalText } from "./releaseApprovalLocale";
import type { ReleaseApprovalPreview, ReleaseApprovalReceipt } from "./types";

const workspace = "C:" + String.fromCharCode(92) + "workspace";
const preview: ReleaseApprovalPreview = {
  generatedAt: new Date().toISOString(), projectVersion: "0.3.2", evidencePayloadSha256: "A".repeat(64), candidateFingerprint: "E".repeat(64), approvalDigest: "B".repeat(64), installerSha256: "C".repeat(64), expectedConfirmation: "APPROVE 0.3.2",
  conditions: [
    { id: "qualityTests", status: "pass", actual: "293/293/0/0", source: "quality" },
    { id: "dependencyAdvisories", status: "warning", actual: "warning", source: "dependencies" },
  ],
  blockerCount: 0, warningCount: 1, canApprove: true,
  ledger: { integrity: "verified", eventCount: 0, lastHash: "0".repeat(64), updatedAt: "2026-09-01T00:00:00Z", history: [] },
};
const receipt: ReleaseApprovalReceipt = {
  event: { sequence: 1, projectVersion: "0.3.2", evidencePayloadSha256: preview.evidencePayloadSha256, candidateFingerprint: preview.candidateFingerprint, approvalDigest: preview.approvalDigest, installerSha256: preview.installerSha256, reviewer: "Release Team", rationale: "All release gates and warnings were reviewed.", approvedAt: "2026-09-01T00:01:00Z", warningIds: ["dependencyAdvisories"], eventHash: "D".repeat(64) },
  ledger: { integrity: "verified", eventCount: 1, lastHash: "D".repeat(64), updatedAt: "2026-09-01T00:01:00Z", history: [] },
};

beforeAll(async () => { await Promise.all(locales.map(loadLocalePack)); });
afterEach(() => vi.restoreAllMocks());

describe("ReleaseApprovalCenter", () => {
  it("requires exact phrase, reviewer, rationale, warning acknowledgement, and final consent", async () => {
    vi.spyOn(developerBackend, "previewReleaseApproval").mockResolvedValue(preview);
    const record = vi.spyOn(developerBackend, "recordReleaseApproval").mockResolvedValue(receipt);
    render(<ReleaseApprovalCenter locale="en" workspaceRoot={workspace} isDesktop />);

    fireEvent.click(screen.getByRole("button", { name: "Evaluate candidate" }));
    expect(await screen.findByText("293/293/0/0")).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "Record approval" });
    expect(approve).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Approver"), { target: { value: "Release Team" } });
    fireEvent.change(screen.getByLabelText("Approval rationale"), { target: { value: "All release gates and warnings were reviewed." } });
    fireEvent.change(screen.getByLabelText("Typed confirmation"), { target: { value: "APPROVE 0.3.2" } });
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    expect(approve).toBeEnabled();
    fireEvent.click(approve);

    await waitFor(() => expect(record).toHaveBeenCalledWith(workspace, preview, {
      reviewer: "Release Team", rationale: "All release gates and warnings were reviewed.", confirmationText: "APPROVE 0.3.2", warningsConfirmed: true, confirmed: true,
    }));
    expect(await screen.findByText(/Approval recorded in the verified local ledger/)).toBeInTheDocument();
  });

  it("does not render the approval form for a blocked candidate", async () => {
    vi.spyOn(developerBackend, "previewReleaseApproval").mockResolvedValue({ ...preview, canApprove: false, blockerCount: 1, conditions: [{ id: "qualityTests", status: "fail", actual: "292/293/1/0", source: "quality" }] });
    render(<ReleaseApprovalCenter locale="en" workspaceRoot={workspace} isDesktop />);
    fireEvent.click(screen.getByRole("button", { name: "Evaluate candidate" }));
    expect(await screen.findByText("Approval blocked")).toBeInTheDocument();
    expect(screen.queryByLabelText("Approver")).not.toBeInTheDocument();
  });

  it("keeps approval actions unavailable in browser mode", () => {
    render(<ReleaseApprovalCenter locale="en" workspaceRoot={workspace} isDesktop={false} />);
    expect(screen.getByText(/installed Windows Developer Tools app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Evaluate candidate" })).not.toBeInTheDocument();
  });

  it("provides complete D21 copy in all nine languages", () => {
    const keys = Object.keys(releaseApprovalText("en")).sort();
    expect(locales).toHaveLength(9);
    for (const locale of locales) {
      const copy = releaseApprovalText(locale);
      expect(Object.keys(copy).sort()).toEqual(keys);
      expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(true);
      if (locale !== "en") expect(copy.title).not.toBe(releaseApprovalText("en").title);
    }
  });
});
