import { beforeEach, describe, expect, it } from "vitest";
import { customAccentStyle, defaultAppearance, normalizeHexColor, readAppearance, storeAppearance } from "./appearance";

describe("appearance storage", () => {
  beforeEach(() => localStorage.clear());

  it("migrates the legacy preset without losing the selection", () => {
    localStorage.setItem("server-hub:appearance:v1", JSON.stringify({ accent: "amethyst", iconScale: "compact" }));
    expect(readAppearance()).toEqual({ accent: "amethyst", iconScale: "compact", customAccent: defaultAppearance.customAccent });
  });

  it("normalizes short and long hexadecimal colors", () => {
    expect(normalizeHexColor("#abc")).toBe("#AABBCC");
    expect(normalizeHexColor("12ef90")).toBe("#12EF90");
    expect(normalizeHexColor("orange")).toBeNull();
  });

  it("stores a custom color with readable contrast variables", () => {
    const settings = { accent: "custom" as const, iconScale: "comfortable" as const, customAccent: "#ffcc00" };
    storeAppearance(settings);
    expect(readAppearance()).toEqual({ ...settings, customAccent: "#FFCC00" });
    expect(localStorage.getItem("server-hub:appearance:v2")).toContain("#FFCC00");
    expect(customAccentStyle(settings)).toMatchObject({ "--accent": "#FFCC00", "--accent-contrast": "#07110A" });
  });
});
