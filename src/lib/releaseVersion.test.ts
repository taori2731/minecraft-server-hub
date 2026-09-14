import { describe, expect, it } from "vitest";
import packageManifest from "../../package.json";
import packageLock from "../../package-lock.json";
import cargoManifest from "../../src-tauri/Cargo.toml?raw";
import cargoLock from "../../src-tauri/Cargo.lock?raw";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import { backend } from "./backend";

const releaseVersion = "0.4.4";

describe("release version alignment", () => {
  it("keeps app manifests and the browser demo on the same release candidate", async () => {
    const cargoManifestVersion = cargoManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    const cargoLockVersion = cargoLock.match(/\[\[package\]\]\s*name = "minecraft-server-hub"\s*version = "([^"]+)"/s)?.[1];

    expect([
      packageManifest.version,
      packageLock.version,
      packageLock.packages[""].version,
      cargoManifestVersion,
      cargoLockVersion,
      tauriConfig.version,
    ]).toEqual([releaseVersion, releaseVersion, releaseVersion, releaseVersion, releaseVersion, releaseVersion]);
    expect(await backend.getAppVersion()).toBe(releaseVersion);
    expect((await backend.checkAppUpdate()).currentVersion).toBe(releaseVersion);
  });
});
