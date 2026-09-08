import { describe, expect, it } from "vitest";
import { getLocalePack, loadLocalePack, locales, validateLocalePack, type LocalePack } from "./locale";

describe("dynamic locale packs", () => {
  it("loads and validates every complete locale pack independently", async () => {
    const packs = await Promise.all(locales.map(loadLocalePack));
    expect(packs).toHaveLength(9);
    const english = getLocalePack("en");
    const sectionNames = ["catalog", "deferred", "evidence", "review", "bundle", "cargoApplicability", "windowsEvidence", "licenseAudit"] as const;
    for (const [index, pack] of packs.entries()) {
      expect(pack.locale).toBe(locales[index]);
      expect(pack.schemaVersion).toBe(1);
      for (const section of sectionNames) {
        expect(Object.keys(pack[section]).sort()).toEqual(Object.keys(english[section]).sort());
        expect(Object.values(pack[section]).every((value) => value.trim().length > 0)).toBe(true);
      }
      expect(Object.keys(pack.quality).sort()).toEqual(Object.keys(english.quality).sort());
    }
  });

  it("returns the cached object on repeated loads", async () => {
    const first = await loadLocalePack("en");
    const second = await loadLocalePack("en");
    expect(second).toBe(first);
  });

  it("rejects malformed or incorrectly identified packs", () => {
    expect(() => validateLocalePack({}, "en")).toThrow("identity-mismatch");
    const valid = getLocalePack("en");
    expect(() => validateLocalePack({ ...valid, locale: "ja" }, "en")).toThrow("identity-mismatch");
    expect(() => validateLocalePack({ ...valid, catalog: {} }, "en")).toThrow("invalid-catalog");
    const incomplete = { ...valid, catalog: { ...valid.catalog, appName: 7 } } as unknown as LocalePack;
    expect(() => validateLocalePack(incomplete, "en")).toThrow("incomplete-catalog");
  });
});
