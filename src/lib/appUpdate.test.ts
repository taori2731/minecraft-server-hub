import { beforeEach, describe, expect, it } from "vitest";
import { defaultAppUpdatePreferences, isValidUpdateEndpoint, readAppUpdatePreferences, storeAppUpdatePreferences } from "./appUpdate";

describe("app update preferences", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to automatic checks and persists an HTTPS feed", () => {
    expect(readAppUpdatePreferences()).toEqual(defaultAppUpdatePreferences);
    storeAppUpdatePreferences({ autoCheck: false, endpoint: " https://example.com/latest.json " });
    expect(readAppUpdatePreferences()).toEqual({ autoCheck: false, endpoint: "https://example.com/latest.json" });
  });

  it("rejects insecure, credentialed, and fragmented feeds", () => {
    expect(isValidUpdateEndpoint("")).toBe(true);
    expect(isValidUpdateEndpoint("https://example.com/latest.json")).toBe(true);
    expect(isValidUpdateEndpoint("http://example.com/latest.json")).toBe(false);
    expect(isValidUpdateEndpoint("https://user:secret@example.com/latest.json")).toBe(false);
    expect(isValidUpdateEndpoint("https://example.com/latest.json#test")).toBe(false);
  });
});
