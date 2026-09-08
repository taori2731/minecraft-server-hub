import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getLocalePack, loadLocalePack, locales } from "./locale";
import { OperationsNavigator } from "./OperationsNavigator";
import { operationsNavigatorText } from "./operationsNavigatorLocale";

beforeAll(async () => { await Promise.all(locales.map(loadLocalePack)); });

describe("OperationsNavigator", () => {
  it("exposes every developer center as an accessible direct action", () => {
    const onNavigate = vi.fn();
    render(<OperationsNavigator locale="en" activeId="developer-overview" onNavigate={onNavigate} />);

    expect(screen.getByRole("navigation", { name: "Developer tools sections" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Readiness" })).toHaveAttribute("aria-current", "location");
    expect(screen.getAllByRole("button")).toHaveLength(11);
    expect(screen.getByRole("button", { name: "Developer Tools update" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Permission security" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build environment" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Handoff" }));
    expect(onNavigate).toHaveBeenCalledWith("release-handoff-center", "Handoff");
  });

  it("contains complete navigation copy in all nine languages", async () => {
    await Promise.all(locales.map(loadLocalePack));
    expect(locales).toHaveLength(9);
    const english = operationsNavigatorText("en");
    const keys = Object.keys(english).sort();
    for (const locale of locales) {
      const copy = operationsNavigatorText(locale);
      expect(Object.keys(copy).sort()).toEqual(keys);
      expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(true);
      expect(getLocalePack(locale).operationsNavigator).toEqual(copy);
      if (locale !== "en") expect(copy.title).not.toBe(english.title);
    }
  });
});
