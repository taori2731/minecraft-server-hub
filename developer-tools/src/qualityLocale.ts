import { getLocalePack, type Locale } from "./locale";

export interface QualityLabels {
  title: string; intro: string; current: string; stale: string; missing: string; invalid: string; failed: string;
  runRequired: string; commandHint: string; stages: string; tests: string; duration: string; lineCoverage: string;
  sourceIntegrity: string; verified: string; changed: string; coverage: string; target: string; gap: string;
  stageEvidence: string; passed: string; failedLabel: string; skipped: string; noTests: string; output: string;
  freshness: string; generated: string; newestSource: string; digest: string; report: string; sourceStable: string;
  history: string; historyIntro: string; noHistory: string; coverageUnavailable: string; coverageGaps: string;
  lines: string; statements: string; functions: string; branches: string; seconds: string;
  stageNames: Record<string, string>;
  [key: string]: string | Record<string, string>;
}

export const qualityLabels = new Proxy({} as Record<Locale, QualityLabels>, {
  get: (_target, locale: string) => getLocalePack(locale as Locale).quality as unknown as QualityLabels,
});
