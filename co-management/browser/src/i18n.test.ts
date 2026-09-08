import { describe, expect, it } from "vitest";
import {
  coManagementLanguageOptions,
  coManagementMessages,
  detectCoManagementLocale,
  intlLocaleForCoManagement,
  type CoManagementLocale,
} from "./i18n";

const locales: CoManagementLocale[] = ["en", "ja", "zh-CN", "zh-TW", "ko", "es", "de", "fr", "pt-BR"];

describe("co-management locale catalog", () => {
  it("contains a complete visible catalog for all supported languages", () => {
    expect(coManagementLanguageOptions).toHaveLength(10);
    for (const locale of locales) {
      const messages = coManagementMessages[locale];
      expect(messages.pageTitle).not.toBe("");
      expect(messages.joinHeading).not.toBe("");
      expect(messages.serverSettings).not.toBe("");
      expect(messages.errorNetwork).not.toBe("");
      expect(messages.fieldLabels.maxPlayers).not.toBe("");
      expect(messages.fieldSuffixes.expRate).not.toBe("");
      expect(messages.actionLabels["settings.patch"]).not.toBe("");
      expect(messages.enumLabels.difficulty.normal).not.toBe("");
    }
  });

  it("maps browser language tags to the supported locale set", () => {
    expect(detectCoManagementLocale(["ja-JP", "en-US"])).toBe("ja");
    expect(detectCoManagementLocale(["zh-Hant-TW"])).toBe("zh-TW");
    expect(detectCoManagementLocale(["zh-CN"])).toBe("zh-CN");
    expect(detectCoManagementLocale(["pt-PT"])).toBe("pt-BR");
    expect(detectCoManagementLocale(["xx-XX"])).toBe("en");
  });

  it("keeps date formatting locale-aware", () => {
    expect(intlLocaleForCoManagement("ja")).toBe("ja-JP");
    expect(intlLocaleForCoManagement("pt-BR")).toBe("pt-BR");
  });
});
