export const brand = {
  productName: "TomoNode",
  productPronunciationJa: "トモノード",
  descriptorEn: "Game Server Manager for Windows",
  descriptorJa: "Minecraft・Palworld対応ゲームサーバー管理アプリ",
  tagline: "Create. Manage. Play Together.",
  taglineJa: "つくる。管理する。みんなで遊ぶ。",
  legacyProductName: "Minecraft Server Hub",
} as const;

export function formatNotificationTitle(title: string) {
  return `${brand.productName} · ${title}`;
}
