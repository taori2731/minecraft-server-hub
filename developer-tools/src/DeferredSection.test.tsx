import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DeferredSection } from "./DeferredSection";
import { deferredLabels } from "./deferredLocale";
import { loadLocalePack, locales } from "./locale";

beforeAll(async () => { await Promise.all(locales.map(loadLocalePack)); });

describe("DeferredSection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not render its child until it approaches the viewport", () => {
    let notify: IntersectionObserverCallback = () => undefined;
    const disconnect = vi.fn();
    class ObserverMock {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe() {}
      disconnect = disconnect;
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "800px 0px";
      thresholds = [0];
    }
    vi.stubGlobal("IntersectionObserver", ObserverMock);

    render(<DeferredSection label="Quality" locale="en"><div>Deferred content</div></DeferredSection>);
    expect(screen.queryByText("Deferred content")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading Quality…" })).toBeInTheDocument();

    act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByText("Deferred content")).toBeInTheDocument();
    expect(disconnect).toHaveBeenCalled();
  });

  it("activates a named deferred center when navigation requests it", () => {
    class ObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "800px 0px";
      thresholds = [0];
    }
    vi.stubGlobal("IntersectionObserver", ObserverMock);

    const view = render(<DeferredSection sectionId="quality-center" label="Quality" locale="en"><div>Deferred content</div></DeferredSection>);
    expect(screen.queryByText("Deferred content")).not.toBeInTheDocument();
    expect(document.getElementById("quality-center")).toHaveAttribute("data-deferred-active", "false");

    view.rerender(<DeferredSection forceActive sectionId="quality-center" label="Quality" locale="en"><div>Deferred content</div></DeferredSection>);
    expect(screen.getByText("Deferred content")).toBeInTheDocument();
    expect(document.getElementById("quality-center")).toHaveAttribute("data-deferred-active", "true");
  });

  it("keeps the failure inside a localized recovery boundary", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Broken = () => { throw new Error("chunk failed"); };

    render(<DeferredSection label="品質" locale="ja"><Broken /></DeferredSection>);
    expect(screen.getByRole("alert")).toHaveTextContent("品質を読み込めませんでした");
    expect(screen.getByRole("button", { name: "アプリを再読込" })).toBeInTheDocument();
  });

  it("provides complete deferred-state copy in all nine languages", () => {
    expect(locales).toHaveLength(9);
    const keys = Object.keys(deferredLabels.en).sort();
    for (const locale of locales) {
      expect(Object.keys(deferredLabels[locale]).sort()).toEqual(keys);
      expect(Object.values(deferredLabels[locale]).every((value) => value.trim().length > 0)).toBe(true);
      if (locale !== "en") expect(deferredLabels[locale].loadingHint).not.toBe(deferredLabels.en.loadingHint);
    }
  });
});
