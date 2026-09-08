import type { QualityEvidenceAnalysis } from "./types";

const STORAGE_KEY = "msh-developer-tools:quality-history:v1";
const MAX_ENTRIES = 8;

export interface QualityHistoryEntry {
  generatedAt: string;
  sourceDigest: string;
  durationMs: number;
  passedStages: number;
  totalStages: number;
  passedTests: number;
  totalTests: number;
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

function valid(entry: unknown): entry is QualityHistoryEntry {
  if (!entry || typeof entry !== "object") return false;
  const value = entry as Record<string, unknown>;
  return typeof value.generatedAt === "string" && typeof value.sourceDigest === "string"
    && [value.durationMs, value.passedStages, value.totalStages, value.passedTests, value.totalTests,
      value.lines, value.branches, value.functions, value.statements]
      .every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0);
}

export function loadQualityHistory(): QualityHistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function recordQualityHistory(analysis: QualityEvidenceAnalysis): QualityHistoryEntry[] {
  const history = loadQualityHistory();
  if (!analysis.generatedAt || !analysis.sourceDigest || !analysis.coverage.available || analysis.status !== "current") return history;
  const entry: QualityHistoryEntry = {
    generatedAt: analysis.generatedAt,
    sourceDigest: analysis.sourceDigest,
    durationMs: analysis.durationMs,
    passedStages: analysis.summary.passedStages,
    totalStages: analysis.summary.totalStages,
    passedTests: analysis.summary.passedTests,
    totalTests: analysis.summary.totalTests,
    lines: analysis.coverage.lines.pct,
    branches: analysis.coverage.branches.pct,
    functions: analysis.coverage.functions.pct,
    statements: analysis.coverage.statements.pct,
  };
  const next = [entry, ...history.filter((item) => item.generatedAt !== entry.generatedAt)].slice(0, MAX_ENTRIES);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* local storage is optional */ }
  return next;
}
