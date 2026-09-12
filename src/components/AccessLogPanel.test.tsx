import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import { I18nProvider } from "../lib/i18n";
import { AccessLogPanel } from "./AccessLogPanel";

afterEach(() => vi.restoreAllMocks());

describe("AccessLogPanel", () => {
  it("renders backend audit entries and filters them locally", async () => {
    localStorage.setItem("server-hub:language:v1", "en");
    vi.spyOn(backend, "auditLog").mockResolvedValue([
      { id: "1", at: "2026-09-12T00:00:00Z", actor: "local-host", action: "file.write", detail: "path=server.properties" },
      { id: "2", at: "2026-09-12T00:01:00Z", actor: "automation", action: "server.stop", detail: "idle" },
    ]);
    render(<I18nProvider><AccessLogPanel serverId="server" state="stopped"/></I18nProvider>);
    expect(await screen.findByText("file.write")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search actions and details" }), { target: { value: "idle" } });
    expect(screen.getByText("server.stop")).toBeInTheDocument();
    expect(screen.queryByText("file.write")).not.toBeInTheDocument();
  });
});
