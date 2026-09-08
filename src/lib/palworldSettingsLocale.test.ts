import { describe, expect, it } from "vitest";
import type { AppLocale } from "./i18n";
import { getPalworldSettingsLocaleCatalog, palworldSettingsText } from "./palworldSettingsLocale";

const locales: AppLocale[] = ["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"];

describe("Palworld settings locale catalog", () => {
  it("contains the complete settings UI in all nine languages", () => {
    const keys = Object.keys(getPalworldSettingsLocaleCatalog("ja")).sort();
    for (const locale of locales) {
      const catalog = getPalworldSettingsLocaleCatalog(locale);
      expect(Object.keys(catalog).sort(), locale).toEqual(keys);
      expect(Object.values(catalog).every((value) => value.trim().length > 0), locale).toBe(true);
    }
  });

  it("interpolates the selected port without changing technical values", () => {
    expect(palworldSettingsText("en", "portSelected", { port: 8211 })).toContain("8211");
    expect(palworldSettingsText("zh-TW", "gamePort")).toContain("UDP");
    expect(palworldSettingsText("de", "restPort")).toContain("TCP");
  });
});
