import { describe, expect, it } from "vitest";
import { backend } from "./backend";

describe("ブラウザ用バックエンド契約", () => {
  it("作成から安全停止・Delete確認削除まで本番と同じ状態遷移を保つ", async () => {
    const base = (await backend.listServers()).find((item) => item.serverType === "paper")!;
    const port = await backend.suggestServerPort(26000);
    const created = await backend.createServer({
      name: "Contract Server",
      parentPath: "C:\\Servers",
      gameKind: "minecraft",
      serverType: "paper",
      minecraftVersion: base.minecraftVersion,
      javaPath: base.javaPath,
      javaMajor: base.javaMajor,
      minMemoryMib: 1024,
      maxMemoryMib: 4096,
      port,
      eulaAccepted: true,
      settings: { ...base.settings, maxPlayers: 8 },
    });

    expect(created.port).toBe(port);
    expect((await backend.status(created.id)).state).toBe("stopped");
    await expect(backend.createServer({ ...created, parentPath: "C:\\Servers", eulaAccepted: true, port } as Parameters<typeof backend.createServer>[0])).rejects.toThrow(/ポート/);

    await backend.start(created.id);
    expect((await backend.status(created.id)).state).toBe("running");
    await backend.sendCommand(created.id, "say contract-test");
    await backend.restart(created.id);
    expect((await backend.status(created.id)).state).toBe("running");

    const backup = await backend.createBackup(created.id, "contract backup");
    expect(backup.displayName).toBe("contract backup");
    await expect(backend.verifyBackup(created.id, backup.id)).resolves.toBe(true);
    await backend.restoreBackup(created.id, backup.id);
    await backend.deleteBackup(created.id, backup.id);

    await backend.updatePlayerAccess({ serverId: created.id, kind: "operators", target: "ContractPlayer", add: true });
    const operator = (await backend.playerAccess(created.id, "operators")).find((entry) => entry.label === "ContractPlayer")!;
    expect(operator.level).toBe(4);
    await backend.updatePlayerAccess({ serverId: created.id, kind: "operators", target: "ContractPlayer", entryId: operator.id, add: false });
    expect(await backend.playerAccess(created.id, "operators")).toEqual([]);

    const member = await backend.saveFixedPlayer({ edition: "java", playerName: "ContractPlayer", whitelist: true, operator: true });
    const edited = await backend.saveFixedPlayer({ id: member.id, edition: "java", playerName: "ContractPlayer", whitelist: true, operator: false });
    expect(edited.id).toBe(member.id);
    expect(edited.operator).toBe(false);
    await backend.deleteFixedPlayer(member.id);

    const profile = await backend.saveModpackProfile(created.id, "Contract profile");
    expect(profile.sourceServerId).toBe(created.id);
    expect((await backend.compareModpackProfile(created.id, profile.id)).missingFromServer).toContain("mod:example-library.jar");
    await backend.exportModpackProfile(profile.id, "C:\\Exports\\profile.json");
    await backend.deleteModpackProfile(profile.id);

    const updated = await backend.applyServerUpdate({ serverId: created.id, targetMinecraftVersion: "1.21.12", targetServerType: "paper", confirmationName: created.name, acceptWarnings: true });
    expect(updated.server.minecraftVersion).toBe("1.21.12");
    expect(updated.backup.kind).toBe("before_update");

    await expect(backend.deleteServer({ serverId: created.id, deleteFiles: false, confirmationText: created.name })).rejects.toThrow(/Delete/);
    await backend.stop(created.id);
    await expect(backend.deleteServer({ serverId: created.id, deleteFiles: true, confirmationText: "Delete" })).resolves.toEqual({ deletedFiles: true, backupPath: "C:\\Backups\\before-server-delete.zip" });
    expect((await backend.listServers()).some((server) => server.id === created.id)).toBe(false);
  });
});
