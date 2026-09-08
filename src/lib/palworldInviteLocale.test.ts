import { describe, expect, it } from "vitest";
import { getPalworldInviteCatalog } from "./palworldInviteLocale";
import type { AppLocale } from "./i18n";

describe("Palworld invite localization", () => {
  it("contains the complete nonempty catalog in all nine languages", () => {
    const locales: AppLocale[] = ["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"];
    const expected = Object.keys(getPalworldInviteCatalog("ja")).sort();
    for (const locale of locales) {
      const catalog = getPalworldInviteCatalog(locale);
      expect(Object.keys(catalog).sort()).toEqual(expected);
      expect(Object.values(catalog).every((value) => value.trim().length > 0)).toBe(true);
      expect(catalog.setupHelp).toContain("{target}");
    }
  });
});
