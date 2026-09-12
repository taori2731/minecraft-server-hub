import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import type { RuntimeStatus, ServerProfile } from "../types";
import { ServerFilesTab } from "./FilesPlayersTab";

const server = { id: "files", name: "Files", serverType: "paper", rootPath: "C:\\Server" } as ServerProfile;
const status = { state: "stopped" } as RuntimeStatus;

describe("server file manager", () => {
  it("lists a real backend directory and saves editable text", async () => {
    vi.spyOn(backend, "listServerFiles").mockResolvedValue([{ name: "server.properties", path: "server.properties", kind: "file", sizeBytes: 12, editable: true }]);
    vi.spyOn(backend, "readServerTextFile").mockResolvedValue("motd=Hello");
    const write = vi.spyOn(backend, "writeServerTextFile").mockResolvedValue();
    render(<ServerFilesTab server={server} status={status}/>);
    fireEvent.click(await screen.findByRole("button", { name: /server.properties/ }));
    const editor = await screen.findByRole("textbox");
    fireEvent.change(editor, { target: { value: "motd=Friends" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("files", "server.properties", "motd=Friends"));
  });
});
