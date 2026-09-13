import { describe, expect, it } from "vitest";
import { brand } from "./brand";
import { getRebrandCopy } from "./rebrandLocale";
import type { AppLocale } from "./i18n";

const locales: readonly AppLocale[] = ["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"];
const thirdPartyNames = ["Minecraft", "Mojang", "Microsoft", "Palworld", "Pocketpair", "Valve"];
const serverWords: Record<AppLocale, string> = { ja: "サーバー", en: "servers", de: "Server", es: "servidores", fr: "serveurs", ko: "서버", "pt-BR": "servidores", "zh-CN": "服务器", "zh-TW": "伺服器" };
const signatureWords: Record<AppLocale, string> = { ja: "更新署名", en: "signature", de: "updatesignatur", es: "firma", fr: "signature", ko: "서명", "pt-BR": "assinatura", "zh-CN": "签名", "zh-TW": "簽章" };

describe("TomoNode rebrand copy", () => {
  it.each(locales)("has complete desktop copy for %s", (locale) => {
    const copy = getRebrandCopy(locale);
    expect(copy.migrationTitle).toContain(brand.productName);
    expect(copy.migrationTitle).toContain(brand.legacyProductName);
    expect(copy.migrationBody).toContain(serverWords[locale]);
    expect(copy.migrationDistribution.toLocaleLowerCase()).toContain(signatureWords[locale].toLocaleLowerCase());
    expect(copy.nonAffiliationBody).toContain(brand.productName);
    for (const name of thirdPartyNames) expect(copy.nonAffiliationBody).toContain(name);
    expect(copy.uninstallDescription).toContain(brand.productName);
    expect(copy.uninstallConfirm).toContain(brand.productName);
    expect(copy.exitConfirm).toContain(brand.productName);
  });

  it("keeps the required Japanese migration sentence exact", () => {
    expect(getRebrandCopy("ja").migrationTitle).toBe(`${brand.legacyProductName}は${brand.productName}になりました`);
  });
});
