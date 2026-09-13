import { describe, expect, it } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import installerHooks from "../../src-tauri/windows/installer-hooks.nsh?raw";

describe("Tauri native window branding compatibility", () => {
  it("keeps the display title separate from the installation identity", () => {
    expect(tauriConfig.app.windows[0].title).toBe("TomoNode");
    expect(tauriConfig.productName).toBe("Minecraft Server Hub");
    expect(tauriConfig.identifier).toBe("local.minecraft-server-hub.desktop");
  });

  it("renames only owned Windows shortcuts without changing the installation identity", () => {
    expect(tauriConfig.bundle.windows.nsis.installerHooks).toBe(
      "windows/installer-hooks.nsh",
    );

    expect(installerHooks).toContain('!define TOMONODE_SHORTCUT_NAME "TomoNode"');
    expect(installerHooks).toContain("!macro NSIS_HOOK_POSTINSTALL");
    expect(installerHooks).toContain("!macro NSIS_HOOK_PREUNINSTALL");
    expect(installerHooks).toContain("IsShortcutTarget");
    expect(installerHooks).toContain("${PRODUCTNAME}.lnk");
    expect(installerHooks).toContain("${TOMONODE_SHORTCUT_NAME}.lnk");
    expect(installerHooks).not.toContain("WriteReg");
    expect(installerHooks).not.toContain("DeleteReg");
  });
});
