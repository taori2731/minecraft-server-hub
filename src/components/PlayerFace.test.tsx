import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { backend } from "../lib/backend";
import { PlayerFace } from "./PlayerFace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PlayerFace", () => {
  it("uses the official UUID when requesting a Java skin", async () => {
    const skin = "data:image/png;base64,iVBORw0KGgo=";
    const request = vi.spyOn(backend, "playerSkin").mockResolvedValue(skin);
    const { container } = render(<PlayerFace playerName="ExamplePlayer" playerId="12345678-1234-4234-8234-123456789abc" />);

    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
    expect(request).toHaveBeenCalledWith("ExamplePlayer", "12345678-1234-4234-8234-123456789abc");
  });

  it("does not permanently cache a failed official skin request", async () => {
    const request = vi.spyOn(backend, "playerSkin")
      .mockRejectedValueOnce(new Error("temporary network error"))
      .mockResolvedValueOnce("data:image/png;base64,iVBORw0KGgo=");
    const first = render(<PlayerFace playerName="RetryPlayer" />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = render(<PlayerFace playerName="RetryPlayer" />);
    await waitFor(() => expect(second.container.querySelectorAll("img")).toHaveLength(2));
    expect(request).toHaveBeenCalledTimes(2);
  });
});
