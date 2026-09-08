import { beforeEach, describe, expect, it } from "vitest";
import { loadQualityHistory, recordQualityHistory } from "./qualityHistory";
import type { QualityEvidenceAnalysis } from "./types";

const analysis = (index: number, status: QualityEvidenceAnalysis["status"] = "current"): QualityEvidenceAnalysis => ({
  status,
  reportPath: "artifacts/developer-tools/quality-evidence.json",
  generatedAt: `2026-09-01T00:00:${String(index).padStart(2, "0")}Z`,
  startedAt: "2026-09-01T00:00:00Z",
  completedAt: "2026-09-01T00:00:01Z",
  durationMs: 1000 + index,
  sourceNewestAt: "2026-08-31T23:59:00Z",
  sourceDigest: index.toString(16).toUpperCase().padStart(64, "0"),
  sourceStable: true,
  requiredStageIds: ["appTypecheck"],
  summary: { totalStages: 1, passedStages: 1, failedStages: 0, totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 0 },
  coverage: { available: true, reportPath: "coverage/quality/coverage-summary.json", lines: { total: 100, covered: 80, skipped: 0, pct: 80 }, statements: { total: 100, covered: 79, skipped: 0, pct: 79 }, functions: { total: 100, covered: 70, skipped: 0, pct: 70 }, branches: { total: 100, covered: 60, skipped: 0, pct: 60 } },
  coverageThresholds: { lines: 70, statements: 70, functions: 60, branches: 55 },
  coverageViolations: [],
  stages: [],
  error: "",
});

describe("quality history", () => {
  beforeEach(() => localStorage.clear());

  it("ignores corrupt storage and non-current evidence", () => {
    localStorage.setItem("msh-developer-tools:quality-history:v1", "{broken");
    expect(loadQualityHistory()).toEqual([]);
    expect(recordQualityHistory(analysis(1, "stale"))).toEqual([]);
  });

  it("retains eight minimal, deduplicated summaries", () => {
    for (let index = 0; index < 10; index += 1) recordQualityHistory(analysis(index));
    recordQualityHistory(analysis(9));
    const history = loadQualityHistory();
    expect(history).toHaveLength(8);
    expect(history[0].generatedAt).toBe(analysis(9).generatedAt);
    expect(new Set(history.map((entry) => entry.generatedAt)).size).toBe(8);
    const raw = localStorage.getItem("msh-developer-tools:quality-history:v1") ?? "";
    expect(raw).not.toContain("reportPath");
    expect(raw).not.toContain("stages");
    expect(raw).not.toContain("outputTail");
  });
});
