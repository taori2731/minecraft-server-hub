import { describe, expect, it } from "vitest";
import { languageOptions, type AppLocale } from "./i18n";
import { palworldDeleteWarning } from "./deleteServerLocale";

describe("Palworld delete localization", () => {
  it("provides the credential warning in every supported language", () => {
    const locales = languageOptions.map(({ value }) => value).filter((value): value is AppLocale => value !== "system");
    expect(locales).toHaveLength(9);
    for (const locale of locales) expect(palworldDeleteWarning(locale).trim()).not.toBe("");
  });
});
