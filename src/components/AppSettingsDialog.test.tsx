import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../lib/backend";
import { brand } from "../lib/brand";
import { I18nProvider, translate, type AppLocale } from "../lib/i18n";
import { getRebrandCopy } from "../lib/rebrandLocale";
import type { RuntimeStatus } from "../types";
import { AppSettingsDialog } from "./AppSettingsDialog";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("アプリ設定", () => {
  it("固定メンバーを保存し、各ローカル設定ページとWindowsアンインストール導線を表示する", async () => {
    localStorage.setItem("server-hub:language:v1", "ja");
    const server = (await backend.listServers()).find((item) => item.serverType === "paper")!;
    const status: RuntimeStatus = { state: "stopped", playerCount: 0, maxPlayers: 20, memoryUsedMib: 0, uptimeSeconds: 0, address: "127.0.0.1:25565", cpuPercent: 0, tps: null, tpsSupported: false, pingLatencyMs: null };
    vi.spyOn(backend, "listFixedPlayers").mockResolvedValue([]);
    const save = vi.spyOn(backend, "saveFixedPlayer");
    const uninstall = vi.spyOn(backend, "openUninstallSettings").mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const notify = vi.fn();
    const fail = vi.fn();

    render(<I18nProvider><AppSettingsDialog server={server} status={status} servers={[server]} statuses={{ [server.id]: status }} onStatusesChanged={() => undefined} onAppearanceChanged={() => undefined} onClose={() => undefined} notify={notify} fail={fail} /></I18nProvider>);

    fireEvent.change(await screen.findByLabelText("固定メンバーのプレイヤー名"), { target: { value: "TestPlayer" } });
    fireEvent.click(screen.getByRole("button", { name: /メンバーを保存/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: undefined, edition: "java", playerName: "TestPlayer", whitelist: true, operator: false }));
    expect(notify).toHaveBeenCalledWith("いつものメンバーを保存しました");

    fireEvent.click(screen.getByRole("button", { name: "言語" }));
    expect(screen.getByRole("heading", { name: "言語と地域" })).toBeInTheDocument();
    expect(screen.getByLabelText("表示言語")).toHaveValue("ja");

    fireEvent.click(screen.getByRole("button", { name: "プラン" }));
    expect(screen.getByText("無料版とPro／サポーター版")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "準備中（購入できません）" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "プライバシー" }));
    expect(screen.getByText("プライバシーとライセンス")).toBeInTheDocument();
    const privacy = within(document.querySelector(".privacy-list")!);
    expect(privacy.getByText(brand.productName)).toBeInTheDocument();
    expect(privacy.getByText(brand.descriptorJa)).toBeInTheDocument();
    expect(privacy.getByText("診断データ")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "アンインストール" }));
    expect(screen.getByText("アプリをアンインストール")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "アンインストール画面を開く" }));
    await waitFor(() => expect(uninstall).toHaveBeenCalledOnce());
    expect(notify).toHaveBeenCalledWith("Windowsのアンインストール画面を開きました");
    expect(fail).not.toHaveBeenCalled();
  });

  it.each(["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"] as const)("shows the non-affiliation statement with TomoNode in %s", async (locale: AppLocale) => {
    localStorage.setItem("server-hub:language:v1", locale);
    const server = (await backend.listServers()).find((item) => item.serverType === "paper")!;
    const status: RuntimeStatus = { state: "stopped", playerCount: 0, maxPlayers: 20, memoryUsedMib: 0, uptimeSeconds: 0, address: "127.0.0.1:25565", cpuPercent: 0, tps: null, tpsSupported: false, pingLatencyMs: null };
    vi.spyOn(backend, "listFixedPlayers").mockResolvedValue([]);

    render(<I18nProvider><AppSettingsDialog server={server} status={status} servers={[server]} statuses={{ [server.id]: status }} onStatusesChanged={() => undefined} onAppearanceChanged={() => undefined} onClose={() => undefined} notify={() => undefined} fail={() => undefined} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: translate(locale, "privacy") }));

    const privacy = document.querySelector(".privacy-list")!;
    const copy = getRebrandCopy(locale);
    expect(privacy).toHaveTextContent(brand.productName);
    expect(privacy).toHaveTextContent(copy.nonAffiliationTitle);
    expect(privacy).toHaveTextContent(copy.nonAffiliationBody);
    expect(privacy).not.toHaveTextContent("公開前に製品名をMinecraft利用ガイドラインに合わせて再検討します");
  });
});
