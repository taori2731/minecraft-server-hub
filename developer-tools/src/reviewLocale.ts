import { getLocalePack, type FlatLocaleCopy, type Locale } from "./locale";

export type ReviewLocale = FlatLocaleCopy;
export const reviewLabels = new Proxy({} as Record<Locale, ReviewLocale>, {
  get: (_target, locale: string) => getLocalePack(locale as Locale).review,
});
export const reviewText = (locale: Locale) => reviewLabels[locale];
