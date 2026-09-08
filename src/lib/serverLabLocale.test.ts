import { describe, expect, it } from "vitest";
import type { AppLocale } from "./i18n";
import { getServerLabLocaleCatalog, serverLabText } from "./serverLabLocale";

const locales: AppLocale[] = ["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"];
const nonJapaneseLocales: AppLocale[] = ["en", "de", "es", "fr", "ko", "pt-BR"];
const japaneseKana = /[ぁ-んァ-ヶ]/;

describe("server lab locale catalog", () => {
  it("contains the same deliberate keys in all nine languages", () => {
    const expected = Object.keys(getServerLabLocaleCatalog("ja")).sort();
    for (const locale of locales) {
      expect(Object.keys(getServerLabLocaleCatalog(locale)).sort(), locale).toEqual(expected);
    }
  });

  it("does not leave Japanese kana in Latin or Korean catalogs", () => {
    for (const locale of nonJapaneseLocales) {
      for (const [key, value] of Object.entries(getServerLabLocaleCatalog(locale))) {
        expect(japaneseKana.test(value), `${locale}:${key}=${value}`).toBe(false);
      }
    }
  });

  it("formats dynamic player, port, and change values per locale", () => {
    expect(serverLabText("en", "playerCount", { count: 12 })).toBe("12 players");
    expect(serverLabText("ko", "changeCount", { count: 3 })).toBe("변경 3건");
    expect(serverLabText("zh-TW", "portNotice", { port: 19132 })).toContain("19132");
  });
});
