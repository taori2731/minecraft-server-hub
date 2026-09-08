import { beforeEach, describe, expect, it } from "vitest";
import { defaultDeveloperUpdatePreferences, readDeveloperUpdatePreferences, storeDeveloperUpdatePreferences, updateErrorCode } from "./developerUpdate";

describe("Developer Tools update preferences", () => {
  beforeEach(() => localStorage.clear());

  it("enables startup checks by default and stores only the boolean preference", () => {
    expect(readDeveloperUpdatePreferences()).toEqual(defaultDeveloperUpdatePreferences);
    storeDeveloperUpdatePreferences({ autoCheck: false });
    expect(readDeveloperUpdatePreferences()).toEqual({ autoCheck: false });
    expect(localStorage.getItem("msh-developer-tools:update-preferences:v1")).toBe('{"autoCheck":false}');
  });

  it("falls back safely for damaged storage and extracts stable backend error codes", () => {
    localStorage.setItem("msh-developer-tools:update-preferences:v1", "{");
    expect(readDeveloperUpdatePreferences()).toEqual(defaultDeveloperUpdatePreferences);
    expect(updateErrorCode("developer-update-download-failed:network")).toBe("developer-update-download-failed");
    expect(updateErrorCode(new Error("unexpected"))).toBe("developer-update-unknown");
  });
});
