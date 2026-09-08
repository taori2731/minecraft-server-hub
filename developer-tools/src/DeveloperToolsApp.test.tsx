import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalePack, loadLocalePack, locales } from "./locale";
import { DeveloperToolsApp } from "./DeveloperToolsApp";
import { bundleText } from "./bundleLocale";
import { qualityLabels } from "./qualityLocale";
import type { DeveloperInspectionReport } from "./types";

const report: DeveloperInspectionReport = {
  schemaVersion: 6, inspectedAt: "2026-08-31T12:00:00Z", workspaceRoot: "C:/workspace", readOnly: true, expectedVersion: "0.3.2",
  versionSources: [{ id: "package", path: "package.json", value: "0.3.2" }, { id: "cargo", path: "src-tauri/Cargo.toml", value: "0.3.1" }],
  release: { artifactVersion: "0.3.2", artifactDirectory: "artifacts/updates/0.3.2", manifestPath: "artifacts/updates/0.3.2/latest.json", installerPath: "artifact.exe", signaturePath: "artifact.exe.sig", installerSizeBytes: 1024, installerSha256: "A".repeat(64), manifestVersion: "0.3.2", downloadUrl: "https://example.com/artifact.exe", publishedAt: "2026-08-31T10:00:00Z" },
  releaseHistory: [{ version: "0.3.2", manifestPath: "artifacts/updates/0.3.2/latest.json", installerPath: "artifact.exe", installerSizeBytes: 2048, installerSha256: "A".repeat(64), downloadUrl: "https://example.com/artifact.exe", publishedAt: "2026-08-31T10:00:00Z", signatureValid: true, integrityError: "" }, { version: "0.3.1", manifestPath: "artifacts/updates/0.3.1/latest.json", installerPath: "old.exe", installerSizeBytes: 1024, installerSha256: "B".repeat(64), downloadUrl: "https://example.com/old.exe", publishedAt: "2026-08-30T10:00:00Z", signatureValid: true, integrityError: "" }],
  dependencyInventory: {
    generatedFromLockfiles: true,
    lockfiles: [{ id: "app-npm", ecosystem: "npm", manifestPath: "package.json", lockfilePath: "package-lock.json", present: true, packageCount: 2, directCount: 1, developmentCount: 0, unknownLicenseCount: 1, reciprocalLicenseCount: 0, insecureSourceCount: 0, missingIntegrityCount: 0, licenses: [{ name: "MIT", count: 1 }, { name: "Unknown", count: 1 }] }],
    totals: { lockfiles: 1, packages: 2, direct: 1, development: 0, unknownLicense: 1, reciprocalLicense: 0, insecureSource: 0, missingIntegrity: 0 },
    packages: [{ componentId: "app-npm", ecosystem: "npm", name: "example", version: "1.0.0", direct: true, development: false, license: "MIT", licenseClass: "permissive", source: "https://example.com/example.tgz", integrity: "sha512-Zml4dHVyZQ==", integrityPresent: true, reason: "", hostApplicability: "applicable", applicabilityReason: "npm-no-platform-restriction" }, { componentId: "website-npm", ecosystem: "npm", name: "unknown-package", version: "2.0.0", direct: false, development: false, license: "", licenseClass: "unknown", source: "https://example.com/unknown.tgz", integrity: "sha512-Zml4dHVyZQ==", integrityPresent: true, reason: "unknown-license", hostApplicability: "applicable", applicabilityReason: "npm-no-platform-restriction" }],
    reviewPackages: [{ componentId: "website-npm", ecosystem: "npm", name: "unknown-package", version: "2.0.0", direct: false, development: false, license: "", licenseClass: "unknown", source: "https://example.com/unknown.tgz", integrity: "sha512-Zml4dHVyZQ==", integrityPresent: true, reason: "unknown-license", hostApplicability: "applicable", applicabilityReason: "npm-no-platform-restriction" }],
    advisoryPreview: { endpoint: "https://api.osv.dev/v1/querybatch", totalPackages: 2, eligiblePackages: 2, uniquePackages: 2, duplicatePackages: 0, npmPackages: 2, cargoPackages: 0, requestDigest: "A".repeat(64), transmittedFields: ["ecosystem", "name", "version"], includesPaths: false, includesSources: false, includesLicenses: false },
    advisoryScan: { checked: false, mode: "offline", reason: "network-consent-required" },
  },
  bundleAnalysis: { status: "current", reportPath: "dist/bundle-report.json", generatedAt: "2026-08-31T12:00:00Z", sourceNewestAt: "2026-08-31T11:59:00Z", budgets: { entryJavaScriptBytes: 512000, chunkJavaScriptBytes: 512000, totalJavaScriptGzipBytes: 1228800, totalCssBytes: 256000 }, totals: { totalJavaScriptBytes: 400000, totalJavaScriptGzipBytes: 120000, totalCssBytes: 50000, chunks: 2, assets: 1 }, chunks: [{ fileName: "assets/index.js", name: "index", entry: true, dynamicEntry: false, rawBytes: 300000, gzipBytes: 90000, imports: [], dynamicImports: ["assets/lazy.js"], moduleCount: 2, largestModules: [{ id: "src/App.tsx", renderedBytes: 100000 }] }], assets: [{ fileName: "assets/index.css", rawBytes: 50000, gzipBytes: 10000 }], violations: [], error: "" },
  qualityEvidence: {
    status: "current", reportPath: "artifacts/developer-tools/quality-evidence.json", generatedAt: "2026-08-31T12:00:00Z", startedAt: "2026-08-31T11:58:00Z", completedAt: "2026-08-31T12:00:00Z", durationMs: 120000, sourceNewestAt: "2026-08-31T11:57:00Z", sourceDigest: "C".repeat(64), sourceStable: true,
    requiredStageIds: ["appTypecheck", "developerTypecheck", "unitCoverage", "developerNodeTests", "rustFormat", "rustTests", "uiSmoke"],
    summary: { totalStages: 7, passedStages: 7, failedStages: 0, totalTests: 192, passedTests: 191, failedTests: 0, skippedTests: 1 },
    coverage: { available: true, reportPath: "coverage/quality/coverage-summary.json", lines: { total: 1000, covered: 780, skipped: 0, pct: 78 }, statements: { total: 1100, covered: 825, skipped: 0, pct: 75 }, functions: { total: 200, covered: 132, skipped: 0, pct: 66 }, branches: { total: 400, covered: 232, skipped: 0, pct: 58 } },
    coverageThresholds: { lines: 70, statements: 70, functions: 60, branches: 55 }, coverageViolations: [],
    stages: [
      { id: "appTypecheck", kind: "typecheck", command: "npm run check", status: "pass", exitCode: 0, startedAt: "2026-08-31T11:58:00Z", completedAt: "2026-08-31T11:58:10Z", durationMs: 10000, tests: { total: 0, passed: 0, failed: 0, skipped: 0 }, outputTail: "" },
      { id: "developerTypecheck", kind: "typecheck", command: "npm run check:developer-tools", status: "pass", exitCode: 0, startedAt: "2026-08-31T11:58:10Z", completedAt: "2026-08-31T11:58:20Z", durationMs: 10000, tests: { total: 0, passed: 0, failed: 0, skipped: 0 }, outputTail: "" },
      { id: "unitCoverage", kind: "test", command: "npx vitest run --coverage.enabled=true", status: "pass", exitCode: 0, startedAt: "2026-08-31T11:58:20Z", completedAt: "2026-08-31T11:59:00Z", durationMs: 40000, tests: { total: 182, passed: 181, failed: 0, skipped: 1 }, outputTail: "" },
      { id: "developerNodeTests", kind: "test", command: "node --test scripts/developer-inspection.node.mjs", status: "pass", exitCode: 0, startedAt: "2026-08-31T11:59:00Z", completedAt: "2026-08-31T11:59:10Z", durationMs: 10000, tests: { total: 8, passed: 8, failed: 0, skipped: 0 }, outputTail: "" },
      { id: "rustFormat", kind: "format", command: "cargo fmt --all -- --check", status: "pass", exitCode: 0, startedAt: "2026-08-31T11:59:10Z", completedAt: "2026-08-31T11:59:20Z", durationMs: 10000, tests: { total: 0, passed: 0, failed: 0, skipped: 0 }, outputTail: "" },
      { id: "rustTests", kind: "test", command: "cargo test --locked", status: "pass", exitCode: 0, startedAt: "2026-08-31T11:59:20Z", completedAt: "2026-08-31T11:59:50Z", durationMs: 30000, tests: { total: 1, passed: 1, failed: 0, skipped: 0 }, outputTail: "" },
      { id: "uiSmoke", kind: "test", command: "node scripts/ui-smoke.mjs", status: "pass", exitCode: 0, startedAt: "2026-08-31T11:59:50Z", completedAt: "2026-08-31T12:00:00Z", durationMs: 10000, tests: { total: 1, passed: 1, failed: 0, skipped: 0 }, outputTail: "" },
    ], error: "",
  },
  capabilitySecurity: { status: "verified", capabilityPath: "developer-tools/src-tauri/capabilities/default.json", configurationPath: "developer-tools/src-tauri/tauri.conf.json", capabilityIdentifier: "main-capability", appIdentifier: "local.minecraft-server-hub.developer-tools", windows: ["main"], configuredWindows: ["main"], permissions: ["core:default", "dialog:allow-open", "dialog:allow-save"], allowedPermissions: ["core:default", "dialog:allow-open", "dialog:allow-save"], csp: "default-src 'self'", cspDirectives: [{ name: "default-src", values: ["'self'"] }], issues: [] },
  buildEnvironment: { status: "ready", hostOs: "win32", hostArch: "x64", expectedOs: "win32", expectedArch: "x64", rustTarget: "x86_64-pc-windows-msvc", rustTargetInstalled: true, installedRustTargets: ["x86_64-pc-windows-msvc"], tools: [{ id: "node", command: "node --version", available: true, version: "24.17.0", output: "v24.17.0", error: "" }, { id: "npm", command: "npm --version", available: true, version: "11.6.2", output: "11.6.2", error: "" }, { id: "rustc", command: "rustc --version", available: true, version: "1.98.0", output: "rustc 1.98.0", error: "" }, { id: "cargo", command: "cargo --version", available: true, version: "1.98.0", output: "cargo 1.98.0", error: "" }, { id: "rustup", command: "rustup --version", available: true, version: "1.29.0", output: "rustup 1.29.0", error: "" }], issues: [], error: "" },
  remoteFeed: { endpoint: "https://example.com/latest.json", checked: true, reachable: true, version: "0.3.2", downloadUrl: "https://example.com/artifact.exe", error: "" },
  checks: [{ id: "versionConsistency", status: "fail", detail: "package=0.3.2 · cargo=0.3.1", technicalDetail: "" }, { id: "sha256Calculated", status: "pass", detail: "A".repeat(64), technicalDetail: "" }, { id: "cryptographicSignature", status: "warning", detail: "not-run", technicalDetail: "" }],
  summary: { pass: 1, warning: 1, fail: 1 },
};

