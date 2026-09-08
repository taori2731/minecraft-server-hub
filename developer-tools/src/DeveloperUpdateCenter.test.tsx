import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeveloperUpdateCenter, formatPublishedAt } from "./DeveloperUpdateCenter";
import { developerBackend } from "./developerBackend";

describe("DeveloperUpdateCenter", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(developerBackend, "isDesktop", { value: true, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(developerBackend, "isDesktop", { value: false, configurable: true });
  });

  it("formats native Unix timestamps without showing Invalid Date", () => {
    const rendered = formatPublishedAt("1788254345", "en");
    expect(rendered).not.toContain("Invalid Date");
    expect(rendered).not.toBe("1788254345");
  });

  it("shows the dedicated feed and never enables installation before explicit review", async () => {
    vi.spyOn(developerBackend, "getDeveloperToolsVersion").mockResolvedValue("0.3.0");
    vi.spyOn(developerBackend, "checkDeveloperUpdate").mockResolvedValue({ configured: true, currentVersion: "0.3.0", available: true, version: "0.3.1", notes: "Signed update", endpoint: "https://example.com/developer-tools/latest.json" });
    const install = vi.spyOn(developerBackend, "installDeveloperUpdate").mockResolvedValue();
    render(<DeveloperUpdateCenter locale="en" />);

    expect(screen.getByText("Finalized update foundation")).toBeInTheDocument();
    expect(screen.getByText(/Future work focuses on fixes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("A new version is available · 0.3.1")).toBeInTheDocument();
    const updateButton = screen.getByRole("button", { name: "Download, verify, and update" });
    expect(updateButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed the version/ }));
    expect(updateButton).toBeEnabled();
    fireEvent.click(updateButton);
    await waitFor(() => expect(install).toHaveBeenCalledWith("0.3.1", true));
  });

  it("localizes update failures and states that the current app is retained", async () => {
    vi.spyOn(developerBackend, "getDeveloperToolsVersion").mockResolvedValue("0.3.0");
    vi.spyOn(developerBackend, "checkDeveloperUpdate").mockRejectedValue(new Error("developer-update-check-failed:HTTP 404"));
    render(<DeveloperUpdateCenter locale="ja" />);
    fireEvent.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByText("公式更新フィードを確認できませんでした。")).toBeInTheDocument();
    expect(screen.getAllByText(/現在のアプリを維持します/).length).toBeGreaterThan(0);
  });
});
