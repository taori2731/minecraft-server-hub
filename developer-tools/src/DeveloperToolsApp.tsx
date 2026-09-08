import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeferredPanelFallback, DeferredSection } from "./DeferredSection";
import { deferredText } from "./deferredLocale";
import { commandPaletteText } from "./commandPaletteLocale";
import { capabilitySecurityText } from "./capabilitySecurityLocale";
import { buildEnvironmentText } from "./buildEnvironmentLocale";
import { developerBackend } from "./developerBackend";
import { readDeveloperUpdatePreferences } from "./developerUpdate";
import { developerUpdateText } from "./developerUpdateLocale";
import { evidenceText } from "./evidenceLocale";
import { licenseAuditText } from "./licenseAuditLocale";
import { isOperationSectionId, OperationsNavigator, type OperationSectionId } from "./OperationsNavigator";
import { operationsNavigatorText } from "./operationsNavigatorLocale";
import { releaseEvidenceText } from "./releaseEvidenceLocale";
import { languageOptions, loadLocalePack, localeLoaderMessages, text, type Catalog, type Locale, type LocalePack } from "./locale";
import { recordQualityHistory } from "./qualityHistory";
import { applySupplyChainGates, buildLicenseReviewState, clearLegacyLicenseReviewRecords, createLicenseReviewExport, createSupplyChainExport, persistLicenseReviewRecords, readAdvisoryCache, readLicensePolicy, readLicenseReviewRecords, removeLicenseReviewRecord, saveAdvisoryCache, saveLicensePolicy, summarizeChecks, upsertLicenseReviewRecord, type SupplyChainExportFormat } from "./supplyChain";
import type { AdvisoryScanResult, CheckStatus, DeveloperInspectionReport, DeveloperUpdateInfo, InspectionChange, InspectionHistoryEntry, LicenseEvidenceReport, LicenseLedgerBackupPreview, LicenseLedgerExportReceipt, LicenseLedgerRecoveryEntry, LicenseLedgerRecoveryList, LicenseLedgerSnapshot, LicensePolicy, LicenseReviewDraft, LicenseReviewItem, LicenseReviewRecord } from "./types";

const QualityEvidenceCenter = lazy(() => import("./QualityEvidenceCenter").then((module) => ({ default: module.QualityEvidenceCenter })));
const DeveloperUpdateCenter = lazy(() => import("./DeveloperUpdateCenter").then((module) => ({ default: module.DeveloperUpdateCenter })));
const BundlePerformanceCenter = lazy(() => import("./BundlePerformanceCenter").then((module) => ({ default: module.BundlePerformanceCenter })));
const DependencyCenter = lazy(() => import("./DependencyCenter").then((module) => ({ default: module.DependencyCenter })));
const ReleaseEvidenceCenter = lazy(() => import("./ReleaseEvidenceCenter").then((module) => ({ default: module.ReleaseEvidenceCenter })));
const ReleaseApprovalCenter = lazy(() => import("./ReleaseApprovalCenter").then((module) => ({ default: module.ReleaseApprovalCenter })));
const ReleaseHandoffCenter = lazy(() => import("./ReleaseHandoffCenter").then((module) => ({ default: module.ReleaseHandoffCenter })));
const CommandPalette = lazy(() => import("./CommandPalette").then((module) => ({ default: module.CommandPalette })));
const CapabilitySecurityCenter = lazy(() => import("./CapabilitySecurityCenter").then((module) => ({ default: module.CapabilitySecurityCenter })));
const BuildEnvironmentCenter = lazy(() => import("./BuildEnvironmentCenter").then((module) => ({ default: module.BuildEnvironmentCenter })));

