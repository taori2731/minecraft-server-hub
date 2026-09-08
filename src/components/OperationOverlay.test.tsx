import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OperationOverlay } from "./OperationOverlay";
import { I18nProvider } from "../lib/i18n";

describe("OperationOverlay", () => {
  it("explains that a long-running operation is still active", () => {
    localStorage.setItem("server-hub:language:v1", "ja");
    render(<I18nProvider><OperationOverlay title="バックアップを作成しています" detail="ファイルを安全に確認しています。" stages={["準備", "検証", "完了"]} /></I18nProvider>);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("バックアップを作成しています");
    expect(status).toHaveTextContent("アプリは動作中です");
    expect(screen.getByLabelText("処理の流れ")).toHaveTextContent("準備検証完了");
  });

  it("never leaves Japanese copy in a non-Japanese loading screen", () => {
    localStorage.setItem("server-hub:language:v1", "es");
    render(<I18nProvider><OperationOverlay title="サーバーを準備しています" detail="公式サーバーファイルを確認しています。" stages={["ダウンロード", "安全確認", "ファイル作成"]} /></I18nProvider>);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("La aplicación sigue funcionando");
    expect(status.textContent).not.toMatch(/[\u3041-\u30fa]/);
  });

  it("keeps deliberate Simplified Chinese loading copy instead of replacing Han characters", () => {
    localStorage.setItem("server-hub:language:v1", "zh-CN");
    render(<I18nProvider><OperationOverlay title="正在准备 Palworld 服务器" detail="正在检查本地 REST 管理连接。" stages={["下载", "安全检查", "创建文件"]} /></I18nProvider>);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("正在准备 Palworld 服务器");
    expect(status).toHaveTextContent("正在检查本地 REST 管理连接");
    expect(screen.getByLabelText("处理进度")).toHaveTextContent("下载安全检查创建文件");
  });

  it("shows measurable download progress and elapsed time", () => {
    localStorage.setItem("server-hub:language:v1", "en");
    render(<I18nProvider><OperationOverlay
      title="Downloading Palworld server"
      detail="Downloading from official SteamCMD."
      stages={["SteamCMD", "Download", "Configuration"]}
      progress={{ percent: 73.2, summary: "3.35 GiB / 4.58 GiB · 88.3 Mbps", elapsed: "05:12" }}
    /></I18nProvider>);

    const progress = screen.getByRole("progressbar", { name: "Download progress" });
    expect(progress).toHaveAttribute("aria-valuenow", "73");
    expect(screen.getByText("73.2%")).toBeInTheDocument();
    expect(screen.getByText("05:12")).toBeInTheDocument();
  });

  it("shows a zero percent start instead of an unknown dash", () => {
    localStorage.setItem("server-hub:language:v1", "en");
    render(<I18nProvider><OperationOverlay
      title="Downloading Palworld server"
      detail="Resolving the official Steam manifest."
      stages={["SteamCMD", "Download", "Configuration"]}
      progress={{ percent: 0, summary: "Downloading Palworld server", elapsed: "00:01" }}
    /></I18nProvider>);

    const progress = screen.getByRole("progressbar", { name: "Download progress" });
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});
