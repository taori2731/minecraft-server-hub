export const locales = ["ja", "en", "zh-CN", "zh-TW", "ko", "es", "de", "fr", "pt-BR"] as const;
export type Locale = typeof locales[number];

export const languageOptions: Array<{ value: Locale; label: string }> = [
  { value: "ja", label: "日本語" }, { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" }, { value: "zh-TW", label: "繁體中文" },
  { value: "ko", label: "한국어" }, { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" }, { value: "fr", label: "Français" },
  { value: "pt-BR", label: "Português (Brasil)" },
];

export const localeLoaderMessages: Record<Locale, { loading: string; failed: string; retry: string }> = {
  ja: { loading: "言語を読み込んでいます…", failed: "言語を読み込めませんでした。現在の表示を維持します。", retry: "再試行" },
  en: { loading: "Loading language…", failed: "The language could not be loaded. The current view is unchanged.", retry: "Retry" },
  "zh-CN": { loading: "正在加载语言…", failed: "无法加载该语言。当前显示保持不变。", retry: "重试" },
  "zh-TW": { loading: "正在載入語言…", failed: "無法載入該語言。目前顯示保持不變。", retry: "重試" },
  ko: { loading: "언어를 불러오는 중…", failed: "언어를 불러오지 못했습니다. 현재 화면을 유지합니다.", retry: "다시 시도" },
  es: { loading: "Cargando idioma…", failed: "No se pudo cargar el idioma. Se mantiene la vista actual.", retry: "Reintentar" },
  de: { loading: "Sprache wird geladen…", failed: "Die Sprache konnte nicht geladen werden. Die aktuelle Ansicht bleibt erhalten.", retry: "Erneut versuchen" },
  fr: { loading: "Chargement de la langue…", failed: "Impossible de charger la langue. L’affichage actuel est conservé.", retry: "Réessayer" },
  "pt-BR": { loading: "Carregando idioma…", failed: "Não foi possível carregar o idioma. A tela atual será mantida.", retry: "Tentar novamente" },
};

export type Catalog = Record<string, string>;
export type FlatLocaleCopy = Record<string, string>;
export interface LocalePack {
  schemaVersion: 1;
  locale: Locale;
  catalog: Catalog;
  commandPalette: FlatLocaleCopy;
  deferred: FlatLocaleCopy;
  operationsNavigator: FlatLocaleCopy;
  evidence: FlatLocaleCopy;
  review: FlatLocaleCopy;
  quality: Record<string, unknown>;
  bundle: FlatLocaleCopy;
  cargoApplicability: FlatLocaleCopy;
  windowsEvidence: FlatLocaleCopy;
  licenseAudit: FlatLocaleCopy;
  releaseEvidence: FlatLocaleCopy;
}

const packLoaders: Record<Locale, () => Promise<unknown>> = {
  ja: () => import("./locale-packs/ja.json").then((module) => module.default),
  en: () => import("./locale-packs/en.json").then((module) => module.default),
  "zh-CN": () => import("./locale-packs/zh-CN.json").then((module) => module.default),
  "zh-TW": () => import("./locale-packs/zh-TW.json").then((module) => module.default),
  ko: () => import("./locale-packs/ko.json").then((module) => module.default),
  es: () => import("./locale-packs/es.json").then((module) => module.default),
  de: () => import("./locale-packs/de.json").then((module) => module.default),
  fr: () => import("./locale-packs/fr.json").then((module) => module.default),
  "pt-BR": () => import("./locale-packs/pt-BR.json").then((module) => module.default),
};

const packCache = new Map<Locale, LocalePack>();
const pendingPacks = new Map<Locale, Promise<LocalePack>>();
const requiredSections = ["catalog", "commandPalette", "deferred", "operationsNavigator", "evidence", "review", "quality", "bundle", "cargoApplicability", "windowsEvidence", "licenseAudit", "releaseEvidence"] as const;

export function validateLocalePack(value: unknown, expectedLocale: Locale): LocalePack {
  if (!value || typeof value !== "object") throw new Error(`locale-pack:${expectedLocale}:invalid-root`);
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || candidate.locale !== expectedLocale) throw new Error(`locale-pack:${expectedLocale}:identity-mismatch`);
  for (const section of requiredSections) {
    const content = candidate[section];
    if (!content || typeof content !== "object" || Array.isArray(content) || Object.keys(content).length === 0) {
      throw new Error(`locale-pack:${expectedLocale}:invalid-${section}`);
    }
  }
  const catalog = candidate.catalog as Record<string, unknown>;
  if (typeof catalog.appName !== "string" || typeof catalog.language !== "string" || Object.keys(catalog).length < 100) {
    throw new Error(`locale-pack:${expectedLocale}:incomplete-catalog`);
  }
  return candidate as unknown as LocalePack;
}

export async function loadLocalePack(locale: Locale): Promise<LocalePack> {
  const cached = packCache.get(locale);
  if (cached) return cached;
  const pending = pendingPacks.get(locale);
  if (pending) return pending;
  const request = packLoaders[locale]().then((value) => {
    const pack = validateLocalePack(value, locale);
    packCache.set(locale, pack);
    return pack;
  }).finally(() => pendingPacks.delete(locale));
  pendingPacks.set(locale, request);
  return request;
}

export function preloadLocalePack(locale: Locale): void {
  void loadLocalePack(locale).catch(() => undefined);
}

export function getLocalePack(locale: Locale): LocalePack {
  const pack = packCache.get(locale);
  if (!pack) throw new Error(`locale-pack:${locale}:not-loaded`);
  return pack;
}

export const text = (locale: Locale, key: keyof Catalog) => getLocalePack(locale).catalog[key] ?? String(key);

export const detectLocale = (): Locale => {
  const stored = typeof localStorage === "undefined" ? "" : localStorage.getItem("msh-developer-tools:locale") ?? "";
  if (locales.includes(stored as Locale)) return stored as Locale;
  const candidate = typeof navigator === "undefined" ? "en" : navigator.language;
  if (candidate.toLowerCase().startsWith("zh-tw") || candidate.toLowerCase().startsWith("zh-hk")) return "zh-TW";
  if (candidate.toLowerCase().startsWith("zh")) return "zh-CN";
  return locales.find((locale) => candidate.toLowerCase().startsWith(locale.split("-")[0].toLowerCase())) ?? "en";
};
