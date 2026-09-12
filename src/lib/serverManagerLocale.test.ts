import { describe, expect, it } from "vitest";
import type { AppLocale } from "./i18n";
import { serverManagerText } from "./serverManagerLocale";

const locales: AppLocale[] = ["ja", "en", "zh-CN", "zh-TW", "ko", "es", "de", "fr", "pt-BR"];

describe("server manager translations", () => {
  it("provides every newly added management action in all nine locales", () => {
    for (const locale of locales) {
      expect(serverManagerText(locale, "serverFiles")).toBeTruthy();
      expect(serverManagerText(locale, "accessLog")).toBeTruthy();
      expect(serverManagerText(locale, "backups")).toBeTruthy();
      expect(serverManagerText(locale, "deleteConfirm", { name: "world" })).toContain("world");
    }
  });

  it("does not fall back to Japanese for English management screens", () => {
    expect(serverManagerText("en", "save")).toBe("Save");
    expect(serverManagerText("en", "noBackups")).toBe("No backups yet.");
  });
});
