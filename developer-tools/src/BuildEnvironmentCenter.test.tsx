import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BuildEnvironmentCenter } from "./BuildEnvironmentCenter";
import { buildEnvironmentText } from "./buildEnvironmentLocale";
import { locales } from "./locale";
import type { BuildEnvironmentAudit } from "./types";

afterEach(cleanup);
const audit: BuildEnvironmentAudit = { status: "ready", hostOs: "win32", hostArch: "x64", expectedOs: "win32", expectedArch: "x64", rustTarget: "x86_64-pc-windows-msvc", rustTargetInstalled: true, installedRustTargets: ["x86_64-pc-windows-msvc"], tools: [{ id: "node", command: "node --version", available: true, version: "24.17.0", output: "v24.17.0", error: "" }, { id: "npm", command: "npm --version", available: true, version: "11.6.2", output: "11.6.2", error: "" }, { id: "rustc", command: "rustc --version", available: true, version: "1.98.0", output: "rustc 1.98.0", error: "" }, { id: "cargo", command: "cargo --version", available: true, version: "1.98.0", output: "cargo 1.98.0", error: "" }, { id: "rustup", command: "rustup --version", available: true, version: "1.29.0", output: "rustup 1.29.0", error: "" }], issues: [], error: "" };

describe("BuildEnvironmentCenter", () => {
  it("shows a ready local Windows toolchain", () => {
    render(<BuildEnvironmentCenter audit={audit} locale="en" />);
    expect(screen.getByRole("heading", { name: "Build Environment Center" })).toBeInTheDocument();
    expect(screen.getByText(/Ready to build/)).toBeInTheDocument();
    expect(screen.getByText("24.17.0")).toBeInTheDocument();
    expect(screen.getByText("x86_64-pc-windows-msvc")).toBeInTheDocument();
  });
  it("shows exact missing-tool diagnostics", () => {
    render(<BuildEnvironmentCenter audit={{ ...audit, status: "incomplete", tools: audit.tools.map((tool) => tool.id === "npm" ? { ...tool, available: false, version: "", error: "not found" } : tool), issues: ["missing-tool:npm"] }} locale="ja" />);
    expect(screen.getByText(/不足しているツールがあります/)).toBeInTheDocument();
    expect(screen.getByText("missing-tool:npm")).toBeInTheDocument();
  });
  it("keeps complete non-empty copy for all nine locales", () => {
    const keys = Object.keys(buildEnvironmentText("en")).sort();
    for (const locale of locales) {
      expect(Object.keys(buildEnvironmentText(locale)).sort()).toEqual(keys);
      expect(Object.values(buildEnvironmentText(locale)).every((value) => value.trim().length > 0)).toBe(true);
    }
  });
});
