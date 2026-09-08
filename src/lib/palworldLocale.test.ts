import { describe, expect, it } from "vitest";
import type { AppLocale } from "./i18n";
import { getPalworldLocaleCatalog, palworldText, type PalworldLocaleKey } from "./palworldLocale";

const locales: AppLocale[] = ["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"];
const latinLocales: AppLocale[] = ["en", "de", "es", "fr", "pt-BR"];
const cjkOrHangul = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const wizardLocaleKeys = [
  "diagnosisFirstTitle", "diagnosisRepeatTitle", "diagnosisDescription", "diagnoseButton", "diagnoseAgainButton", "diagnosingButton",
  "diagnosisLoadingTitle", "diagnosisLoadingDescription", "recommendedMemoryLabel", "recommendedMemoryValue", "recommendedPlayersLabel",
  "recommendedPlayersValue", "recommendedStorageLabel", "recommendedStorageValue", "steamCmdGuideLabel", "downloadMethodLabel", "executableLabel",
  "transportLabel", "restApiLabel", "restPortLabel", "portCheckingHint", "portCheckFailedPrefix", "autoSelectButton", "backupDescription", "basicInfoTitle", "wizardKicker", "closeWizardLabel", "progressLabel",
  "gameServerLegend", "minecraftOptionDescription", "saveFolderLabel", "saveFolderPlaceholder", "selectFolderButton", "cpuCoresThreadsValue",
  "availableMemoryLabel", "totalMemoryValue", "freeStorageLabel", "storageUnavailable", "applyRecommendation", "recommendationApplied", "capacityNote",
  "skipDiagnosis", "serverNameLabel", "serverNamePlaceholder", "saveDestinationLabel", "saveDestinationPlaceholder", "saveDestinationHelp",
  "versionLoadingTitle", "versionLoadingDescription", "reviewServerLabel", "reviewConfigurationLabel", "reviewSaveDestinationLabel", "cancelButton",
  "backButton", "nextButton", "warningAvailableMemoryUnder4", "warningTotalMemoryUnder16", "warningAvailableMemoryUnder12",
  "warningStorageUnder10", "warningStorageUnavailable",
] as const satisfies readonly PalworldLocaleKey[];

describe("Palworld locale catalog", () => {
  it("contains the same deliberate keys in all nine languages", () => {
    const expected = Object.keys(getPalworldLocaleCatalog("ja")).sort();

    expect(locales).toHaveLength(9);
    for (const locale of locales) {
      expect(Object.keys(getPalworldLocaleCatalog(locale)).sort(), locale).toEqual(expected);
    }
  });

  it("does not leave Japanese, Chinese, or Korean text in Latin-language catalogs", () => {
    for (const locale of latinLocales) {
      for (const [key, value] of Object.entries(getPalworldLocaleCatalog(locale))) {
        expect(cjkOrHangul.test(value), `${locale}:${key}=${value}`).toBe(false);
      }
    }
  });

  it("keeps the safety-critical values visible in every language", () => {
    const requiredTokens = ["SteamCMD", "2394010", "6 GiB", "UDP 8211", "127.0.0.1", "/save", "/shutdown"];

    for (const locale of locales) {
      const catalogText = Object.values(getPalworldLocaleCatalog(locale)).join("\n");
      for (const token of requiredTokens) {
        expect(catalogText, `${locale} must retain ${token}`).toContain(token);
      }
    }
  });

  it("keeps the REST exposure warning and player-IP handling distinct from ordinary status text", () => {
    const firewallTerms: Record<AppLocale, string> = {
      ja: "ファイアウォール",
      en: "Windows Firewall",
      de: "Windows-Firewall",
      es: "Firewall de Windows",
      fr: "Pare-feu Windows",
      ko: "Windows 방화벽",
      "pt-BR": "Firewall do Windows",
      "zh-CN": "Windows 防火墙",
      "zh-TW": "Windows 防火牆",
    };
    for (const locale of locales) {
      const catalog = getPalworldLocaleCatalog(locale);
      expect(catalog.restNeverExpose.length, `${locale}:restNeverExpose`).toBeGreaterThan(30);
      expect(catalog.restNeverExpose, `${locale}:restNeverExpose firewall guidance`).toContain(firewallTerms[locale]);
      expect(catalog.playerIpHidden, `${locale}:playerIpHidden`).toContain("IP");
      expect(catalog.statusStarting, `${locale}:starting/running`).not.toBe(catalog.statusRunning);
      expect(catalog.statusStopping, `${locale}:stopping/stopped`).not.toBe(catalog.statusStopped);
    }
  });

  it("provides deliberate wizard copy in all nine languages without fallback or mojibake", () => {
    const japanese = getPalworldLocaleCatalog("ja");
    const invariantKeys = new Set<PalworldLocaleKey>(["recommendedStorageValue"]);
    const suspiciousFragments = ["undefined", "[object Object]", "�", "繧", "縺", "蜿", "譁"];
    const leakedJapaneseFragments = ["このPCを診断", "推奨メモリ", "人数の目安", "推奨ストレージ", "SteamCMD公式手順", "実行ファイル", "キャンセル", "戻る", "次へ", "構成"];

    for (const locale of locales) {
      const catalog = getPalworldLocaleCatalog(locale);
      for (const key of wizardLocaleKeys) {
        const value = catalog[key];
        expect(value.trim().length, `${locale}:${key} must be deliberate copy`).toBeGreaterThan(1);
        for (const fragment of suspiciousFragments) {
          expect(value, `${locale}:${key} contains ${fragment}`).not.toContain(fragment);
        }
        if (locale !== "ja" && !invariantKeys.has(key)) {
          expect(value, `${locale}:${key} must not fall back to Japanese`).not.toBe(japanese[key]);
        }
      }
      if (locale !== "ja") {
        const wizardText = wizardLocaleKeys.map((key) => catalog[key]).join("\n");
        for (const fragment of leakedJapaneseFragments) {
          expect(wizardText, `${locale} leaked ${fragment}`).not.toContain(fragment);
        }
      }
      expect(catalog.backupDescription, `${locale}:backup copy`).not.toBe(catalog.safeShutdownDescription);
      const warningText = [catalog.warningAvailableMemoryUnder4, catalog.warningTotalMemoryUnder16, catalog.warningAvailableMemoryUnder12, catalog.warningStorageUnder10].join("\n");
      for (const threshold of ["4 GiB", "16 GiB", "12 GiB", "10 GiB"]) {
        expect(warningText, `${locale} must retain ${threshold}`).toContain(threshold);
      }
    }
  });

  it("returns typed catalog text through the shared helper", () => {
    expect(palworldText("en", "statusRunning")).toBe("Running");
    expect(palworldText("ja", "steamAppId")).toBe("Steam App 2394010");
    expect(palworldText("zh-TW", "gamePortTitle")).toContain("UDP 8211");
    expect(palworldText("en", "cpuCoresThreadsValue", { cores: 8, threads: 16 })).toBe("8 cores / 16 threads");
    expect(palworldText("de", "recommendedPlayersValue", { count: 30 })).toBe("Bis zu 30 Spieler");
  });
});
