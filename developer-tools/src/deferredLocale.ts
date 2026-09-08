import { getLocalePack, type Locale } from "./locale";

export interface DeferredLabels {
  qualitySection: string;
  bundleSection: string;
  dependencySection: string;
  loading: string;
  loadingHint: string;
  failed: string;
  failedHint: string;
  reload: string;
}

export const deferredLabels = new Proxy({} as Record<Locale, DeferredLabels>, {
  get: (_target, locale: string) => getLocalePack(locale as Locale).deferred as unknown as DeferredLabels,
});
export const deferredText = (locale: Locale) => deferredLabels[locale];
