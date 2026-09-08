import { describe, expect, it } from "vitest";
import type { ServerProfile } from "../types";
import {
  getDefaultPortForServerType,
  getNetworkProtocolForServerType,
  getRuntimeKindForServerType,
  getServerTabs,
  isPalworldServer,
  PALWORLD_TABS,
} from "./gameAdapter";

describe("game adapter", () => {
  it("keeps Palworld on its native UDP adapter and limited UI surface", () => {
    const profile = { gameKind: "palworld", serverType: "palworld" } as ServerProfile;
    expect(isPalworldServer(profile)).toBe(true);
    expect(getRuntimeKindForServerType("palworld")).toBe("native");
    expect(getNetworkProtocolForServerType("palworld")).toBe("udp");
    expect(getDefaultPortForServerType("palworld")).toBe(8211);
    expect(getServerTabs(profile)).toEqual(PALWORLD_TABS);
    expect(getServerTabs(profile)).toContain("operations");
    expect(getServerTabs(profile)).not.toContain("extensions");
  });

  it("treats legacy profiles without gameKind as Minecraft", () => {
    const profile = { serverType: "paper" } as ServerProfile;
    expect(isPalworldServer(profile)).toBe(false);
    expect(getServerTabs(profile)).toContain("extensions");
  });
});
