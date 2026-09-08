import type { AppLocale } from "./i18n";

export type TranslationCatalog = Readonly<{
  exact: Readonly<Record<string, string>>;
  patterns: Readonly<Record<string, string>>;
}>;

const emptyCatalog: TranslationCatalog = { exact: {}, patterns: {} };
const catalogCache = new Map<AppLocale, TranslationCatalog>([["ja", emptyCatalog]]);
const pendingLoads = new Map<AppLocale, Promise<TranslationCatalog>>();

const loaders: Partial<Record<AppLocale, () => Promise<{ default: TranslationCatalog }>>> = {
  en: () => import("./translations/en"),
  de: () => import("./translations/de"),
  es: () => import("./translations/es"),
  fr: () => import("./translations/fr"),
  ko: () => import("./translations/ko"),
  "pt-BR": () => import("./translations/pt-BR"),
  "zh-CN": () => import("./translations/zh-CN"),
  "zh-TW": () => import("./translations/zh-TW"),
};

export function hasTranslationCatalog(locale: AppLocale) {
  return catalogCache.has(locale);
}

export function getTranslationCatalog(locale: AppLocale) {
  return catalogCache.get(locale) ?? emptyCatalog;
}

export function loadTranslationCatalog(locale: AppLocale): Promise<TranslationCatalog> {
  const cached = catalogCache.get(locale);
  if (cached) return Promise.resolve(cached);

  const pending = pendingLoads.get(locale);
  if (pending) return pending;

  const loader = loaders[locale];
  if (!loader) return Promise.resolve(emptyCatalog);

  const request = loader()
    .then((module) => {
      catalogCache.set(locale, module.default);
      pendingLoads.delete(locale);
      return module.default;
    })
    .catch((error) => {
      pendingLoads.delete(locale);
      throw error;
    });
  pendingLoads.set(locale, request);
  return request;
}
