import { describe, expect, it } from "vitest";
import { brand, formatNotificationTitle } from "./brand";

describe("brand", () => {
  it("defines the approved TomoNode identity and legacy name", () => {
    expect(brand).toEqual({
      productName: "TomoNode",
      productPronunciationJa: "トモノード",
      descriptorEn: "Game Server Manager for Windows",
      descriptorJa: "Minecraft・Palworld対応ゲームサーバー管理アプリ",
      tagline: "Create. Manage. Play Together.",
      taglineJa: "つくる。管理する。みんなで遊ぶ。",
      legacyProductName: "Minecraft Server Hub",
    });
  });

  it("uses TomoNode for Windows notification titles without the legacy name", () => {
    const title = formatNotificationTitle("Server started");

    expect(title).toBe("TomoNode · Server started");
    expect(title).not.toContain(brand.legacyProductName);
  });
});
