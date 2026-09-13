import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { releaseStatus } from "./data/releaseStatus";

afterEach(cleanup);

describe("最新の紹介サイト", () => {
  it("TomoNodeの公開版状態と非公式表記を表示する", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: /自分のWindows PCを.*ゲームサーバーに/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TomoNode トップへ" })).toBeInTheDocument();
    expect(screen.getByText(/Minecraft Java／BedrockとPalworld/)).toBeInTheDocument();
    const downloadLinks = screen.getAllByRole("link", { name: "0.4.3をダウンロード" });
    expect(downloadLinks).toHaveLength(3);
    expect(downloadLinks.filter((link) => link.getAttribute("href") === releaseStatus.installerUrl)).toHaveLength(2);
    expect(screen.getByRole("link", { name: "GitHub Release" })).toHaveAttribute("href", releaseStatus.releaseUrl);
    expect(screen.getByRole("link", { name: "latest.json" })).toHaveAttribute("href", releaseStatus.manifestUrl);
    expect(screen.getByRole("link", { name: "隣接.sig" })).toHaveAttribute("href", releaseStatus.signatureUrl);
    expect(screen.getByRole("link", { name: "SHA256SUMS.txt" })).toHaveAttribute("href", releaseStatus.checksumUrl);
    expect(screen.getAllByText(/公式製品・提携製品ではありません/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Minecraft、Mojang Studios、Microsoft、Palworld、Pocketpair、Valve/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0\.3\.2|一般公開準備中|仮称/)).not.toBeInTheDocument();
  });

  it("既存のヒーロー画像を0.4.1の実画面として表示しない", () => {
    render(<App />);
    expect(screen.getByRole("img", { name: "MinecraftとPalworldの複数サーバーを一覧し、自動停止やローカル通知を設定する名称変更前の開発版画面" })).toBeInTheDocument();
    expect(screen.getByText("名称変更前の開発版画面")).toBeInTheDocument();
    expect(screen.queryByText("公開版0.4.1の画面")).not.toBeInTheDocument();
    expect(screen.queryByText("公開版の画面")).not.toBeInTheDocument();
  });

  it("現在実装されているゲーム、サーバー種類、安全機能を掲載する", () => {
    render(<App />);
    for (const name of ["Vanilla", "Paper", "Fabric", "Forge", "NeoForge", "Bedrock", "Palworld"]) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "BedrockとPalworldも、ゲームに合う方法で" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "拡張機能を探して、内容を確認してから追加" })).toBeInTheDocument();
    expect(screen.getByText("いつものメンバーをまとめて反映")).toBeInTheDocument();
    expect(screen.getByText(/ZIPとSHA-256/)).toBeInTheDocument();
    expect(screen.getAllByText(/Windows資格情報マネージャー/).length).toBeGreaterThan(0);
  });

  it("招待とクロスプレイの境界を正直に区別する", () => {
    render(<App />);
    expect(screen.getAllByText("条件付き").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "接続方式を選び、別の家の友達を招待" })).toBeInTheDocument();
    expect(screen.getByText(/Geyser／Floodgate/)).toBeInTheDocument();
    expect(screen.getByText(/アプリ画面は9言語に対応/)).toBeInTheDocument();
  });

  it("確認付きJava準備とローカル処理を正しく説明する", () => {
    render(<App />);
    expect(screen.getByText(/Eclipse Temurinの配布元/)).toBeInTheDocument();
    expect(screen.getByText(/Windows全体のJava設定は変更しません/)).toBeInTheDocument();
    expect(screen.getByText("外部AIへ送らない")).toBeInTheDocument();
    expect(screen.getAllByText(/Modrinthからの拡張導入/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "サーバーラボで、設定を保存前に試算" })).toBeInTheDocument();
  });

  it("無料の安全機能と開発中のPro版を正直に区別する", () => {
    render(<App />);
    expect(screen.getByText("手動バックアップ・復元と変更前の安全バックアップ")).toBeInTheDocument();
    expect(screen.getByText("予約・複数世代バックアップ（基盤実装済み・予約UI開発中）")).toBeInTheDocument();
    expect(screen.getByText("Modパック構成の保存・共有（開発版で利用可能）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "準備中（購入・認証なし）" })).toBeDisabled();
    expect(screen.getByText(/安全機能を有料限定にはしません/)).toBeInTheDocument();
    expect(screen.queryByText("広告非表示")).not.toBeInTheDocument();
  });

  it("署名付き更新と9言語対応を掲載し、一般配布とは区別する", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "更新も、内容を確認してから" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "9言語UI" })).toBeInTheDocument();
    expect(screen.getByText(/署名を検証できない場合は、現在のサーバーまたはアプリを維持/)).toBeInTheDocument();
    expect(screen.getAllByText(/現在公開されているTomoNodeは0\.4\.3/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Release資産のSHA-256は一致/)).toBeInTheDocument();
    expect(screen.getByText(/SmartScreenが警告を表示する可能性/)).toBeInTheDocument();
  });

  it("テーマ切り替えを端末内に保存する", () => {
    render(<App />);
    const toggle = screen.getByRole("button", { name: "ライトテーマに切り替える" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "ダークテーマに切り替える" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem("msh-theme")).toBe("light");
  });

  it("モバイルメニューを開閉できる", () => {
    render(<App />);
    const toggle = screen.getByRole("button", { name: "メニューを開く" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "メニューを閉じる" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "モバイルナビゲーション" })).toHaveClass("is-open");
  });

  it("内部リンクが実在するセクションと公開HTTPS資産を指す", () => {
    render(<App />);
    const internalLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    for (const link of internalLinks) expect(document.getElementById(link.getAttribute("href")!.slice(1))).not.toBeNull();
    const externalLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="https://"]'));
    expect(externalLinks.length).toBeGreaterThan(0);
    expect(externalLinks.every((link) => !/[?#]/.test(new URL(link.href).search + new URL(link.href).hash))).toBe(true);
  });
});
