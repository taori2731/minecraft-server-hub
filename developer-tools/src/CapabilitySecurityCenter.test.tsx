import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CapabilitySecurityCenter } from "./CapabilitySecurityCenter";
import { capabilitySecurityText } from "./capabilitySecurityLocale";
import { locales } from "./locale";
import type { CapabilitySecurityAudit } from "./types";

afterEach(cleanup);
const audit: CapabilitySecurityAudit = { status: "verified", capabilityPath: "developer-tools/src-tauri/capabilities/default.json", configurationPath: "developer-tools/src-tauri/tauri.conf.json", capabilityIdentifier: "main-capability", appIdentifier: "local.minecraft-server-hub.developer-tools", windows: ["main"], configuredWindows: ["main"], permissions: ["core:default", "dialog:allow-open", "dialog:allow-save"], allowedPermissions: ["core:default", "dialog:allow-open", "dialog:allow-save"], csp: "default-src 'self'", cspDirectives: [{ name: "default-src", values: ["'self'"] }], issues: [] };

describe("CapabilitySecurityCenter", () => {
  it("shows verified least-privilege evidence", () => {
    render(<CapabilitySecurityCenter audit={audit} locale="en" />);
    expect(screen.getByRole("heading", { name: "Capability Security Center" })).toBeInTheDocument();
    expect(screen.getByText(/Least privilege verified/)).toBeInTheDocument();
    expect(screen.getByText("dialog:allow-save")).toBeInTheDocument();
  });
  it("shows exact violations", () => {
    render(<CapabilitySecurityCenter audit={{ ...audit, status: "violation", issues: ["unexpected-permission:shell:allow-execute"] }} locale="ja" />);
    expect(screen.getByText(/許可範囲の拡大を検出/)).toBeInTheDocument();
    expect(screen.getByText("unexpected-permission:shell:allow-execute")).toBeInTheDocument();
  });
  it("contains complete non-empty copy for all nine locales", () => {
    const expected = Object.keys(capabilitySecurityText("en")).sort();
    for (const locale of locales) {
      const localized = capabilitySecurityText(locale);
      expect(Object.keys(localized).sort()).toEqual(expected);
      expect(Object.values(localized).every((value) => value.trim().length > 0)).toBe(true);
    }
  });
});
