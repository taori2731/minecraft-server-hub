import { describe, expect, it } from "vitest";
import { getAdaptiveMemoryLimitMib, getMemoryOptions } from "./memoryOptions";

describe("adaptive memory options", () => {
  it("offers simple 1-16 GiB choices when diagnosis is unavailable", () => {
    expect(getMemoryOptions(undefined, 4096)).toEqual([
      1024, 2048, 3072, 4096, 5120, 6144, 7168, 8192,
      9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384,
    ]);
  });

  it("reduces choices on an 8 GiB PC so Windows keeps enough RAM", () => {
    expect(getAdaptiveMemoryLimitMib(8 * 1024)).toBe(5 * 1024);
    expect(getMemoryOptions(8 * 1024, 4096)).toEqual([1024, 2048, 3072, 4096, 5120]);
  });

  it("offers up to 24 GiB on a 32 GiB PC", () => {
    expect(getAdaptiveMemoryLimitMib(32 * 1024)).toBe(24 * 1024);
    expect(getMemoryOptions(32 * 1024, 4096).at(-1)).toBe(24 * 1024);
  });

  it("offers up to 32 GiB on a 64 GiB PC", () => {
    expect(getAdaptiveMemoryLimitMib(64 * 1024)).toBe(32 * 1024);
    expect(getMemoryOptions(64 * 1024, 4096)).toContain(32 * 1024);
  });

  it("allows extra RAM for larger PCs but keeps the guided limit at 32 GiB", () => {
    expect(getAdaptiveMemoryLimitMib(128 * 1024)).toBe(32 * 1024);
  });

  it("preserves a selected or diagnostic value outside the standard steps", () => {
    expect(getMemoryOptions(8 * 1024, 7168, 7680)).toEqual([
      1024, 2048, 3072, 4096, 5120, 7168, 7680,
    ]);
  });
});
