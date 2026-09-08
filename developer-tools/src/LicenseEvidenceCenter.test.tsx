import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cargoApplicabilityLabels } from "./cargoApplicabilityLocale";
import { evidenceLabels } from "./evidenceLocale";
import { LicenseEvidenceCenter } from "./LicenseEvidenceCenter";
import { loadLocalePack, locales } from "./locale";
import type { LicenseEvidenceReport } from "./types";

const report: LicenseEvidenceReport = {
  schemaVersion: 3,
  scannedAt: "2026-09-01T01:00:00Z",
  inventoryDigest: "A".repeat(64),
  localOnly: true,
  summary: { total: 2, complete: 1, partial: 0, missing: 1, mismatch: 0, integrityVerified: 1, evidenceFiles: 2, applicability: { applicable: 1, excluded: 1, unknown: 0, actionableGaps: 0, excludedGaps: 1, unknownGaps: 0 } },
  items: [
    { ecosystem: "cargo", name: "complete-crate", version: "1.0.0", componentIds: ["app-cargo"], declaredLicense: "MPL-2.0", manifestLicense: "MPL-2.0", manifestSource: "cargo-registry/Cargo.toml", status: "complete", integrity: "verified", hostApplicability: "applicable", applicabilityReason: "cargo-metadata-windows-x64-applicable", files: [{ name: "lib.rs", kind: "license-header", sizeBytes: 1200, sha256: "B".repeat(64) }], canonicalLicense: { spdxId: "MPL-2.0", sourceUrl: "https://www.mozilla.org/media/MPL/2.0/index.f75d2927d3c1.txt", localResource: "embedded/MPL-2.0.txt", sizeBytes: 16726, sha256: "3F3D9E0024B1921B067D6F7F88DEB4A60CBE7A78E76C64E3F1D7FC3B779B9D04" }, reason: "source-header-canonical-license-complete" },
    { ecosystem: "cargo", name: "missing-crate", version: "2.0.0", componentIds: ["developer-cargo"], declaredLicense: "", manifestLicense: "", manifestSource: "", status: "missing", integrity: "unavailable", hostApplicability: "excluded", applicabilityReason: "cargo-metadata-windows-x64-excluded", files: [], reason: "local-manifest-missing" },
  ],
};

beforeAll(async () => { await Promise.all(locales.map(loadLocalePack)); });

describe("LicenseEvidenceCenter", () => {
  it("does not scan until the user explicitly requests local collection", () => {
    const onCollect = vi.fn().mockResolvedValue(undefined);
    render(<LicenseEvidenceCenter locale="en" busy={false} error="" isDesktop report={undefined} onCollect={onCollect} />);
    expect(screen.getByText("Local evidence has not been collected")).toBeInTheDocument();
    expect(onCollect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Collect local evidence" }));
    expect(onCollect).toHaveBeenCalledTimes(1);
  });

  it("shows hashed evidence without absolute paths and filters by state", () => {
    render(<LicenseEvidenceCenter locale="en" busy={false} error="" isDesktop report={report} onCollect={vi.fn()} />);
    expect(screen.getByText("lib.rs")).toBeInTheDocument();
    expect(screen.getByText(/SHA-256: BBBBBBBBBBBBBBBB/)).toBeInTheDocument();
    expect(screen.getByText("Canonical license supplement")).toBeInTheDocument();
    expect(screen.getByText(/embedded\/MPL-2\.0\.txt/)).toBeInTheDocument();
    expect(screen.getByText(/paired with the bundled canonical license text/)).toBeInTheDocument();
    expect(screen.queryByText(/C:\\/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("All evidence states"), { target: { value: "missing" } });
    expect(screen.getByText("missing-crate")).toBeInTheDocument();
    expect(screen.queryByText("complete-crate")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 packages")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("All applicability"), { target: { value: "applicable" } });
    expect(screen.queryByText("missing-crate")).not.toBeInTheDocument();
  });

  it("provides a complete catalog for all nine languages", () => {
    expect(locales).toHaveLength(9);
    const keys = Object.keys(evidenceLabels.en).sort();
    for (const locale of locales) {
      expect(Object.keys(evidenceLabels[locale]).sort()).toEqual(keys);
      expect(Object.values(evidenceLabels[locale]).every((value) => value.trim().length > 0)).toBe(true);
      expect(Object.values(cargoApplicabilityLabels[locale]).every((value) => value.trim().length > 0)).toBe(true);
      if (locale !== "en") expect(evidenceLabels[locale].title).not.toBe(evidenceLabels.en.title);
      if (locale !== "en") expect(cargoApplicabilityLabels[locale].applicable).not.toBe(cargoApplicabilityLabels.en.applicable);
    }
  });
});
