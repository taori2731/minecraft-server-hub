import { describe, expect, it } from "vitest";
import capability from "../src-tauri/capabilities/default.json";
import generatedCapabilities from "../src-tauri/gen/schemas/capabilities.json";
import config from "../src-tauri/tauri.conf.json";

describe("Developer Tools native identity boundary", () => {
  it("changes only the native window display title", () => {
    expect(config.app.windows[0].title).toBe("TomoNode Developer Tools");
    expect(config.productName).toBe("Minecraft Server Hub Developer Tools");
    expect(config.identifier).toBe("local.minecraft-server-hub.developer-tools");
    expect(config.version).toBe("0.3.1");
  });

  it("keeps the generated capability description synchronized with its source", () => {
    const generatedCapability = generatedCapabilities["main-capability"];
    expect(generatedCapability.description).toBe(capability.description);
    expect(generatedCapability.identifier).toBe(capability.identifier);
    expect(generatedCapability.windows).toEqual(capability.windows);
    expect(generatedCapability.permissions).toEqual(capability.permissions);
  });
});
