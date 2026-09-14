import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { releaseStatus } from "./data/releaseStatus";

afterEach(cleanup);

describe("最新の紹介サイト", () => {
  it("TomoNodeの公開版0.4.4状態と非公式表記を表示する", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: /自分のWindows PCを.*ゲームサーバーに/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TomoNode トップへ" })).toBeInTheDocument();
    expect(screen.getByText(/Minecraft Java／BedrockとPalworld/)).toBeInTheDocument();
    const downloadLinks = screen.getAllByRole("link", { name: "0.4.4をダウンロード" });
    expect(downloadLinks).toHaveLength(3);
    expect(downloadLinks.filter((link) => link.getAttribute("href") === releaseStatus.installerUrl)).toHaveLength(2);
    expect(screen.getByRole("link", { name: /^GitHub Release/ })).toHaveAttribute("href", releaseStatus.releaseUrl);
    expect(screen.getByRole("link", { name: /^latest\.json/ })).toHaveAttribute("href", releaseStatus.manifestUrl);
    expect(screen.getByRole("link", { name: /^隣接\.sig/ })).toHaveAttribute("href", releaseStatus.signatureUrl);
    expect(screen.getByRole("link", { name: /^SHA256SUMS\.txt/ })).toHaveAttribute("href", releaseStatus.checksumUrl);
    expect(releaseStatus.version).toBe("公開版 0.4.4");
    expect(releaseStatus.download).toBe("公開済み");
    expect(releaseStatus.latestFeedVersion).toBe("0.4.4");
    expect(releaseStatus.publicationVerification).toBe("公開再取得検証PASS");
    expect(releaseStatus.releaseUrl).toBe("https://github.com/taori2731/minecraft-server-hub-releases/releases/tag/v0.4.4");
    expect(releaseStatus.installerUrl).toBe("https://github.com/taori2731/minecraft-server-hub-releases/releases/download/v0.4.4/Minecraft.Server.Hub_0.4.4_x64-setup.exe");
    expect(releaseStatus.sha256).toBe("DAB420310270952869E5965B60B57E9D48C2462CFF25E30A2041AD1BB9D93EEB");
    expect(releaseStatus.signatureMethod).toMatch(/公開検証済み/);
    expect(releaseStatus.authenticodeStatus).toBe("Windows Authenticodeは未署名（NotSigned）");
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

  it("全員無料の機能と任意支援の候補を正直に区別する", () => {
    render(<App />);
    expect(screen.getByText("手動バックアップ・復元と変更前の安全バックアップ")).toBeInTheDocument();
    expect(screen.getByText("予約・複数世代バックアップ（基盤実装済み・予約UI開発中）")).toBeInTheDocument();
    for (const feature of ["複数サーバーの一括起動・安全停止・再起動（全員利用可）", "長期操作履歴と検索（全員利用可）", "CPU・メモリ・TPSのしきい値監視（全員利用可）", "Modパック構成の保存・共有（全員利用可）", "追加アクセント・カスタム色・アイコン密度（全員利用可）"]) expect(screen.getByText(feature)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "基本・安全・高度な運用は全員無料" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "TomoNodeを応援" })).toBeInTheDocument();
    expect(screen.getByText("将来追加する新機能の先行体験（候補）")).toBeInTheDocument();
    expect(screen.getByText("開発中機能へのフィードバック参加（候補）")).toBeInTheDocument();
    expect(screen.getByText("限定外観（候補）")).toBeInTheDocument();
    expect(screen.getAllByText("支援受付は準備中").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/支援停止後も、安全機能、バックアップと復元、サーバーデータへのアクセスを制限しません/).length).toBeGreaterThan(0);
    const bodyText = document.body.textContent ?? "";
    for (const oldText of ["無料版", "Pro版", "価格未定", "準備中（購入・認証なし）", "優先サポート"]) expect(bodyText).not.toContain(oldText);
    expect(screen.queryByText("広告非表示")).not.toBeInTheDocument();
  });

  it("署名付き更新と9言語対応を掲載し、公開検証と実更新確認を区別する", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "更新も、内容を確認してから" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "9言語UI" })).toBeInTheDocument();
    expect(screen.getByText(/署名を検証できない場合は、現在のサーバーまたはアプリを維持/)).toBeInTheDocument();
    expect(screen.getAllByText(/0\.4\.3からの実アプリ更新・再起動確認は未実施\/継続中/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/公開再取得検証PASS/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Windows Authenticodeは未署名（NotSigned）/).length).toBeGreaterThan(0);
    expect(screen.getByText(/SmartScreenが警告を表示する可能性/)).toBeInTheDocument();
    expect(screen.getByText("Minecraft.Server.Hub_0.4.4_x64-setup.exe")).toBeInTheDocument();
    expect(screen.getByText("DAB420310270952869E5965B60B57E9D48C2462CFF25E30A2041AD1BB9D93EEB")).toBeInTheDocument();
    const bodyText = document.body.textContent ?? "";
    for (const oldReleaseText of ["公開予定 0.4.4", "公開前（候補資産）", "0.4.4候補を確認", "GitHub公開前です", "公開前に記録した候補資産"]) expect(bodyText).not.toContain(oldReleaseText);
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
