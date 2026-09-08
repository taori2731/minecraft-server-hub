import { describe, expect, it } from "vitest";
import type { CreateServerInput } from "../types";
import { applyServerTemplate, serverTemplates } from "./templates";

const input: CreateServerInput = { name: "Existing", parentPath: "C:\\Servers", gameKind: "minecraft", serverType: "vanilla", minecraftVersion: "1.21.1", javaPath: "java", javaMajor: 21, minMemoryMib: 1024, maxMemoryMib: 4096, port: 25565, eulaAccepted: false, settings: { defaultGameMode: "survival", difficulty: "easy", maxPlayers: 20, pvp: true, whitelist: false, allowCommands: false, onlineMode: true, allowFlight: false, forceGameMode: false, spawnProtection: 16, requireResourcePack: false, resourcePackUrl: "", resourcePackPrompt: "", worldName: "world", daylightCycle: true, spawnMonsters: true, spawnAnimals: true, viewDistance: 10, simulationDistance: 8 } };

describe("server templates", () => {
  it("returns a new create input without mutating the original", () => {
    const next = applyServerTemplate(input, serverTemplates[2]);
    expect(next).not.toBe(input);
    expect(input.minecraftVersion).toBe("1.21.1");
    expect(input.settings.defaultGameMode).toBe("survival");
    expect(next.minecraftVersion).toBe("");
    expect(next.settings.defaultGameMode).toBe("creative");
  });
});