const statusOrder: CheckStatus[] = ["fail", "warning", "pass"];
const statusSymbol: Record<CheckStatus, string> = { pass: "✓", warning: "!", fail: "×" };
const HISTORY_KEY = "msh-developer-tools:history:v1";
const WORKSPACE_KEY = "msh-developer-tools:workspace:v1";
const formatBytes = (bytes: number, locale: Locale) => bytes > 0
  ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MiB`
  : "—";
const formatSizeDelta = (bytes: number, locale: Locale) => {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return bytes < 1024 * 1024
    ? `${formatter.format(bytes / 1024)} KiB`
    : `${formatter.format(bytes / 1024 / 1024)} MiB`;
};
const planCommands: Record<string, string> = {
  test: "npm run check && npm test && npm run test:ui",
  build: "npm run tauri build",
};

function initialOperationSection(): OperationSectionId {
  if (typeof window === "undefined") return "developer-overview";
  const candidate = window.location.hash.replace(/^#/, "");
  return isOperationSectionId(candidate) ? candidate : "developer-overview";
}

function translatedCheck(locale: Locale, id: string) {
  if (id === "dependencyLicenseEvidence") return evidenceText(locale).title;
  if (id === "developerCapabilityPolicy") return capabilitySecurityText(locale).title;
  if (id === "developerBuildEnvironment") return buildEnvironmentText(locale).title;
  const key = `check_${id}` as keyof Catalog;
  const translated = text(locale, key);
  return translated === key ? id : translated;
}

function statusLabel(locale: Locale, status: CheckStatus) {
  return text(locale, status === "pass" ? "statusPass" : status === "warning" ? "statusWarning" : "statusFail");
}

function translatedDetail(locale: Locale, detail: string) {
  const evidenceLabels = evidenceText(locale);
  if (detail === "license-evidence:not-run") return evidenceLabels.gateNotRun;
  const evidenceComplete = detail.match(/^license-evidence:complete:(\d+):(\d+):(\d+):(\d+):(\d+)$/);
  if (evidenceComplete) return evidenceLabels.gateComplete.replace("{total}", evidenceComplete[1]).replace("{complete}", evidenceComplete[2]).replace("{files}", evidenceComplete[3]).replace("{verified}", evidenceComplete[4]).replace("{excluded}", evidenceComplete[5]);
  const evidenceCoverage = detail.match(/^license-evidence:coverage:(\d+):(\d+):(\d+):(\d+):(\d+):(\d+):(\d+)$/);
  if (evidenceCoverage) return evidenceLabels.gateCoverage.replace("{complete}", evidenceCoverage[1]).replace("{partial}", evidenceCoverage[2]).replace("{missing}", evidenceCoverage[3]).replace("{mismatch}", evidenceCoverage[4]).replace("{actionable}", evidenceCoverage[5]).replace("{unknown}", evidenceCoverage[6]).replace("{excluded}", evidenceCoverage[7]);
  if (detail === "not-run") return text(locale, "detail_notRun");
  if (detail === "verified") return text(locale, "detail_verified");
  if (detail === "verification-failed") return text(locale, "detail_verificationFailed");
  const capabilityPolicy = detail.match(/^(verified|violation|missing|invalid) · (\d+) permissions · (\d+) CSP directives$/);
  if (capabilityPolicy) {
    const labels = capabilitySecurityText(locale);
    return `${labels[capabilityPolicy[1] as "verified" | "violation" | "missing" | "invalid"]} · ${capabilityPolicy[2]} ${labels.permissions} · ${capabilityPolicy[3]} ${labels.directives}`;
  }
  const buildEnvironment = detail.match(/^(ready|incomplete|unsupported) · (\d+)\/(\d+) tools · ([^/]+)\/(.+)$/);
  if (buildEnvironment) {
    const labels = buildEnvironmentText(locale);
    return `${labels[buildEnvironment[1] as "ready" | "incomplete" | "unsupported"]} · ${buildEnvironment[2]}/${buildEnvironment[3]} ${labels.tools} · ${buildEnvironment[4]}/${buildEnvironment[5]}`;
  }
  const releaseCount = detail.match(/^(\d+) releases$/);
  if (releaseCount) return text(locale, "releaseCount").replace("{count}", releaseCount[1]);
  const lockfileCount = detail.match(/^(\d+)\/(\d+) lockfiles$/);
  if (lockfileCount) return `${lockfileCount[1]}/${lockfileCount[2]} ${text(locale, "lockfiles")}`;
  const packageIntegrity = detail.match(/^(\d+) packages · (\d+) missing integrity · (\d+) insecure sources$/);
  if (packageIntegrity) return `${packageIntegrity[1]} ${text(locale, "packages")} · ${packageIntegrity[2]} ${text(locale, "reason_missingIntegrity")} · ${packageIntegrity[3]} ${text(locale, "reason_insecureSource")}`;
  const unknownLicenses = detail.match(/^(\d+) unknown licenses$/);
  if (unknownLicenses) return `${unknownLicenses[1]} ${text(locale, "unknownLicenses")}`;
  const reciprocalLicenses = detail.match(/^(\d+) reciprocal licenses$/);
  if (reciprocalLicenses) return `${reciprocalLicenses[1]} ${text(locale, "reciprocalLicenses")}`;
  const licenseReview = detail.match(/^license-review:(unknown|reciprocal):(\d+):(\d+):(\d+):(\d+):(\d+)$/);
  if (licenseReview) {
    const label = licenseReview[1] === "unknown" ? text(locale, "unknownLicenses") : text(locale, "reciprocalLicenses");
    return `${label} · ${licenseReview[2]} · ${text(locale, "packagesForReview")}: ${licenseReview[3]} · ✓ ${licenseReview[4]} · ! ${licenseReview[5]} · × ${licenseReview[6]}`;
  }
  const cleanScan = detail.match(/^scan-clean:(\d+)$/);
  if (cleanScan) return `${text(locale, "scanComplete")} · ${cleanScan[1]} ${text(locale, "packages")} · ${text(locale, "noKnownVulnerabilities")}`;
  const findings = detail.match(/^scan-findings:(\d+):(\d+)$/);
  if (findings) return `${findings[1]} ${text(locale, "vulnerabilities")} · ${findings[2]} ${text(locale, "affectedPackages")}`;
  if (detail === "scan-incomplete") return text(locale, "scanIncomplete");
  if (detail === "offline-not-run") return text(locale, "offlineAdvisoryTitle");
  return detail || "—";
}

function SummaryCard({ label, value, tone }: { label: string; value: string | number; tone?: CheckStatus }) {
  return <article className={`summary-card${tone ? ` ${tone}` : ""}`}><span>{label}</span><strong>{value === "" ? "—" : value}</strong></article>;
}

function readHistory(): InspectionHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch { return []; }
}

function historyEntry(report: DeveloperInspectionReport): InspectionHistoryEntry {
  return {
    inspectedAt: report.inspectedAt,
    expectedVersion: report.expectedVersion,
    artifactVersion: report.release.artifactVersion,
    pass: report.summary.pass,
    warning: report.summary.warning,
    fail: report.summary.fail,
    statuses: Object.fromEntries(report.checks.map((check) => [check.id, check.status])),
  };
}

function compareReports(previous: DeveloperInspectionReport, next: DeveloperInspectionReport): InspectionChange[] {
  const previousStatuses = new Map(previous.checks.map((check) => [check.id, check.status]));
  return next.checks.flatMap((check) => previousStatuses.get(check.id) === check.status ? [] : [{ id: check.id, before: previousStatuses.get(check.id), after: check.status }]);
}

export function DeveloperToolsApp({ initialLocale, initialReport, deferPanels = true, loadLanguagePack = loadLocalePack }: { initialLocale: Locale; initialReport: DeveloperInspectionReport; deferPanels?: boolean; loadLanguagePack?: (locale: Locale) => Promise<LocalePack> }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [pendingLocale, setPendingLocale] = useState<Locale>(initialLocale);
  const [localeLoading, setLocaleLoading] = useState(false);
  const [localeError, setLocaleError] = useState(false);
  const [failedLocale, setFailedLocale] = useState<Locale>();
  const localeRequest = useRef(0);
  const [report, setReport] = useState(initialReport);
  const [filter, setFilter] = useState<"all" | "problems">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState(initialReport.workspaceRoot);
  const [history, setHistory] = useState<InspectionHistoryEntry[]>(readHistory);
  const [changes, setChanges] = useState<InspectionChange[]>([]);
  const [policy, setPolicy] = useState<LicensePolicy>(readLicensePolicy);
  const [licenseReviewRecords, setLicenseReviewRecords] = useState<LicenseReviewRecord[]>(() => developerBackend.isDesktop ? [] : readLicenseReviewRecords(initialReport.dependencyInventory.advisoryPreview.requestDigest));
  const [licenseLedger, setLicenseLedger] = useState<LicenseLedgerSnapshot | undefined>();
  const [licenseLedgerBusy, setLicenseLedgerBusy] = useState(developerBackend.isDesktop);
  const [licenseLedgerError, setLicenseLedgerError] = useState("");
  const [licenseRecoveries, setLicenseRecoveries] = useState<LicenseLedgerRecoveryList | undefined>();
  const [licenseRecoveryError, setLicenseRecoveryError] = useState("");
  const [licenseEvidence, setLicenseEvidence] = useState<LicenseEvidenceReport | undefined>();
  const [licenseEvidenceBusy, setLicenseEvidenceBusy] = useState(false);
  const [licenseEvidenceError, setLicenseEvidenceError] = useState("");
  const [advisoryResult, setAdvisoryResult] = useState<AdvisoryScanResult | undefined>(() => readAdvisoryCache(initialReport.dependencyInventory.advisoryPreview.requestDigest));
  const [advisoryBusy, setAdvisoryBusy] = useState(false);
  const [advisoryError, setAdvisoryError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [activeOperationSection, setActiveOperationSection] = useState<OperationSectionId>(initialOperationSection);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [developerUpdateInfo, setDeveloperUpdateInfo] = useState<DeveloperUpdateInfo>();
  const commandPaletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const matchedAdvisoryResult = advisoryResult?.requestDigest === report.dependencyInventory.advisoryPreview.requestDigest ? advisoryResult : undefined;
  const matchedLicenseEvidence = licenseEvidence?.inventoryDigest === report.dependencyInventory.advisoryPreview.requestDigest ? licenseEvidence : undefined;
  const licenseReviewState = useMemo(() => buildLicenseReviewState(report.dependencyInventory.packages, licenseReviewRecords, report.dependencyInventory.advisoryPreview.requestDigest), [licenseReviewRecords, report.dependencyInventory.advisoryPreview.requestDigest, report.dependencyInventory.packages]);
  const effectiveChecks = useMemo(() => applySupplyChainGates(report.checks, report, policy, matchedAdvisoryResult, licenseReviewState, matchedLicenseEvidence), [licenseReviewState, matchedAdvisoryResult, matchedLicenseEvidence, policy, report]);
  const effectiveSummary = useMemo(() => summarizeChecks(effectiveChecks), [effectiveChecks]);
  const checks = useMemo(() => {
    const selected = filter === "all" ? effectiveChecks : effectiveChecks.filter((check) => check.status !== "pass");
    return [...selected].sort((left, right) => statusOrder.indexOf(left.status) - statusOrder.indexOf(right.status));
  }, [effectiveChecks, filter]);
  const currentArtifact = report.releaseHistory[0];
  const previousArtifact = report.releaseHistory[1];
  const sizeDelta = currentArtifact && previousArtifact ? currentArtifact.installerSizeBytes - previousArtifact.installerSizeBytes : 0;
  const sizeDeltaLabel = !previousArtifact ? "—" : sizeDelta === 0 ? text(locale, "unchanged") : `${sizeDelta > 0 ? "+" : "−"}${formatSizeDelta(Math.abs(sizeDelta), locale)}`;
  const statusFor = (id: string): CheckStatus => effectiveChecks.find((check) => check.id === id)?.status ?? "fail";
  const releasePlan: Array<{ id: string; status: CheckStatus }> = [
    { id: "inspect", status: effectiveSummary.fail === 0 ? "pass" : "fail" },
    { id: "test", status: "warning" },
    { id: "build", status: report.release.installerPath && report.release.artifactVersion === report.expectedVersion ? "pass" : "fail" },
    { id: "signature", status: statusFor("cryptographicSignature") },
    { id: "feed", status: statusFor("remoteVersion") },
    { id: "rollback", status: previousArtifact?.signatureValid ? "pass" : "warning" },
  ];
  const changeLocale = async (next: Locale) => {
    setPendingLocale(next);
    setLocaleLoading(true);
    setLocaleError(false);
    setFailedLocale(undefined);
    const request = ++localeRequest.current;
    try {
      await loadLanguagePack(next);
      if (request !== localeRequest.current) return;
      startTransition(() => setLocale(next));
      localStorage.setItem("msh-developer-tools:locale", next);
      document.documentElement.lang = next;
    } catch {
      if (request !== localeRequest.current) return;
      setPendingLocale(locale);
      setLocaleError(true);
      setFailedLocale(next);
    } finally {
      if (request === localeRequest.current) setLocaleLoading(false);
    }
  };
  const remember = (next: DeveloperInspectionReport) => {
    const entry = historyEntry(next);
    setHistory((current) => {
      const updated = [entry, ...current.filter((item) => item.inspectedAt !== entry.inspectedAt)].slice(0, 12);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  };
  const acceptInspection = (next: DeveloperInspectionReport) => {
    setChanges(compareReports(report, next));
    setReport(next);
    setWorkspace(next.workspaceRoot);
    setLicenseEvidence(undefined);
    setLicenseEvidenceError("");
    setVerificationMessage("");
    localStorage.setItem(WORKSPACE_KEY, next.workspaceRoot);
    remember(next);
  };
  const inspect = async (nextWorkspace: string) => {
    setBusy(true);
    setError("");
    try {
      acceptInspection(await developerBackend.inspectWorkspace(nextWorkspace, true));
    } catch (reason) {
      const reasonText = reason instanceof Error ? reason.message : String(reason);
      setError(`${reasonText.includes("workspace-invalid") ? text(locale, "workspaceInvalid") : text(locale, "refreshFailed")} ${reasonText}`);
    }
    finally { setBusy(false); }
  };
  const refresh = () => inspect(workspace);
  const chooseWorkspace = async () => {
    const selected = await developerBackend.chooseWorkspace();
    if (selected) await inspect(selected);
  };
  const clearHistory = () => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
    setChanges([]);
  };
  const changePolicy = (next: LicensePolicy) => {
    setPolicy(next);
    saveLicensePolicy(next);
  };
  const deferred = deferredText(locale);
  const operationLabels = operationsNavigatorText(locale);
  const paletteLabels = commandPaletteText(locale);
  const updateLabels = developerUpdateText(locale);
  const saveLicenseReview = async (item: LicenseReviewItem, draft: LicenseReviewDraft) => {
    const digest = report.dependencyInventory.advisoryPreview.requestDigest;
    if (!developerBackend.isDesktop) {
      setLicenseReviewRecords((current) => {
        const next = upsertLicenseReviewRecord(current, item, digest, draft);
        persistLicenseReviewRecords(digest, next);
        return next;
      });
      return;
    }
    setLicenseLedgerBusy(true);
    setLicenseLedgerError("");
    try {
      const next = await developerBackend.appendLicenseReviewDecision(digest, item, draft);
      setLicenseLedger(next);
      setLicenseReviewRecords(next.records);
      try {
        setLicenseRecoveries(await developerBackend.listLicenseReviewRecoveries(digest));
      } catch (reason) {
        setLicenseRecoveryError(reason instanceof Error ? reason.message : String(reason));
      }
    } catch (reason) {
      setLicenseLedgerError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLicenseLedgerBusy(false);
    }
  };
  const removeLicenseReview = async (itemId: string) => {
    const digest = report.dependencyInventory.advisoryPreview.requestDigest;
    if (!developerBackend.isDesktop) {
      setLicenseReviewRecords((current) => {
        const next = removeLicenseReviewRecord(current, itemId, digest);
        persistLicenseReviewRecords(digest, next);
        return next;
      });
      return;
    }
    setLicenseLedgerBusy(true);
    setLicenseLedgerError("");
    try {
      const next = await developerBackend.resetLicenseReviewDecision(digest, itemId);
      setLicenseLedger(next);
      setLicenseReviewRecords(next.records);
      try {
        setLicenseRecoveries(await developerBackend.listLicenseReviewRecoveries(digest));
      } catch (reason) {
        setLicenseRecoveryError(reason instanceof Error ? reason.message : String(reason));
      }
    } catch (reason) {
      setLicenseLedgerError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLicenseLedgerBusy(false);
    }
  };
  const exportLicenseLedgerBackup = async () => {
    setLicenseLedgerBusy(true);
    try {
      return await developerBackend.exportLicenseReviewLedger(report.dependencyInventory.advisoryPreview.requestDigest);
    } finally {
      setLicenseLedgerBusy(false);
    }
  };
  const refreshLicenseRecoveries = async () => {
    if (!developerBackend.isDesktop) return undefined;
    setLicenseLedgerBusy(true);
    setLicenseRecoveryError("");
    try {
      const next = await developerBackend.listLicenseReviewRecoveries(report.dependencyInventory.advisoryPreview.requestDigest);
      setLicenseRecoveries(next);
      return next;
    } catch (reason) {
      setLicenseRecoveryError(reason instanceof Error ? reason.message : String(reason));
      return undefined;
    } finally {
      setLicenseLedgerBusy(false);
    }
  };
  const exportLicenseRecovery = async (recovery: LicenseLedgerRecoveryEntry): Promise<LicenseLedgerExportReceipt | undefined> => {
    setLicenseLedgerBusy(true);
    setLicenseRecoveryError("");
    try {
      return await developerBackend.exportLicenseReviewRecovery(report.dependencyInventory.advisoryPreview.requestDigest, recovery);
    } catch (reason) {
      setLicenseRecoveryError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setLicenseLedgerBusy(false);
    }
  };
  const chooseLicenseLedgerBackup = async () => {
    setLicenseLedgerBusy(true);
    try {
      return await developerBackend.chooseLicenseReviewLedgerBackup(report.dependencyInventory.advisoryPreview.requestDigest);
    } finally {
      setLicenseLedgerBusy(false);
    }
  };
  const restoreLicenseLedgerBackup = async (preview: LicenseLedgerBackupPreview) => {
    setLicenseLedgerBusy(true);
    setLicenseRecoveryError("");
    try {
      const receipt = await developerBackend.restoreLicenseReviewLedgerBackup(preview, true);
      setLicenseLedger(receipt.snapshot);
      setLicenseReviewRecords(receipt.snapshot.records);
      try {
        setLicenseRecoveries(await developerBackend.listLicenseReviewRecoveries(receipt.snapshot.inventoryDigest));
      } catch (reason) {
        setLicenseRecoveryError(reason instanceof Error ? reason.message : String(reason));
      }
      return receipt;
    } finally {
      setLicenseLedgerBusy(false);
    }
  };
  const collectLicenseEvidence = async () => {
    setLicenseEvidenceBusy(true);
    setLicenseEvidenceError("");
    try {
      setLicenseEvidence(await developerBackend.collectLicenseEvidence(workspace, report.dependencyInventory.advisoryPreview.requestDigest));
    } catch (reason) {
      setLicenseEvidenceError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLicenseEvidenceBusy(false);
    }
  };
  const scanAdvisories = async () => {
    setAdvisoryBusy(true);
    setAdvisoryError("");
    try {
      const result = await developerBackend.scanDependencyAdvisories(workspace, report.dependencyInventory.advisoryPreview.requestDigest);
      saveAdvisoryCache(result);
      setAdvisoryResult(result);
    } catch (reason) {
      setAdvisoryError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAdvisoryBusy(false);
    }
  };
  const exportSupplyChain = async (format: SupplyChainExportFormat) => {
    setExporting(true);
    setExportMessage("");
    try {
      const artifact = format === "notices"
        ? await import("./thirdPartyNotices").then(({ createThirdPartyNoticesExport }) => {
          if (!matchedLicenseEvidence) throw new Error("license-evidence-not-current");
          return createThirdPartyNoticesExport(report, matchedLicenseEvidence);
        })
        : createSupplyChainExport(report, format, matchedLicenseEvidence);
      const saved = await developerBackend.exportSupplyChainReport(artifact.filename, artifact.mime, artifact.content);
      setExportMessage(saved ? text(locale, "exportSaved").replace("{path}", saved) : text(locale, "exportCanceled"));
    } catch (reason) {
      setExportMessage(`${text(locale, "exportFailed")} ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setExporting(false);
    }
  };
  const exportLicenseReviews = async () => {
    setExporting(true);
    setExportMessage("");
    try {
      const artifact = createLicenseReviewExport(report, licenseReviewState);
      const saved = await developerBackend.exportSupplyChainReport(artifact.filename, artifact.mime, artifact.content);
      setExportMessage(saved ? text(locale, "exportSaved").replace("{path}", saved) : text(locale, "exportCanceled"));
    } catch (reason) {
      setExportMessage(`${text(locale, "exportFailed")} ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setExporting(false);
    }
  };
  const verifySupplyChainReport = async () => {
    const labels = licenseAuditText(locale);
    setVerificationBusy(true);
    setVerificationMessage("");
    try {
      const verification = await developerBackend.verifySupplyChainReport(report.dependencyInventory.advisoryPreview.requestDigest);
      setVerificationMessage(verification
        ? labels.verified.replace("{applicable}", String(verification.applicable)).replace("{sha}", `${verification.sha256.slice(0, 16)}…`)
        : labels.verifyCanceled);
    } catch (reason) {
      setVerificationMessage(`${labels.verifyFailed} ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setVerificationBusy(false);
    }
  };

  const navigateToOperationSection = (sectionId: OperationSectionId) => {
    setActiveOperationSection(sectionId);
    setNavigationRequest((current) => current + 1);
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${sectionId}`);
    } catch {
      // Navigation remains functional even if a host scheme rejects history updates.
    }
  };

  const alignOperationSection = useCallback((sectionId: OperationSectionId) => {
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(sectionId);
      if (!target) return;
      target.scrollIntoView?.({ behavior: "auto", block: "start" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const handleDeferredContentReady = useCallback((sectionId: string) => {
    if (sectionId === activeOperationSection && isOperationSectionId(sectionId)) {
      alignOperationSection(sectionId);
    }
  }, [activeOperationSection, alignOperationSection]);

  useEffect(() => {
    const hasRequestedInitialHash = isOperationSectionId(window.location.hash.replace(/^#/, ""));
    if (navigationRequest === 0 && !hasRequestedInitialHash) return;
    return alignOperationSection(activeOperationSection);
  }, [activeOperationSection, alignOperationSection, navigationRequest]);

  useEffect(() => {
    const syncOperationHash = () => {
      const sectionId = window.location.hash.replace(/^#/, "");
      if (!isOperationSectionId(sectionId)) return;
      setActiveOperationSection(sectionId);
      setNavigationRequest((current) => current + 1);
    };
    window.addEventListener("hashchange", syncOperationHash);
    window.addEventListener("popstate", syncOperationHash);
    return () => {
      window.removeEventListener("hashchange", syncOperationHash);
      window.removeEventListener("popstate", syncOperationHash);
    };
  }, []);

  useEffect(() => {
    const openCommandPalette = (event: KeyboardEvent) => {
      if (event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLocaleLowerCase() !== "k") return;
      event.preventDefault();
      if (!commandPaletteOpen) {
        commandPaletteReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      setCommandPaletteOpen((current) => !current);
    };
    window.addEventListener("keydown", openCommandPalette);
    return () => window.removeEventListener("keydown", openCommandPalette);
  }, [commandPaletteOpen]);

  const filterChecksFromPalette = (nextFilter: "all" | "problems") => {
    setFilter(nextFilter);
    navigateToOperationSection("release-gates");
  };

  useEffect(() => {
    if (!developerBackend.isDesktop || !readDeveloperUpdatePreferences().autoCheck) return;
    let active = true;
    developerBackend.checkDeveloperUpdate().then((next) => {
      if (active) setDeveloperUpdateInfo(next);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!developerBackend.isDesktop) return;
    let active = true;
    const load = async () => {
      setBusy(true);
      try {
        const selected = localStorage.getItem(WORKSPACE_KEY) || await developerBackend.discoverWorkspace();
        if (!selected) throw new Error("workspace-invalid");
        const next = await developerBackend.inspectWorkspace(selected, true);
        if (!active) return;
        setChanges(compareReports(initialReport, next));
        setReport(next);
        setWorkspace(next.workspaceRoot);
        setLicenseEvidence(undefined);
        setLicenseEvidenceError("");
        localStorage.setItem(WORKSPACE_KEY, next.workspaceRoot);
        const entry = historyEntry(next);
        setHistory((current) => {
          const updated = [entry, ...current.filter((item) => item.inspectedAt !== entry.inspectedAt)].slice(0, 12);
          localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
          return updated;
        });
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      } finally { if (active) setBusy(false); }
    };
    void load();
    return () => { active = false; };
  }, [initialReport]);

  useEffect(() => {
    const digest = report.dependencyInventory.advisoryPreview.requestDigest;
    setAdvisoryResult(readAdvisoryCache(digest));
    setLicenseRecoveries(undefined);
    setLicenseRecoveryError("");
    if (!developerBackend.isDesktop) {
      setLicenseReviewRecords(readLicenseReviewRecords(digest));
      setLicenseLedger(undefined);
      setLicenseLedgerError("");
      setLicenseLedgerBusy(false);
    }
    setLicenseEvidence(undefined);
    setLicenseEvidenceError("");
    setAdvisoryError("");
  }, [report.dependencyInventory.advisoryPreview.requestDigest]);

  useEffect(() => {
    recordQualityHistory(report.qualityEvidence);
  }, [report.qualityEvidence.generatedAt, report.qualityEvidence.sourceDigest, report.qualityEvidence.status]);

  useEffect(() => {
    if (!developerBackend.isDesktop) return;
    const digest = report.dependencyInventory.advisoryPreview.requestDigest;
    let active = true;
    const load = async () => {
      setLicenseLedgerBusy(true);
      setLicenseLedgerError("");
      setLicenseRecoveryError("");
      setLicenseReviewRecords([]);
      try {
        let next = await developerBackend.loadLicenseReviewLedger(digest);
        const legacy = readLicenseReviewRecords(digest);
        if (next.eventCount === 0 && legacy.length > 0) {
          next = await developerBackend.migrateLicenseReviewRecords(digest, legacy);
          clearLegacyLicenseReviewRecords(digest);
        }
        if (!active) return;
        setLicenseLedger(next);
        setLicenseReviewRecords(next.records);
        try {
          const recoveries = await developerBackend.listLicenseReviewRecoveries(digest);
          if (active) setLicenseRecoveries(recoveries);
        } catch (reason) {
          if (active) {
            setLicenseRecoveries(undefined);
            setLicenseRecoveryError(reason instanceof Error ? reason.message : String(reason));
          }
        }
      } catch (reason) {
        if (!active) return;
        setLicenseLedger(undefined);
        setLicenseRecoveries(undefined);
        setLicenseReviewRecords([]);
        setLicenseLedgerError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (active) setLicenseLedgerBusy(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [report.dependencyInventory.advisoryPreview.requestDigest]);

  return <div className="developer-shell">
    <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><div><strong>{text(locale, "appName")}</strong><small>Phase D31</small></div></div>
      <div className="topbar-actions"><label><span>{text(locale, "language")}</span><select aria-label={text(locale, "language")} value={pendingLocale} onChange={(event) => void changeLocale(event.target.value as Locale)}>{languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{localeLoading ? <span className="locale-load-state" role="status">{localeLoaderMessages[locale].loading}</span> : localeError && failedLocale ? <span className="locale-load-state error" role="alert">{localeLoaderMessages[locale].failed}<button type="button" onClick={() => void changeLocale(failedLocale)}>{localeLoaderMessages[locale].retry}</button></span> : null}<button className="command-palette-open" type="button" aria-haspopup="dialog" title={`${paletteLabels.open} · ${paletteLabels.shortcut}`} onClick={(event) => { commandPaletteReturnFocusRef.current = event.currentTarget; setCommandPaletteOpen(true); }}><span>{paletteLabels.open}</span><kbd>{paletteLabels.shortcut}</kbd></button><button className="refresh-button" type="button" onClick={refresh} disabled={busy || localeLoading}>{busy ? text(locale, "refreshing") : text(locale, "refresh")}</button></div>
    </header>

    <main>
      <section className="hero">
        <div><span className="kicker">{text(locale, "kicker")}</span><h1>{text(locale, "title")}</h1><p>{text(locale, "intro")}</p></div>
        <div className="readonly-badge"><span>◉</span><div><strong>{text(locale, "controlledMode")}</strong><small>{text(locale, "inspectedAt")}: {new Date(report.inspectedAt).toLocaleString(locale)}</small></div></div>
      </section>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {developerUpdateInfo?.available && developerUpdateInfo.version ? <button className="developer-update-startup-banner" type="button" onClick={() => navigateToOperationSection("developer-update-center")}><span aria-hidden="true">↓</span><strong>{updateLabels.startupAvailable.replace("{version}", developerUpdateInfo.version)}</strong><small>{updateLabels.nav} →</small></button> : null}

      <OperationsNavigator locale={locale} activeId={activeOperationSection} onNavigate={navigateToOperationSection} />

      <section className="workspace-bar" aria-label={text(locale, "workspace")}>
        <div><span className="mode-pill">{developerBackend.isDesktop ? text(locale, "nativeInspection") : text(locale, "webInspection")}</span><strong>{workspace || text(locale, "loadingWorkspace")}</strong><small>{text(locale, "workspaceHint")}</small></div>
        <button type="button" className="workspace-button" onClick={chooseWorkspace} disabled={!developerBackend.isDesktop || busy} title={developerBackend.isDesktop ? undefined : text(locale, "nativeOnly")}>{text(locale, "chooseWorkspace")}</button>
      </section>

      <section id="developer-overview" tabIndex={-1} aria-labelledby="summary-title">
        <div className="section-heading"><div><span className="kicker">D31 STATUS</span><h2 id="summary-title">{text(locale, "summary")}</h2></div><span className="workspace-label">{text(locale, "workspace")}: {report.workspaceRoot}</span></div>
        <div className="summary-grid">
          <SummaryCard label={text(locale, "projectVersion")} value={report.expectedVersion} />
          <SummaryCard label={text(locale, "artifactVersion")} value={report.release.artifactVersion} />
          <SummaryCard label={text(locale, "passed")} value={effectiveSummary.pass} tone="pass" />
          <SummaryCard label={text(locale, "warnings")} value={effectiveSummary.warning} tone="warning" />
          <SummaryCard label={text(locale, "blockers")} value={effectiveSummary.fail} tone={effectiveSummary.fail > 0 ? "fail" : "pass"} />
        </div>
      </section>

      <div className="two-column history-layout">
        <section className="panel" aria-labelledby="changes-title"><span className="kicker">INSPECTION DIFF</span><h2 id="changes-title">{text(locale, "changesSinceLast")}</h2><div className="change-list">{changes.map((change) => { const kind = change.after === "fail" ? "newBlocker" : change.after === "pass" ? "resolvedProblem" : "changedStatus"; return <article className={change.after} key={change.id}><span>{statusSymbol[change.after]}</span><div><strong>{translatedCheck(locale, change.id)}</strong><small>{text(locale, kind)} · {change.before ? statusLabel(locale, change.before) : "—"} → {statusLabel(locale, change.after)}</small></div></article>; })}{changes.length === 0 ? <p>{text(locale, "noChanges")}</p> : null}</div></section>
        <section className="panel" aria-labelledby="history-title"><div className="panel-heading"><div><span className="kicker">LOCAL HISTORY</span><h2 id="history-title">{text(locale, "recentInspections")}</h2></div><button className="text-button" type="button" onClick={clearHistory} disabled={history.length === 0}>{text(locale, "clearHistory")}</button></div><div className="history-list">{history.slice(0, 6).map((item) => <article key={item.inspectedAt}><time>{new Date(item.inspectedAt).toLocaleString(locale)}</time><strong>{item.expectedVersion || "—"}</strong><span className={item.fail > 0 ? "fail" : item.warning > 0 ? "warning" : "pass"}>{item.pass} / {item.warning} / {item.fail}</span></article>)}{history.length === 0 ? <p>{text(locale, "noHistory")}</p> : null}</div></section>
      </div>

      <section className="panel artifact-history-panel" aria-labelledby="artifact-history-title">
        <div className="panel-heading"><div><span className="kicker">SIGNED ARTIFACT TIMELINE</span><h2 id="artifact-history-title">{text(locale, "artifactHistory")}</h2><p>{text(locale, "artifactHistoryIntro")}</p></div><span className={`history-integrity ${report.releaseHistory.length > 0 && report.releaseHistory.every((entry) => entry.signatureValid) ? "pass" : "fail"}`}>{report.releaseHistory.length > 0 && report.releaseHistory.every((entry) => entry.signatureValid) ? text(locale, "signatureValid") : text(locale, "signatureInvalid")}</span></div>
        {previousArtifact && currentArtifact ? <div className="artifact-comparison"><SummaryCard label={text(locale, "currentRelease")} value={currentArtifact.version} /><SummaryCard label={text(locale, "previousRelease")} value={previousArtifact.version} /><SummaryCard label={text(locale, "sizeChange")} value={sizeDeltaLabel} /><SummaryCard label={text(locale, "hashChanged")} value={currentArtifact.installerSha256 === previousArtifact.installerSha256 ? text(locale, "unchanged") : text(locale, "changed")} /><SummaryCard label={text(locale, "urlChanged")} value={currentArtifact.downloadUrl === previousArtifact.downloadUrl ? text(locale, "unchanged") : text(locale, "changed")} /></div> : <p className="empty-state">{text(locale, "noPreviousRelease")}</p>}
        <div className="artifact-timeline">{report.releaseHistory.map((artifact, index) => <article key={artifact.version} className={artifact.signatureValid ? "pass" : "fail"}><div><span>{index + 1}</span><strong>{artifact.version}</strong><small>{index === 0 ? text(locale, "currentRelease") : index === 1 ? text(locale, "previousRelease") : artifact.publishedAt ? new Date(artifact.publishedAt).toLocaleDateString(locale) : "—"}</small></div><dl><div><dt>{text(locale, "size")}</dt><dd>{formatBytes(artifact.installerSizeBytes, locale)}</dd></div><div><dt>SHA-256</dt><dd><code>{artifact.installerSha256 || "—"}</code></dd></div></dl><span className="artifact-signature">{artifact.signatureValid ? `✓ ${text(locale, "signatureValid")}` : `× ${text(locale, "signatureInvalid")}`}</span></article>)}</div>
      </section>

      <section className="panel release-plan-panel" aria-labelledby="release-plan-title">
        <div className="panel-heading"><div><span className="kicker">READ-ONLY RELEASE RUNBOOK</span><h2 id="release-plan-title">{text(locale, "releasePlan")}</h2><p>{text(locale, "releasePlanIntro")}</p></div></div>
        <div className="release-plan">{releasePlan.map((item, index) => <article className={item.status} key={item.id}><span className="plan-index">{index + 1}</span><div><strong>{text(locale, `plan_${item.id}` as keyof Catalog)}</strong><small>{item.status === "pass" ? text(locale, "planReady") : item.status === "fail" ? text(locale, "planBlocked") : text(locale, "planReview")}</small>{planCommands[item.id] ? <code>{planCommands[item.id]}</code> : null}</div></article>)}</div>
      </section>

      <DeferredSection eager={!deferPanels} forceActive={activeOperationSection === "developer-update-center"} sectionId="developer-update-center" label={updateLabels.nav} locale={locale} minHeight={690} onContentReady={handleDeferredContentReady}>
        <Suspense fallback={<DeferredPanelFallback label={updateLabels.nav} locale={locale} />}><DeveloperUpdateCenter locale={locale} startupInfo={developerUpdateInfo} onInfoChange={setDeveloperUpdateInfo} /></Suspense>
      </DeferredSection>

      <DeferredSection eager={!deferPanels} forceActive={activeOperationSection === "release-evidence-center"} sectionId="release-evidence-center" label={releaseEvidenceText(locale).title} locale={locale} minHeight={620} onContentReady={handleDeferredContentReady}>
        <Suspense fallback={<DeferredPanelFallback label={releaseEvidenceText(locale).title} locale={locale} />}><ReleaseEvidenceCenter locale={locale} workspaceRoot={workspace} isDesktop={developerBackend.isDesktop} /></Suspense>
      </DeferredSection>

      <DeferredSection eager={!deferPanels} forceActive={activeOperationSection === "release-approval-center"} sectionId="release-approval-center" label={operationLabels.approval} locale={locale} minHeight={900} onContentReady={handleDeferredContentReady}>
        <Suspense fallback={<DeferredPanelFallback label={text(locale, "releasePlan")} locale={locale} />}><ReleaseApprovalCenter locale={locale} workspaceRoot={workspace} isDesktop={developerBackend.isDesktop} /></Suspense>
      </DeferredSection>

      <DeferredSection eager={!deferPanels} forceActive={activeOperationSection === "release-handoff-center"} sectionId="release-handoff-center" label={operationLabels.handoff} locale={locale} minHeight={720} onContentReady={handleDeferredContentReady}>
        <Suspense fallback={<DeferredPanelFallback label={operationLabels.handoff} locale={locale} />}><ReleaseHandoffCenter locale={locale} workspaceRoot={workspace} isDesktop={developerBackend.isDesktop} /></Suspense>
      </DeferredSection>

      <DeferredSection eager={!deferPanels} forceActive={activeOperationSection === "quality-evidence-center"} sectionId="quality-evidence-center" label={deferred.qualitySection} locale={locale} minHeight={540} onContentReady={handleDeferredContentReady}>
        <Suspense fallback={<DeferredPanelFallback label={deferred.qualitySection} locale={locale} />}><QualityEvidenceCenter analysis={report.qualityEvidence} locale={locale} /></Suspense>
      </DeferredSection>

      <DeferredSection eager={!deferPanels} forceActive={activeOperationSection === "bundle-performance-center"} sectionId="bundle-performance-center" label={deferred.bundleSection} locale={locale} minHeight={520} onContentReady={handleDeferredContentReady}>
        <Suspense fallback={<DeferredPanelFallback label={deferred.bundleSection} locale={locale} />}><BundlePerformanceCenter analysis={report.bundleAnalysis} locale={locale} /></Suspense>
      </DeferredSection>

      <DeferredSection eager={!deferPanels} forceActive={activeOperationSection === "dependency-center"} sectionId="dependency-center" label={deferred.dependencySection} locale={locale} minHeight={760} onContentReady={handleDeferredContentReady}>
        <Suspense fallback={<DeferredPanelFallback label={deferred.dependencySection} locale={locale} />}><DependencyCenter inventory={report.dependencyInventory} checks={effectiveChecks} locale={locale} policy={policy} onPolicyChange={changePolicy} licenseEvidence={matchedLicenseEvidence} licenseEvidenceBusy={licenseEvidenceBusy} licenseEvidenceError={licenseEvidenceError} onCollectLicenseEvidence={collectLicenseEvidence} licenseReviewState={licenseReviewState} licenseLedger={licenseLedger} licenseLedgerBusy={licenseLedgerBusy} licenseLedgerError={licenseLedgerError} licenseRecoveries={licenseRecoveries} licenseRecoveryError={licenseRecoveryError} onRefreshLicenseRecoveries={refreshLicenseRecoveries} onExportLicenseRecovery={exportLicenseRecovery} onSaveLicenseReview={saveLicenseReview} onRemoveLicenseReview={removeLicenseReview} onExportLicenseReviews={exportLicenseReviews} onExportLicenseLedger={exportLicenseLedgerBackup} onChooseLicenseLedgerBackup={chooseLicenseLedgerBackup} onRestoreLicenseLedgerBackup={restoreLicenseLedgerBackup} advisoryResult={matchedAdvisoryResult} advisoryBusy={advisoryBusy} advisoryError={advisoryError} onScan={scanAdvisories} isDesktop={developerBackend.isDesktop} onExport={exportSupplyChain} exporting={exporting} exportMessage={exportMessage} onVerify={verifySupplyChainReport} verificationBusy={verificationBusy} verificationMessage={verificationMessage} /></Suspense>
      </DeferredSection>

      <DeferredSection eager={!deferPanels} forceActive={activeOperationSection === "capability-security-center"} sectionId="capability-security-center" label={capabilitySecurityText(locale).nav} locale={locale} minHeight={620} onContentReady={handleDeferredContentReady}>
        <Suspense fallback={<DeferredPanelFallback label={capabilitySecurityText(locale).nav} locale={locale} />}><CapabilitySecurityCenter audit={report.capabilitySecurity} locale={locale} /></Suspense>
      </DeferredSection>

      <DeferredSection eager={!deferPanels} forceActive={activeOperationSection === "build-environment-center"} sectionId="build-environment-center" label={buildEnvironmentText(locale).nav} locale={locale} minHeight={560} onContentReady={handleDeferredContentReady}>
        <Suspense fallback={<DeferredPanelFallback label={buildEnvironmentText(locale).nav} locale={locale} />}><BuildEnvironmentCenter audit={report.buildEnvironment} locale={locale} /></Suspense>
      </DeferredSection>

      <section id="release-gates" tabIndex={-1} className="panel" aria-labelledby="gates-title">
        <div className="panel-heading"><div><span className="kicker">RELEASE GATES</span><h2 id="gates-title">{text(locale, "releaseGates")}</h2></div><div className="segmented" role="group" aria-label={text(locale, "releaseGates")}><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>{text(locale, "allChecks")}</button><button className={filter === "problems" ? "active" : ""} onClick={() => setFilter("problems")}>{text(locale, "problemsOnly")}</button></div></div>
        <div className="check-grid">{checks.map((check) => <article className={`check-card ${check.status}`} key={check.id}><span className="status-icon" aria-hidden="true">{statusSymbol[check.status]}</span><div><span className="status-text">{statusLabel(locale, check.status)}</span><strong>{translatedCheck(locale, check.id)}</strong><small>{translatedDetail(locale, check.detail)}</small>{check.technicalDetail ? <details><summary>{text(locale, "technicalDetail")}</summary><code>{check.technicalDetail}</code></details> : null}</div></article>)}{checks.length === 0 ? <p className="empty-state">{text(locale, "noProblems")}</p> : null}</div>
      </section>

      <div className="two-column">
        <section className="panel" aria-labelledby="versions-title"><span className="kicker">VERSION MATRIX</span><h2 id="versions-title">{text(locale, "versionSources")}</h2><div className="version-table" role="table"><div className="table-row header" role="row"><span>{text(locale, "source")}</span><span>{text(locale, "value")}</span><span>{text(locale, "match")}</span></div>{report.versionSources.map((source) => <div className="table-row" role="row" key={source.id}><code>{source.path}</code><strong>{source.value || "—"}</strong><span className={source.value === report.expectedVersion ? "match yes" : "match no"}>{source.value === report.expectedVersion ? "✓" : "×"}</span></div>)}</div></section>
        <section className="panel" aria-labelledby="artifact-title"><span className="kicker">SIGNED ARTIFACT</span><h2 id="artifact-title">{text(locale, "artifactDetails")}</h2><dl className="detail-list"><div><dt>{text(locale, "path")}</dt><dd>{report.release.installerPath || "—"}</dd></div><div><dt>{text(locale, "size")}</dt><dd>{formatBytes(report.release.installerSizeBytes, locale)}</dd></div><div><dt>{text(locale, "manifest")}</dt><dd>{report.release.manifestPath || "—"}</dd></div><div><dt>{text(locale, "publishedAt")}</dt><dd>{report.release.publishedAt ? new Date(report.release.publishedAt).toLocaleString(locale) : "—"}</dd></div><div className="wide"><dt>{text(locale, "sha256")}</dt><dd><code>{report.release.installerSha256 || "—"}</code></dd></div><div className="wide"><dt>{text(locale, "downloadUrl")}</dt><dd>{report.release.downloadUrl || "—"}</dd></div></dl></section>
      </div>

      <section className="panel feed-panel" aria-labelledby="feed-title"><div><span className="kicker">HTTPS RELEASE FEED</span><h2 id="feed-title">{text(locale, "officialFeed")}</h2><p>{report.remoteFeed.endpoint}</p></div><div className="feed-stats"><article><span>{text(locale, "feedStatus")}</span><strong className={report.remoteFeed.reachable ? "good" : "warning-text"}>{report.remoteFeed.checked ? report.remoteFeed.reachable ? text(locale, "reachable") : text(locale, "unreachable") : text(locale, "notChecked")}</strong></article><article><span>{text(locale, "feedVersion")}</span><strong>{report.remoteFeed.version || "—"}</strong></article><article><span>{text(locale, "feedChecked")}</span><strong>{report.remoteFeed.checked ? new Date(report.inspectedAt).toLocaleTimeString(locale) : text(locale, "notChecked")}</strong></article></div></section>

      <section className="panel protected-panel" aria-labelledby="actions-title"><div><span className="kicker">FUTURE WRITE ACTIONS</span><h2 id="actions-title">{text(locale, "disabledActions")}</h2><p>{text(locale, "disabledIntro")}</p></div><div className="protected-actions">{(["build", "sign", "publish"] as const).map((key) => <button type="button" disabled key={key}><strong>{text(locale, key)}</strong><small>{text(locale, "disabledD0")}</small></button>)}</div><aside><strong>{text(locale, "safeBoundary")}</strong><p>{text(locale, "safeBoundaryText")}</p></aside></section>
    </main>
    {commandPaletteOpen ? <Suspense fallback={<div className="command-palette-backdrop"><div className="command-palette-loading" role="status">{paletteLabels.title}…</div></div>}><CommandPalette busy={busy || localeLoading} locale={locale} onClose={() => setCommandPaletteOpen(false)} onNavigate={navigateToOperationSection} onRefresh={refresh} onFilterChecks={filterChecksFromPalette} onChooseWorkspace={developerBackend.isDesktop ? chooseWorkspace : undefined} returnFocusTo={commandPaletteReturnFocusRef.current} /></Suspense> : null}
  </div>;
}
