import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

afterEach(cleanup);

describe("最新の紹介サイト", () => {
  it("製品目的と一般公開準備中、非公式表記を表示する", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: /自分のWindows PCを.*ゲームサーバーに/ })).toBeInTheDocument();
    expect(screen.getByText(/Minecraft Java／BedrockとPalworld/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ダウンロード準備中" })).toBeDisabled();
    expect(screen.getAllByText(/公式製品ではありません/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0.3.2/).length).toBeGreaterThan(0);
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
    expect(screen.getAllByText(/一般公開準備中/).length).toBeGreaterThan(0);
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
});
