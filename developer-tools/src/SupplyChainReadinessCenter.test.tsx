import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { locales } from "./locale";
import { SupplyChainReadinessCenter } from "./SupplyChainReadinessCenter";
import { buildSupplyChainReadiness } from "./supplyChainReadiness";
import { supplyChainReadinessText } from "./supplyChainReadinessLocale";
import type { AdvisoryScanResult, DependencyInventory, DeveloperCheck, LicenseReviewState } from "./types";

const digest = "A".repeat(64);
const inventory: DependencyInventory = {
  generatedFromLockfiles: true,
  lockfiles: [],
  totals: { lockfiles: 4, packages: 120, direct: 20, development: 30, unknownLicense: 2, reciprocalLicense: 3, insecureSource: 0, missingIntegrity: 0 },
  packages: [],
  reviewPackages: [],
  advisoryPreview: { endpoint: "https://api.osv.dev/v1/querybatch", totalPackages: 120, eligiblePackages: 118, uniquePackages: 100, duplicatePackages: 18, npmPackages: 60, cargoPackages: 40, requestDigest: digest, transmittedFields: ["ecosystem", "name", "version"], includesPaths: false, includesSources: false, includesLicenses: false },
  advisoryScan: { checked: false, mode: "offline", reason: "network-consent-required" },
};
const review: LicenseReviewState = { inventoryDigest: digest, items: [], records: [], expiredRecords: [], summary: { total: 5, pending: 2, approved: 1, restricted: 1, blocked: 1, expired: 0, stale: 0 } };
const checks: DeveloperCheck[] = [
  { id: "dependencyLockfiles", status: "pass", detail: "", technicalDetail: "" },
  { id: "dependencyIntegrity", status: "pass", detail: "", technicalDetail: "" },
  { id: "dependencyLicenseEvidence", status: "warning", detail: "", technicalDetail: "" },
  { id: "dependencyLicenseMetadata", status: "warning", detail: "", technicalDetail: "" },
  { id: "dependencyReciprocalLicenses", status: "fail", detail: "", technicalDetail: "" },
  { id: "dependencyAdvisories", status: "warning", detail: "", technicalDetail: "" },
];

describe("SupplyChainReadinessCenter", () => {
  it("summarizes exact blockers and links each review stage", () => {
    render(<SupplyChainReadinessCenter inventory={inventory} checks={checks} review={review} locale="en" />);
    expect(screen.getByRole("heading", { name: "License & Vulnerability Review" })).toBeInTheDocument();
    expect(screen.getByText(/Release blocked/)).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Review/ })).toHaveLength(4);
    expect(screen.getByRole("link", { name: /Collect license evidence/ })).toHaveAttribute("href", "#license-evidence-title");
    expect(screen.getByText(/never contacted automatically/)).toBeInTheDocument();
  });

  it("becomes ready only when all current supply-chain gates pass", () => {
    const advisory: AdvisoryScanResult = { scannedAt: "2026-09-01T00:00:00.000Z", endpoint: inventory.advisoryPreview.endpoint, requestDigest: digest, queriedPackages: 100, affectedPackages: 0, vulnerabilityCount: 0, complete: true, findings: [] };
    const ready = buildSupplyChainReadiness(inventory, checks.map((check) => ({ ...check, status: "pass" as const })), review, undefined, advisory);
    expect(ready).toMatchObject({ status: "pass", blockers: 0, warnings: 0, advisoryCurrent: true });
    expect(ready.stages.every((stage) => stage.status === "pass")).toBe(true);
  });

  it("provides complete non-empty copy in all nine locales", () => {
    const english = supplyChainReadinessText("en");
    for (const locale of locales) {
      const localized = supplyChainReadinessText(locale);
      expect(Object.keys(localized).sort()).toEqual(Object.keys(english).sort());
      expect(Object.values(localized.stageTitles).every((value) => value.trim().length > 0)).toBe(true);
      expect(Object.values(localized.stageDetails).every((value) => value.trim().length > 0)).toBe(true);
      expect(Object.values(localized.primaryLabels).every((value) => value.trim().length > 0)).toBe(true);
      expect(Object.values(localized.secondaryLabels).every((value) => value.trim().length > 0)).toBe(true);
      expect(Object.values(localized.status).every((value) => value.trim().length > 0)).toBe(true);
    }
  });
});
