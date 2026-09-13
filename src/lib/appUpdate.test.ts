import { beforeEach, describe, expect, it } from "vitest";
import { defaultAppUpdatePreferences, dismissMigrationNotice, hasExistingFrontendState, isValidUpdateEndpoint, readAppUpdatePreferences, shouldShowMigrationNotice, storeAppUpdatePreferences } from "./appUpdate";

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

  it("uses an existing frontend setting and the existing app-update record for the one-time notice", () => {
    expect(hasExistingFrontendState()).toBe(false);
    expect(shouldShowMigrationNotice(true)).toBe(false);
    expect(shouldShowMigrationNotice(true)).toBe(false);

    localStorage.removeItem("server-hub:brand-state:v1");
    localStorage.setItem("server-hub:language:v1", "ja");
    expect(hasExistingFrontendState()).toBe(true);
    expect(shouldShowMigrationNotice(false)).toBe(false);
    expect(shouldShowMigrationNotice(true)).toBe(true);

    dismissMigrationNotice();
    expect(readAppUpdatePreferences()).toEqual({ autoCheck: true, endpoint: "", migrationNoticeDismissed: true });
    expect(shouldShowMigrationNotice(true)).toBe(false);
    expect(localStorage.getItem("server-hub:app-update:v1")).toContain("migrationNoticeDismissed");
  });
});
