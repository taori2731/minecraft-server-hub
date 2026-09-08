import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "./locale";
import { developerBackend } from "./developerBackend";
import { SupplyChainDiffCenter } from "./SupplyChainDiffCenter";
import { supplyChainDiffText } from "./supplyChainDiffLocale";
import type { DependencyInventory } from "./types";

const digest = "A".repeat(64);
const inventory: DependencyInventory = {
  generatedFromLockfiles: true, lockfiles: [], totals: { lockfiles: 1, packages: 1, direct: 1, development: 0, unknownLicense: 0, reciprocalLicense: 0, insecureSource: 0, missingIntegrity: 0 },
  packages: [{ componentId: "app-npm", ecosystem: "npm", name: "react", version: "19.2.8", direct: true, development: false, license: "MIT", licenseClass: "permissive", source: "registry", integrity: "sha512-value", integrityPresent: true, reason: "", hostApplicability: "applicable", applicabilityReason: "runtime" }], reviewPackages: [],
  advisoryPreview: { endpoint: "https://api.osv.dev/v1/querybatch", totalPackages: 1, eligiblePackages: 1, uniquePackages: 1, duplicatePackages: 0, npmPackages: 1, cargoPackages: 0, requestDigest: digest, transmittedFields: ["ecosystem", "name", "version"], includesPaths: false, includesSources: false, includesLicenses: false }, advisoryScan: { checked: false, mode: "offline", reason: "network-consent-required" },
};

describe("SupplyChainDiffCenter", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("requires an explicit baseline and then renders a deterministic comparison", () => {
    render(<SupplyChainDiffCenter inventory={inventory} locale="en" />);
    expect(screen.getByText("No baseline is available for comparison.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save current baseline" }));
    expect(screen.getByRole("status")).toHaveTextContent("Baseline saved.");
    expect(screen.getByRole("combobox", { name: "Baseline" })).toBeInTheDocument();
    expect(screen.getByText("No changes in the selected category.")).toBeInTheDocument();
  });

  it("exports a recognized privacy-safe JSON document", async () => {
    const exportReport = vi.spyOn(developerBackend, "exportSupplyChainReport").mockResolvedValue("C:\\exports\\diff.json");
    render(<SupplyChainDiffCenter inventory={inventory} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Save current baseline" }));
    fireEvent.click(screen.getByRole("button", { name: "Export diff JSON" }));
    await waitFor(() => expect(exportReport).toHaveBeenCalledOnce());
    const [, , content] = exportReport.mock.calls[0];
    expect(content).toContain("minecraft-server-hub-supply-chain-diff");
    expect(content).not.toContain("sha512-value");
    expect(screen.getByRole("status")).toHaveTextContent("C:\\exports\\diff.json");
  });

  it("provides complete localized copy in all nine languages", () => {
    const english = supplyChainDiffText("en");
    for (const locale of locales) {
      const localized = supplyChainDiffText(locale);
      expect(Object.keys(localized).sort()).toEqual(Object.keys(english).sort());
      expect(Object.values(localized.categories).every((value) => value.trim().length > 0)).toBe(true);
      expect(Object.keys(localized.reasons).sort()).toEqual(Object.keys(english.reasons).sort());
      if (locale !== "en") expect(localized.title).not.toBe(english.title);
    }
  });
});
