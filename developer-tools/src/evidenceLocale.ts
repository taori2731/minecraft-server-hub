import { getLocalePack, type FlatLocaleCopy, type Locale } from "./locale";

export type EvidenceLocale = FlatLocaleCopy;
export const evidenceLabels = new Proxy({} as Record<Locale, EvidenceLocale>, {
  get: (_target, locale: string) => getLocalePack(locale as Locale).evidence,
});
export const evidenceText = (locale: Locale) => evidenceLabels[locale];
