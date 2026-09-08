import type { BundleAnalysis } from "./types";

const BASELINE_KEY = "msh-developer-tools:bundle-baseline:v1";

export interface BundleBaseline {
  savedAt: string;
  entryBytes: number;
  entryGzipBytes: number;
  totalGzipBytes: number;
  cssBytes: number;
  chunks: number;
}

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function readBundleBaseline(): BundleBaseline | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(BASELINE_KEY) ?? "null") as Partial<BundleBaseline> | null;
    if (!value || typeof value.savedAt !== "string" || ![value.entryBytes, value.entryGzipBytes, value.totalGzipBytes, value.cssBytes, value.chunks].every(finite)) return undefined;
    return value as BundleBaseline;
  } catch { return undefined; }
}

export function saveBundleBaseline(analysis: BundleAnalysis): BundleBaseline | undefined {
  const entry = analysis.chunks.find((chunk) => chunk.entry);
  if (!entry || analysis.status !== "current") return undefined;
  const baseline: BundleBaseline = {
    savedAt: new Date().toISOString(),
    entryBytes: entry.rawBytes,
    entryGzipBytes: entry.gzipBytes,
    totalGzipBytes: analysis.totals.totalJavaScriptGzipBytes,
    cssBytes: analysis.totals.totalCssBytes,
    chunks: analysis.totals.chunks,
  };
  try { localStorage.setItem(BASELINE_KEY, JSON.stringify(baseline)); }
  catch { return undefined; }
  return baseline;
}
