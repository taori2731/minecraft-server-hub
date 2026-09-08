import { beforeEach, describe, expect, it } from "vitest";
import { detectServerIconMime, prepareServerIcon, readServerIcons, storeServerIcons, withServerIcon } from "./serverIcons";

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("server icon storage", () => {
  beforeEach(() => localStorage.clear());

  it("keeps only safe raster data URLs for valid server IDs", () => {
    localStorage.setItem("server-hub:server-icons:v1", JSON.stringify({
      "demo-paper": tinyPng,
      "bad id": tinyPng,
      "unsafe-svg": "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=",
      "remote-url": "https://example.invalid/icon.png",
    }));
    expect(readServerIcons()).toEqual({ "demo-paper": tinyPng });
  });

  it("adds, persists and removes an icon independently per server", () => {
    const added = withServerIcon({}, "demo-paper", tinyPng);
    storeServerIcons(added);
    expect(readServerIcons()).toEqual({ "demo-paper": tinyPng });
    expect(withServerIcon(added, "demo-paper")).toEqual({});
  });

  it("detects PNG, JPEG and WebP from file signatures instead of Windows MIME metadata", () => {
    expect(detectServerIconMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectServerIconMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectServerIconMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(detectServerIconMime(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
  });

  it("rejects a renamed non-image file even when its MIME metadata claims PNG", async () => {
    const fakePng = new File(["not an image"], "renamed.png", { type: "image/png" });
    await expect(prepareServerIcon(fakePng)).rejects.toMatchObject({ code: "type" });
  });
});
