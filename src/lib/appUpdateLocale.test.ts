import { describe, expect, it } from "vitest";
import type { AppLocale } from "./i18n";
import { appUpdateOfficialFeedText, appUpdateText, getAppUpdateCatalog } from "./appUpdateLocale";

const locales: AppLocale[] = ["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"];
const latin: AppLocale[] = ["en", "de", "es", "fr", "pt-BR"];
const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

describe("app update localization", () => {
  it("has the same complete catalog in all nine languages", () => {
    const keys = Object.keys(getAppUpdateCatalog("en")).sort();
    expect(locales).toHaveLength(9);
    for (const locale of locales) expect(Object.keys(getAppUpdateCatalog(locale)).sort(), locale).toEqual(keys);
  });

  it("does not leak CJK copy into Latin catalogs", () => {
    for (const locale of latin) {
      for (const [key, value] of Object.entries(getAppUpdateCatalog(locale))) expect(cjk.test(value), `${locale}:${key}`).toBe(false);
      expect(cjk.test(appUpdateOfficialFeedText(locale)), `${locale}:officialFeed`).toBe(false);
    }
  });

  it("labels the built-in signed official feed in all nine languages", () => {
    for (const locale of locales) expect(appUpdateOfficialFeedText(locale).trim().length, locale).toBeGreaterThan(10);
  });

  it("interpolates the approved version without changing it", () => {
    expect(appUpdateText("ja", "consent", { version: "0.3.0" })).toContain("0.3.0");
    expect(appUpdateText("de", "startupAvailable", { version: "0.3.0" })).toContain("0.3.0");
  });
});
