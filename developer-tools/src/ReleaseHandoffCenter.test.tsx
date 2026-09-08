import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { developerBackend } from "./developerBackend";
import { locales } from "./locale";
import { ReleaseHandoffCenter } from "./ReleaseHandoffCenter";
import { releaseHandoffContents, releaseHandoffText, releaseHandoffTrustText } from "./releaseHandoffLocale";
import type { ReleaseHandoffExportReceipt, ReleaseHandoffPreview, ReleaseHandoffVerification } from "./types";

const workspace = "C:" + String.fromCharCode(92) + "workspace";
const preview: ReleaseHandoffPreview = {
  generatedAt: "2026-09-01T00:02:00Z", status: "ready", projectVersion: "0.3.2",
  candidateFingerprint: "A".repeat(64), evidencePayloadSha256: "B".repeat(64), installerSha256: "C".repeat(64),
  approvalSequence: 1, approvalEventHash: "D".repeat(64), approvedAt: "2026-09-01T00:01:00Z",
  warningIds: ["dependencyAdvisories"], ledgerEventCount: 1, ledgerLastHash: "D".repeat(64),
  payloadSha256: "E".repeat(64), sizeBytes: 2048, containsPersonalData: false, canExport: true,
};
const receipt: ReleaseHandoffExportReceipt = {
  path: "C:\\exports\\release.mshhandoff", generatedAt: preview.generatedAt, projectVersion: "0.3.2",
  candidateFingerprint: preview.candidateFingerprint, approvalEventHash: preview.approvalEventHash,
  payloadSha256: preview.payloadSha256, fileSha256: "F".repeat(64), sizeBytes: 2048,
};
const verification: ReleaseHandoffVerification = {
  integrity: "verified", error: "", generatedAt: preview.generatedAt, projectVersion: "0.3.2",
  candidateFingerprint: preview.candidateFingerprint, approvalEventHash: preview.approvalEventHash,
  payloadSha256: preview.payloadSha256, fileSha256: "F".repeat(64), sizeBytes: 2048,
  containsPersonalData: false, matchesCurrentCandidate: true, matchesCurrentApproval: false,
  expectedDigestStatus: "matches", originAssurance: "trustedDigestMatch", warnings: ["approval-not-present"],
};

afterEach(() => vi.restoreAllMocks());

describe("ReleaseHandoffCenter", () => {
  it("requires an exact current approval and explicit export confirmation", async () => {
    vi.spyOn(developerBackend, "previewReleaseHandoff").mockResolvedValue(preview);
    const exportPack = vi.spyOn(developerBackend, "exportReleaseHandoff").mockResolvedValue(receipt);
    render(<ReleaseHandoffCenter locale="en" workspaceRoot={workspace} isDesktop />);

    fireEvent.click(screen.getByRole("button", { name: "Prepare handoff" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Ready to hand off");
    const button = screen.getByRole("button", { name: "Export .mshhandoff" });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(exportPack).toHaveBeenCalledWith(workspace, preview, true));
    expect(await screen.findByText(/Release handoff exported/)).toBeInTheDocument();
  });

  it("blocks export when the exact current candidate has no approval", async () => {
    vi.spyOn(developerBackend, "previewReleaseHandoff").mockResolvedValue({
      ...preview, status: "approvalRequired", approvalSequence: 0, approvalEventHash: "", payloadSha256: "", sizeBytes: 0, canExport: false,
    });
    render(<ReleaseHandoffCenter locale="en" workspaceRoot={workspace} isDesktop />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare handoff" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Current candidate is not approved");
    expect(screen.queryByRole("button", { name: "Export .mshhandoff" })).not.toBeInTheDocument();
  });

  it("keeps handoff actions unavailable in browser mode", () => {
    render(<ReleaseHandoffCenter locale="en" workspaceRoot={workspace} isDesktop={false} />);
    expect(screen.getByText(/installed Windows Developer Tools app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prepare handoff" })).not.toBeInTheDocument();
  });

  it("compares a separately supplied trusted SHA-256 and reports each trust layer", async () => {
    const verifyPack = vi.spyOn(developerBackend, "chooseAndVerifyReleaseHandoff").mockResolvedValue(verification);
    render(<ReleaseHandoffCenter locale="en" workspaceRoot={workspace} isDesktop />);
    fireEvent.change(screen.getByLabelText("Expected file SHA-256"), { target: { value: "f".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Verify saved pack" }));
    await waitFor(() => expect(verifyPack).toHaveBeenCalledWith(workspace, "f".repeat(64)));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Self-integrity checks passed");
    expect(status).toHaveTextContent("Trusted digest matches");
    expect(status).toHaveTextContent("Local approval: Differs");
  });

  it("rejects an incomplete expected digest before opening the file picker", () => {
    const verifyPack = vi.spyOn(developerBackend, "chooseAndVerifyReleaseHandoff");
    render(<ReleaseHandoffCenter locale="en" workspaceRoot={workspace} isDesktop />);
    fireEvent.change(screen.getByLabelText("Expected file SHA-256"), { target: { value: "ABC" } });
    const button = screen.getByRole("button", { name: "Verify saved pack" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(verifyPack).not.toHaveBeenCalled();
  });

  it("keeps self-integrity separate from a mismatched trusted digest", async () => {
    vi.spyOn(developerBackend, "chooseAndVerifyReleaseHandoff").mockResolvedValue({
      ...verification, expectedDigestStatus: "differs", originAssurance: "digestMismatch",
      warnings: ["approval-not-present", "expected-digest-differs"],
    });
    render(<ReleaseHandoffCenter locale="en" workspaceRoot={workspace} isDesktop />);
    fireEvent.change(screen.getByLabelText("Expected file SHA-256"), { target: { value: "A".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Verify saved pack" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Self-integrity checks passed");
    expect(status).toHaveTextContent("Expected digest differs");
    expect(status).not.toHaveTextContent("Trusted digest matches");
  });

  it("does not claim origin assurance when no trusted digest or local approval exists", async () => {
    vi.spyOn(developerBackend, "chooseAndVerifyReleaseHandoff").mockResolvedValue({
      ...verification, expectedDigestStatus: "notProvided", originAssurance: "notEstablished",
      warnings: ["approval-not-present", "trusted-digest-not-provided"],
    });
    render(<ReleaseHandoffCenter locale="en" workspaceRoot={workspace} isDesktop />);
    fireEvent.click(screen.getByRole("button", { name: "Verify saved pack" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("No trusted digest supplied");
    expect(status).toHaveTextContent("Origin assurance: Not established");
  });

  it("provides complete D23 copy in all nine languages", () => {
    const keys = Object.keys(releaseHandoffText("en")).sort();
    const trustKeys = Object.keys(releaseHandoffTrustText("en")).sort();
    expect(locales).toHaveLength(9);
    for (const locale of locales) {
      const copy = releaseHandoffText(locale);
      expect(Object.keys(copy).sort()).toEqual(keys);
      expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(true);
      expect(releaseHandoffContents(locale).every((value) => value.trim().length > 0)).toBe(true);
      expect(Object.keys(releaseHandoffTrustText(locale)).sort()).toEqual(trustKeys);
      expect(Object.values(releaseHandoffTrustText(locale)).every((value) => value.trim().length > 0)).toBe(true);
      if (locale !== "en") expect(copy.title).not.toBe(releaseHandoffText("en").title);
    }
  });
});
