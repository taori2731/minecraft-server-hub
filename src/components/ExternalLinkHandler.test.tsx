import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExternalLinkHandler, openExternalUrl } from "./ExternalLinkHandler";

describe("ExternalLinkHandler", () => {
  it("opens every target blank HTTPS link in the browser fallback", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(<><ExternalLinkHandler onError={vi.fn()} /><a href="https://www.minecraft.net/eula" target="_blank">EULA</a></>);
    fireEvent.click(screen.getByRole("link", { name: "EULA" }));
    expect(open).toHaveBeenCalledWith("https://www.minecraft.net/eula", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("rejects non HTTPS destinations", async () => {
    await expect(openExternalUrl("http://example.com/")).rejects.toThrow("HTTPS");
  });
});
