import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import { I18nProvider } from "../lib/i18n";
import { AppUpdatePanel } from "./AppUpdatePanel";

describe("AppUpdatePanel", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("server-hub:language:v1", "en");
  });

  it("shows the active official feed and checks only when the user presses the button", async () => {
    const notify = vi.fn();
    const fail = vi.fn();
    render(<I18nProvider><AppUpdatePanel hasActiveServers={false} notify={notify} fail={fail} /></I18nProvider>);
    expect(screen.getByText("Keep the app up to date")).toBeInTheDocument();
    expect(screen.getByText(/signed official update feed is active/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Update feed URL")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("This app is up to date.")).toBeInTheDocument();
    expect(fail).not.toHaveBeenCalled();
  });

  it("rejects an insecure feed before contacting the backend", () => {
    const fail = vi.fn();
    render(<I18nProvider><AppUpdatePanel hasActiveServers={false} notify={vi.fn()} fail={fail} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Developer options" }));
    fireEvent.change(screen.getByLabelText("Update feed URL"), { target: { value: "http://example.com/latest.json" } });
    expect(screen.getByText("Enter a credential-free HTTPS update feed URL.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(fail).toHaveBeenCalledWith("Enter a credential-free HTTPS update feed URL.");
  });

  it("downloads only after the user approves the exact version", async () => {
    const originalDesktop = backend.isDesktop;
    backend.isDesktop = true;
    const check = vi.spyOn(backend, "checkAppUpdate").mockResolvedValue({ configured: true, currentVersion: "0.3.1", available: true, version: "0.3.2", notes: "Signed release" });
    const install = vi.spyOn(backend, "installAppUpdate").mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<I18nProvider><AppUpdatePanel hasActiveServers={false} notify={vi.fn()} fail={vi.fn()} /></I18nProvider>);
      fireEvent.click(screen.getByRole("button", { name: "Developer options" }));
      fireEvent.change(screen.getByLabelText("Update feed URL"), { target: { value: "https://example.com/latest.json" } });
      fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
      expect(await screen.findByText(/0\.3\.2/)).toBeInTheDocument();
      expect(check).toHaveBeenCalledWith("https://example.com/latest.json");

      fireEvent.click(screen.getByRole("button", { name: "Download, verify, and update" }));
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(install).not.toHaveBeenCalled();

      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: "Download, verify, and update" }));
      await waitFor(() => expect(install).toHaveBeenCalledWith("0.3.2", "https://example.com/latest.json"));
    } finally {
      backend.isDesktop = originalDesktop;
    }
  });

  it("returns a custom feed to the signed official feed from developer options", () => {
    render(<I18nProvider><AppUpdatePanel hasActiveServers={false} notify={vi.fn()} fail={vi.fn()} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Developer options" }));
    const feed = screen.getByLabelText("Update feed URL");
    fireEvent.change(feed, { target: { value: "https://example.com/latest.json" } });
    expect(screen.getByText("A custom signed update feed is active.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use official feed" }));
    expect(feed).toHaveValue("");
    expect(screen.getByText(/signed official update feed is active/i)).toBeInTheDocument();
  });
});
