import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import { commandPaletteText } from "./commandPaletteLocale";
import { loadLocalePack, locales } from "./locale";

beforeAll(async () => { await Promise.all(locales.map(loadLocalePack)); });

const renderPalette = (overrides: Partial<ComponentProps<typeof CommandPalette>> = {}) => {
  const props: ComponentProps<typeof CommandPalette> = {
    busy: false,
    locale: "en",
    onClose: vi.fn(),
    onFilterChecks: vi.fn(),
    onNavigate: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  render(<CommandPalette {...props} />);
  return props;
};

describe("CommandPalette", () => {
  it("searches and executes a developer-center command from the keyboard", async () => {
    const props = renderPalette();
    const search = screen.getByRole("searchbox", { name: "Search commands" });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: "handoff" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 command");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(props.onNavigate).toHaveBeenCalledWith("release-handoff-center");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("supports arrow selection and safe dashboard actions", async () => {
    const props = renderPalette();
    const search = screen.getByRole("searchbox", { name: "Search commands" });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: "checks" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(props.onFilterChecks).toHaveBeenCalledWith("all");
  });

  it("closes on Escape", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const props = renderPalette();
    const search = screen.getByRole("searchbox", { name: "Search commands" });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.keyDown(search, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    opener.remove();
  });

  it("provides complete command copy in all nine languages", () => {
    const englishKeys = Object.keys(commandPaletteText("en")).sort();
    expect(locales).toHaveLength(9);
    for (const locale of locales) {
      const copy = commandPaletteText(locale);
      expect(Object.keys(copy).sort()).toEqual(englishKeys);
      expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(true);
      if (locale !== "en") expect(copy.title).not.toBe(commandPaletteText("en").title);
    }
  });
});
