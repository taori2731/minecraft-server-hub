import { describe, expect, it } from "vitest";
import { developerBrand } from "./brand";
import { locales } from "./locale";
import { developerUpdateLocales } from "./developerUpdateLocale";

describe("Developer Tools update localization", () => {
  it("contains every D31 field in all nine locales", () => {
    const expectedKeys = Object.keys(developerUpdateLocales.en).sort();
    expect(Object.keys(developerUpdateLocales)).toEqual([...locales]);
    for (const locale of locales) {
      expect(Object.keys(developerUpdateLocales[locale]).sort()).toEqual(expectedKeys);
      for (const value of Object.values(developerUpdateLocales[locale])) expect(value.trim()).not.toBe("");
      expect(developerUpdateLocales[locale].nav).toContain(developerBrand.productName);
      expect(developerUpdateLocales[locale].startupAvailable).toContain(developerBrand.productName);
      expect(developerUpdateLocales[locale].completionDescription).toContain(developerBrand.productName);
      expect(developerUpdateLocales[locale].officialFeedHelp).toContain(developerBrand.consumerProductName);
    }
  });
});
