import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { loadLocalePack, locales } from "./locale";
import { SupplyChainControls } from "./SupplyChainControls";
import { windowsEvidenceText } from "./windowsEvidenceLocale";
import { licenseAuditText } from "./licenseAuditLocale";

afterEach(cleanup);
beforeAll(async () => { await Promise.all(locales.map(loadLocalePack)); });

describe("Windows x64 evidence export localization", () => {
  it("provides complete, distinct copy for all nine locales", () => {
    const translations = locales.map((locale) => windowsEvidenceText(locale));
    expect(translations).toHaveLength(9);
    for (const translation of translations) {
      expect(translation.exportButton.trim().length).toBeGreaterThan(8);
      expect(translation.ready.trim().length).toBeGreaterThan(30);
      expect(translation.unavailable.trim().length).toBeGreaterThan(20);
    }
    expect(new Set(translations.map((translation) => translation.exportButton)).size).toBe(9);
  });

  it("keeps the audit export disabled until current local evidence exists", () => {
    const onExport = vi.fn(async () => undefined);
    const copy = windowsEvidenceText("en");
    const auditCopy = licenseAuditText("en");
    const common = { locale: "en" as const, policy: { unknown: "warn" as const, reciprocal: "warn" as const, vulnerabilities: "block" as const }, onPolicyChange: vi.fn(), onExport, exporting: false, message: "", isDesktop: true, onVerify: vi.fn(async () => undefined), verificationBusy: false, verificationMessage: "" };
    const { rerender } = render(<SupplyChainControls {...common} evidenceReady={false} />);
    expect(screen.getByRole("button", { name: copy.exportButton })).toBeDisabled();
    expect(screen.getByRole("button", { name: auditCopy.notices })).toBeDisabled();
    expect(screen.getByText(auditCopy.noticesUnavailable)).toBeVisible();

    rerender(<SupplyChainControls {...common} evidenceReady />);
    expect(screen.getByRole("button", { name: copy.exportButton })).toBeEnabled();
    expect(screen.getByRole("button", { name: auditCopy.notices })).toBeEnabled();
    expect(screen.getByText(auditCopy.noticesReady)).toBeVisible();
  });

  it("provides notice and verification copy for all nine locales", () => {
    const translations = locales.map(licenseAuditText);
    expect(translations).toHaveLength(9);
    for (const translation of translations) {
      expect(translation.notices.trim().length).toBeGreaterThan(5);
      expect(translation.verify.trim().length).toBeGreaterThan(5);
      expect(translation.verified).toContain("{sha}");
      expect(translation.verified).toContain("{applicable}");
    }
    expect(new Set(translations.map((translation) => translation.notices)).size).toBe(9);
  });
});
