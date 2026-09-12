import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { GlobalSearch, TemplatesPage } from "./HubPages";
import type { ServerProfile } from "../types";

const server = { id: "one", name: "Friends", serverType: "paper", minecraftVersion: "1.21.4" } as ServerProfile;

describe("hub navigation pages", () => {
  it("searches real navigation targets and opens the selected server", () => {
    localStorage.setItem("server-hub:language:v1", "en");
    const open = vi.fn();
    render(<I18nProvider><GlobalSearch servers={[server]} onOpenServer={open} onSection={vi.fn()} onSettings={vi.fn()}/></I18nProvider>);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Friends" } });
    fireEvent.click(screen.getByRole("button", { name: /Friends/ }));
    expect(open).toHaveBeenCalledWith("one");
  });

  it("connects a template card to the creation action", () => {
    localStorage.setItem("server-hub:language:v1", "ja");
    const use = vi.fn();
    render(<I18nProvider><TemplatesPage onUse={use}/></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: /友達と遊ぶ/ }));
    expect(use).toHaveBeenCalledWith("friends");
  });
});
