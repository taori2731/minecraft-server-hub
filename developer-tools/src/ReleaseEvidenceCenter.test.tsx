import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { developerBackend } from "./developerBackend";
import { loadLocalePack, locales } from "./locale";
import { ReleaseEvidenceCenter } from "./ReleaseEvidenceCenter";
import { releaseEvidenceText } from "./releaseEvidenceLocale";
import type { ReleaseEvidencePackPreview } from "./types";

const preview: ReleaseEvidencePackPreview = {
  generatedAt: new Date().toISOString(), projectVersion: "0.3.2", inventoryDigest: "A".repeat(64), sourceDigest: "B".repeat(64), payloadSha256: "C".repeat(64), sizeBytes: 8192,
  sections: ["inspection", "quality", "licenseEvidence"], warnings: [], checkSummary: { pass: 12, warning: 0, fail: 0 },
  qualitySummary: { totalStages: 7, passedStages: 7, totalTests: 285, passedTests: 285 }, licenseSummary: { total: 20, complete: 20, missing: 0, mismatch: 0, evidenceFiles: 20 },
  ledgerIntegrity: "verified", ledgerEventCount: 4, canExport: true,
};
const workspace = "C:" + String.fromCharCode(92) + "workspace";

beforeAll(async () => { await Promise.all(locales.map(loadLocalePack)); });
afterEach(() => vi.restoreAllMocks());

describe("ReleaseEvidenceCenter", () => {
  it("requires preview and explicit confirmation before export", async () => {
    const prepare = vi.spyOn(developerBackend, "previewReleaseEvidencePack").mockResolvedValue(preview);
    const exportPack = vi.spyOn(developerBackend, "exportReleaseEvidencePack").mockResolvedValue({ path: "C:\\exports\\proof.mshrelease", generatedAt: preview.generatedAt, projectVersion: "0.3.2", payloadSha256: preview.payloadSha256, fileSha256: "D".repeat(64), sizeBytes: 8192 });
    render(<ReleaseEvidenceCenter locale="en" workspaceRoot={workspace} isDesktop />);
    expect(exportPack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
    expect(await screen.findByText("285 / 285")).toBeInTheDocument();
    expect(prepare).toHaveBeenCalledWith(workspace);
    const exportButton = screen.getByRole("button", { name: "Export .mshrelease" });
    expect(exportButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);
    await waitFor(() => expect(exportPack).toHaveBeenCalledWith(workspace, preview, true));
    expect(await screen.findByText(/proof\.mshrelease/)).toBeInTheDocument();
  });

  it("keeps file actions unavailable in browser mode", () => {
    render(<ReleaseEvidenceCenter locale="en" workspaceRoot={workspace} isDesktop={false} />);
    expect(screen.getByText(/installed Windows app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prepare preview" })).not.toBeInTheDocument();
  });

  it("provides the complete D20 copy in all nine languages", () => {
    const englishKeys = Object.keys(releaseEvidenceText("en")).sort();
    expect(locales).toHaveLength(9);
    for (const locale of locales) {
      const copy = releaseEvidenceText(locale);
      expect(Object.keys(copy).sort()).toEqual(englishKeys);
      expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(true);
      if (locale !== "en") expect(copy.title).not.toBe(releaseEvidenceText("en").title);
    }
  });
});