describe("DeveloperToolsApp", () => {
  beforeEach(async () => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    await Promise.all(locales.map(loadLocalePack));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("renders the read-only report and filters to release problems", async () => {
    localStorage.setItem("msh-developer-tools:locale", "en");
    render(<DeveloperToolsApp initialLocale="en" initialReport={report} deferPanels={false} />);
    expect(screen.getByRole("heading", { name: "Release readiness dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Blockers").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Embedded development snapshot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose workspace" })).toBeDisabled();
    expect(screen.getByText("Installer SHA-256 calculated")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Artifact history" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Release plan preview" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Release handoff pack" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText(/Release handoff is available only in the installed Windows Developer Tools app/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Performance budget & bundle center" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Test & quality evidence center" })).toBeInTheDocument();
    expect(screen.getByText("Current evidence")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evidence by stage" })).toBeInTheDocument();
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("Inspector Node tests")).toBeInTheDocument();
    expect(screen.getAllByText("assets/index.js")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save current as baseline" }));
    expect(screen.getByText("✓ Current build saved as the local baseline.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Dependency & license center" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OSV vulnerability lookup" })).toBeInTheDocument();
    expect(screen.getByText("ecosystem · name · version")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run OSV lookup" })).toBeDisabled();
    expect(screen.getAllByText("unknown-package")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "License evidence center" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collect local evidence" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "License review register" })).toBeInTheDocument();
    expect(screen.getByText("Phase D31")).toBeInTheDocument();
    expect(screen.getByText("Run full regression tests")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Problems only" }));
    expect(screen.queryByText("Installer SHA-256 calculated")).not.toBeInTheDocument();
    expect(screen.getByText("All version sources match")).toBeInTheDocument();
    expect(screen.getByText("Cryptographic signature verification")).toBeInTheDocument();
  }, 30_000);

  it("records a refreshed inspection and explains a resolved blocker", async () => {
    localStorage.setItem("msh-developer-tools:locale", "en");
    const refreshed: DeveloperInspectionReport = {
      ...report,
      inspectedAt: "2026-08-31T12:05:00Z",
      versionSources: report.versionSources.map((source) => ({ ...source, value: "0.3.2" })),
      checks: report.checks.map((check) => check.id === "versionConsistency" ? { ...check, status: "pass" as const } : check),
      summary: { pass: 2, warning: 1, fail: 0 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => refreshed }));
    render(<DeveloperToolsApp initialLocale="en" initialReport={report} deferPanels={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh inspection" }));

    expect(await screen.findByText(/Resolved · Blocker → Pass/)).toBeInTheDocument();
    expect(screen.getByText("2 / 1 / 0")).toBeInTheDocument();
    expect(localStorage.getItem("msh-developer-tools:history:v1")).toContain("2026-08-31T12:05:00Z");
  });

  it("switches the entire dashboard between Japanese and English", async () => {
    localStorage.setItem("msh-developer-tools:locale", "ja");
    render(<DeveloperToolsApp initialLocale="ja" initialReport={report} deferPanels={false} />);
    expect(screen.getByRole("heading", { name: "リリース準備状況ダッシュボード" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("言語"), { target: { value: "en" } });
    expect(await screen.findByRole("heading", { name: "Release readiness dashboard" }, { timeout: 10_000 })).toBeInTheDocument();
  });

  it("keeps the current language on failure and retries the requested language", async () => {
    const loadLanguagePack = vi.fn()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockImplementation(loadLocalePack);
    render(<DeveloperToolsApp initialLocale="en" initialReport={report} deferPanels={false} loadLanguagePack={loadLanguagePack} />);
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "fr" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("The language could not be loaded");
    expect(screen.getByRole("heading", { name: "Release readiness dashboard" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: getLocalePack("fr").catalog.title }, { timeout: 10_000 })).toBeInTheDocument();
    expect(loadLanguagePack).toHaveBeenNthCalledWith(1, "fr");
    expect(loadLanguagePack).toHaveBeenNthCalledWith(2, "fr");
  });

  it("ignores a stale language response when a newer request finishes first", async () => {
    const releases = new Map<string, () => void>();
    const loadLanguagePack = vi.fn((next: typeof locales[number]) => new Promise<void>((resolve) => releases.set(next, resolve)).then(() => loadLocalePack(next)));
    render(<DeveloperToolsApp initialLocale="en" initialReport={report} deferPanels={false} loadLanguagePack={loadLanguagePack} />);
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "fr" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "de" } });
    releases.get("de")?.();
    expect(await screen.findByRole("heading", { name: getLocalePack("de").catalog.title }, { timeout: 10_000 })).toBeInTheDocument();
    releases.get("fr")?.();
    await waitFor(() => expect(screen.getByRole("heading", { name: getLocalePack("de").catalog.title })).toBeInTheDocument());
  });

  it("contains every catalog key in all nine languages", async () => {
    await Promise.all(locales.map(loadLocalePack));
    const english = getLocalePack("en");
    const englishKeys = Object.keys(english.catalog).sort();
    expect(locales).toHaveLength(9);
    for (const locale of locales) {
      const catalog = getLocalePack(locale).catalog;
      expect(Object.keys(catalog).sort()).toEqual(englishKeys);
      expect(Object.values(catalog).every((value) => value.trim().length > 0)).toBe(true);
      expect(catalog.disabledIntro).not.toContain("D4");
      expect(Object.values(bundleText(locale)).every((value) => value.trim().length > 0)).toBe(true);
      expect(Object.values(qualityLabels[locale]).filter((value) => typeof value === "string").every((value) => value.trim().length > 0)).toBe(true);
      expect(Object.values(qualityLabels[locale].stageNames).every((value) => value.trim().length > 0)).toBe(true);
      if (locale !== "en") {
        expect(catalog.dependencyCenter).not.toBe(english.catalog.dependencyCenter);
        expect(catalog.advisoryCenter).not.toBe(english.catalog.advisoryCenter);
        expect(catalog.detail_verified).not.toBe(english.catalog.detail_verified);
        expect(bundleText(locale).title).not.toBe(bundleText("en").title);
        expect(qualityLabels[locale].title).not.toBe(qualityLabels.en.title);
      }
    }
  });

  it("stores only the minimal quality trend summary", () => {
    localStorage.setItem("msh-developer-tools:locale", "en");
    render(<DeveloperToolsApp initialLocale="en" initialReport={report} deferPanels={false} />);
    const stored = localStorage.getItem("msh-developer-tools:quality-history:v1") ?? "";
    expect(stored).toContain(report.qualityEvidence.sourceDigest);
    expect(stored).not.toContain(report.qualityEvidence.reportPath);
    expect(stored).not.toContain(report.qualityEvidence.stages[0].command);
    expect(stored).not.toContain("outputTail");
  });

  it("activates a deferred center before navigating to it", async () => {
    class ObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "800px 0px";
      thresholds = [0];
    }
    vi.stubGlobal("IntersectionObserver", ObserverMock);
    render(<DeveloperToolsApp initialLocale="en" initialReport={report} />);

    expect(screen.queryByRole("heading", { name: "Release handoff pack" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Handoff" }));

    expect(await screen.findByRole("heading", { name: "Release handoff pack" }, { timeout: 10_000 })).toBeInTheDocument();
    const host = document.getElementById("release-handoff-center");
    expect(host).toHaveAttribute("data-deferred-active", "true");
    await waitFor(() => expect(document.activeElement).toBe(host));
    expect(window.location.hash).toBe("#release-handoff-center");
    expect(screen.getByRole("button", { name: "Handoff" })).toHaveAttribute("aria-current", "location");
  });

  it("honors a valid center hash on first load without activating unrelated centers", async () => {
    class ObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "800px 0px";
      thresholds = [0];
    }
    vi.stubGlobal("IntersectionObserver", ObserverMock);
    window.history.replaceState(null, "", "/#quality-evidence-center");
    render(<DeveloperToolsApp initialLocale="en" initialReport={report} />);

    expect(await screen.findByRole("heading", { name: "Test & quality evidence center" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(document.getElementById("quality-evidence-center")).toHaveAttribute("data-deferred-active", "true");
    expect(document.getElementById("dependency-center")).toHaveAttribute("data-deferred-active", "false");
    expect(screen.getByRole("button", { name: "Quality" })).toHaveAttribute("aria-current", "location");
  });

  it("follows a valid hash changed after the app has loaded", async () => {
    class ObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "800px 0px";
      thresholds = [0];
    }
    vi.stubGlobal("IntersectionObserver", ObserverMock);
    render(<DeveloperToolsApp initialLocale="en" initialReport={report} />);

    window.history.replaceState(null, "", "/#quality-evidence-center");
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(await screen.findByRole("heading", { name: "Test & quality evidence center" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quality" })).toHaveAttribute("aria-current", "location");
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("quality-evidence-center")));
  });

  it("opens the D25 command palette from the keyboard and runs safe commands", async () => {
    class ObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "800px 0px";
      thresholds = [0];
    }
    vi.stubGlobal("IntersectionObserver", ObserverMock);
    render(<DeveloperToolsApp initialLocale="en" initialReport={report} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const search = screen.getByRole("searchbox", { name: "Search commands" });
    await waitFor(() => expect(search).toHaveFocus());
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.change(search, { target: { value: "handoff" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(await screen.findByRole("heading", { name: "Release handoff pack" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(window.location.hash).toBe("#release-handoff-center");
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("release-handoff-center")));

    fireEvent.click(screen.getByRole("button", { name: /Commands/ }));
    const problemSearch = await screen.findByRole("searchbox", { name: "Search commands" });
    fireEvent.change(problemSearch, { target: { value: "problems" } });
    fireEvent.click(screen.getByRole("button", { name: /Show problems only/ }));
    expect(window.location.hash).toBe("#release-gates");
    expect(screen.queryByText("Installer SHA-256 calculated")).not.toBeInTheDocument();
    expect(screen.getByText("Cryptographic signature verification")).toBeInTheDocument();
  });

  it("restores focus to the command button after Escape", async () => {
    render(<DeveloperToolsApp initialLocale="en" initialReport={report} />);
    const commandButton = screen.getByRole("button", { name: /Commands/ });

    fireEvent.click(commandButton);
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search commands" }), { key: "Escape" });

    await waitFor(() => expect(commandButton).toHaveFocus());
  });
});
