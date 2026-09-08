import { getLocalePack, type FlatLocaleCopy, type Locale } from "./locale";

export type BundleText = FlatLocaleCopy;
export const bundleText = (locale: Locale) => getLocalePack(locale).bundle;
