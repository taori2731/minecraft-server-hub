import type { CreateServerInput, ServerType } from "../types";

export interface ServerTemplate {
  id: string; label: string; detail: string; serverType: ServerType; maxMemoryMib: number;
  settings: Partial<CreateServerInput["settings"]>;
}

export const serverTemplates: ServerTemplate[] = [
  { id: "friends", label: "友達と遊ぶ", detail: "ホワイトリスト有効・10人・Paper", serverType: "paper", maxMemoryMib: 4096, settings: { maxPlayers: 10, whitelist: true, difficulty: "easy", pvp: true } },
  { id: "light-mod", label: "軽量Mod", detail: "Fabric・6 GiB・8人", serverType: "fabric", maxMemoryMib: 6144, settings: { maxPlayers: 8, whitelist: true, difficulty: "normal" } },
  { id: "creative", label: "クリエイティブ", detail: "敵なし・コマンド有効", serverType: "vanilla", maxMemoryMib: 4096, settings: { defaultGameMode: "creative", difficulty: "peaceful", allowCommands: true, spawnMonsters: false, pvp: false } },
  { id: "paper", label: "Paperプラグイン", detail: "Paper・20人・通常設定", serverType: "paper", maxMemoryMib: 6144, settings: { maxPlayers: 20, difficulty: "normal", whitelist: true } },
  { id: "vanilla", label: "Vanillaサバイバル", detail: "公式に近い設定", serverType: "vanilla", maxMemoryMib: 4096, settings: { defaultGameMode: "survival", difficulty: "normal", maxPlayers: 10 } },
  { id: "test", label: "テスト用", detail: "2人・低メモリ・コマンド有効", serverType: "paper", maxMemoryMib: 2048, settings: { maxPlayers: 2, whitelist: true, allowCommands: true, viewDistance: 6, simulationDistance: 4 } },
];

export function applyServerTemplate(input: CreateServerInput, template: ServerTemplate): CreateServerInput {
  return { ...input, serverType: template.serverType, minecraftVersion: "", maxMemoryMib: template.maxMemoryMib, settings: { ...input.settings, ...template.settings } };
}
