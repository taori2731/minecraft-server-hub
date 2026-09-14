import { describe, expect, it } from "vitest";
import { workspaceAnnouncements } from "./workspaceLocale";
import type { AppLocale } from "./i18n";

const locales: readonly AppLocale[] = ["ja", "en", "zh-CN", "zh-TW", "ko", "es", "de", "fr", "pt-BR"];

describe("workspace release announcements", () => {
  it("publishes the 0.4.4 support-policy update in all nine locales", () => {
    for (const locale of locales) {
      const announcements = workspaceAnnouncements(locale);
      expect(announcements).toHaveLength(3);
      expect(announcements[0].title).toContain("0.4.4");
      expect(announcements.every((item) => item.body.trim().length > 0)).toBe(true);
    }
  });

  it("states the Japanese release policy without promising payment features", () => {
    const announcements = workspaceAnnouncements("ja");
    expect(announcements[0].body).toContain("料金プラン表示を廃止");
    expect(announcements[1].body).toContain("支援受付は準備中");
    expect(announcements[1].body).toContain("寄付先・価格・決済方法は未定");
    expect(announcements[2].body).toContain("高度な運用は全員が利用できます");
    expect(announcements[2].body).toContain("支援の有無で制限しません");
  });
});
