import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { backend } from "./lib/backend";

describe("Minecraft Server Hub", () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem("server-hub:language:v1", "ja");
    await backend.start("demo-paper");
    await backend.stop("demo-vanilla");
    await backend.stop("demo-palworld");
  });

  it("renders the primary dashboard and server state", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Survival World" })).toBeInTheDocument();
    expect((await screen.findAllByText("起動中")).length).toBeGreaterThan(0);
    expect(within(document.querySelector(".metric-grid")!).getByText("localhost:25565")).toBeInTheDocument();
    const monitor = screen.getByLabelText("負荷監視");
    expect(await within(monitor).findByText(/^[123] ms$/)).toBeInTheDocument();
    expect(within(monitor).getByText(/^19\.[89]$/)).toBeInTheDocument();
    expect(within(monitor).queryByText("未取得")).not.toBeInTheDocument();
    expect(within(document.querySelector(".titlebar")!).getByRole("button", { name: /新しいサーバー/ })).toBeInTheDocument();
  });

  it("filters servers without changing selection and selects Palworld from the home cards", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    const search = screen.getByRole("searchbox", { name: "サーバー一覧" });
    fireEvent.change(search, { target: { value: "palworld" } });
    const list = within(container.querySelector(".server-list")!);
    expect(list.queryByText("Creative Test")).not.toBeInTheDocument();
    expect(list.getByText("Palworld Friends")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Survival World" })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "no matching server" } });
    expect(list.getByText("0 / 3")).toBeInTheDocument();
    fireEvent.click(list.getByRole("button", { name: "サーバー一覧" }));
    expect(search).toHaveValue("");
    expect(list.getByText("Creative Test")).toBeInTheDocument();
    fireEvent.click(within(container.querySelector(".home-server-grid")!).getByRole("button", { name: /Palworld Friends/ }));
    expect(await screen.findByRole("heading", { name: "Palworld Friends" })).toBeInTheDocument();
    expect(container.querySelector(".sidebar-navigation")).not.toHaveTextContent("プラグイン・Mod");
    fireEvent.click(within(container.querySelector(".home-inspector-links")!).getByRole("button", { name: "コンソール" }));
    expect(await screen.findByText(/ログは読み取り専用/)).toBeInTheDocument();
  });

  it("switches to the Palworld adapter with its dedicated invite and without Minecraft-only tabs or command input", async () => {
    const saveWorld = vi.spyOn(backend, "savePalworldWorld");
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    const minecraftNavigation = screen.getByRole("navigation", { name: "サーバー詳細" });
    fireEvent.click(within(minecraftNavigation).getByRole("button", { name: "ファイル" }));
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Palworld Friends").closest("button")!);
    expect(await screen.findByRole("heading", { name: "Palworld Friends" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "ワールドを保存" })).toBeInTheDocument();

    const navigation = screen.getByRole("navigation", { name: "サーバー詳細" });
    expect(within(navigation).getAllByRole("button")).toHaveLength(5);
    fireEvent.click(within(navigation).getByRole("button", { name: "自動運用" }));
    expect(await screen.findByRole("heading", { name: "0人になったら安全に自動停止" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "更新センター" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("button", { name: "ファイル" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("button", { name: "拡張機能" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "友達を招待" }));
    expect(await screen.findByRole("heading", { name: "Palworldの友達を招待" })).toBeInTheDocument();
    expect(screen.getByText("別の家の友達に渡すアドレス")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "閉じる" })[0]);

    fireEvent.click(within(navigation).getByRole("button", { name: "コンソール" }));
    expect(screen.queryByLabelText("サーバーコマンド")).not.toBeInTheDocument();
    expect(await screen.findByText(/ログは読み取り専用/)).toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "概要" }));
    fireEvent.click(screen.getByRole("button", { name: "起動" }));
    expect(await screen.findByText("サーバーを起動しました")).toBeInTheDocument();
    const save = await screen.findByRole("button", { name: "ワールドを保存" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(saveWorld).toHaveBeenCalledWith("demo-palworld"));
    saveWorld.mockRestore();
  });

  it("refreshes live memory telemetry without waiting for a manual reload", async () => {
    render(<App />);
    await screen.findByText(/^[123] ms$/);
    const meter = screen.getByRole("progressbar", { name: "使用メモリ" });
    const first = meter.getAttribute("aria-valuenow");
    await waitFor(() => expect(meter.getAttribute("aria-valuenow")).not.toBe(first), { timeout: 2_500 });
  });

  it("keeps the app mounted and never requests app exit after a normal server stop", async () => {
    const quitApp = vi.spyOn(backend, "quitApp");
    try {
      render(<App />);
      expect(await screen.findByRole("heading", { name: "Survival World" })).toBeInTheDocument();

      const stop = screen.getByRole("button", { name: "停止" });
      await waitFor(() => expect(stop).toBeEnabled());
      fireEvent.click(stop);

      expect(await screen.findByText("サーバーを安全に停止しました")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Survival World" })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole("button", { name: "起動" })).toBeEnabled());
      expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();
      expect(screen.queryByText("サーバーを安全に停止しています")).not.toBeInTheDocument();
      expect(quitApp).not.toHaveBeenCalled();
    } finally {
      quitApp.mockRestore();
    }
  });

  it("keeps the beginner guide to four choices without the initial backup step", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "次にやること" })).toBeInTheDocument();
    expect(screen.queryByText("最初のバックアップを作る")).not.toBeInTheDocument();
    expect(screen.getByText(/\d+ \/ 4/)).toBeInTheDocument();
    expect(await screen.findByText("ホワイトリストを有効にする")).toBeInTheDocument();
    expect(screen.getByText("自分をOPへ登録する")).toBeInTheDocument();
    expect(screen.getByText("友達の参加方法を確認する")).toBeInTheDocument();
    expect(screen.getByText("0人時の自動停止を選ぶ")).toBeInTheDocument();
  });

  it("opens the creation wizard with PC diagnosis first", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".titlebar")!).getByRole("button", { name: /新しいサーバー/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "PC診断" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "このPCを診断" })).toBeDisabled();
  });

  it("suggests a unique port after the registered demo servers", async () => {
    expect(await backend.suggestServerPort(25565)).toBe(25567);
    expect(await backend.suggestServerPort(8212, "tcp", false)).toBe(8213);
  });

  it("diagnoses the PC and applies the recommendation in the wizard", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".titlebar")!).getByRole("button", { name: /新しいサーバー/ }));
    fireEvent.click(await screen.findByRole("button", { name: "選択" }));
    const diagnoseButton = screen.getByRole("button", { name: "このPCを診断" });
    await waitFor(() => expect(diagnoseButton).toBeEnabled());
    fireEvent.click(diagnoseButton);
    expect(await screen.findByText("6.0 GiB")).toBeInTheDocument();
    expect(screen.getByText("214 GiB")).toBeInTheDocument();
    expect(screen.queryByText(/保存先の空き容量が10 GiB未満/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "この構成をサーバーに反映" }));
    expect(screen.getByRole("button", { name: "推奨値を反映済み" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    expect(screen.getByRole("heading", { name: "テンプレートと基本情報" })).toBeInTheDocument();
  });

  it("offers safe server registration and folder deletion choices", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(screen.getByRole("button", { name: "Creative Testを削除" }));
    expect(await screen.findByRole("heading", { name: "サーバーを削除" })).toBeInTheDocument();
    expect(screen.getByText("一覧から外す（おすすめ）")).toBeInTheDocument();
    expect(screen.getByText("フォルダーも削除")).toBeInTheDocument();
    const deleteButton = screen.getByRole("button", { name: "一覧から外す" });
    const confirmation = screen.getByPlaceholderText("Delete");
    expect(deleteButton).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: "Creative Test" } });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: "delete" } });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: "Delete" } });
    expect(deleteButton).toBeEnabled();
  });

  it("offers manual PC recommendation application for a stopped server", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Creative Test").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "PCを診断" }));
    expect(await screen.findByRole("button", { name: "推奨値を設定へ反映" })).toBeEnabled();
  });

  it("offers backed-up world optimization and guarded regeneration while stopped", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Creative Test").closest("button")!);
    fireEvent.click(within(screen.getByRole("navigation", { name: "サーバー詳細" })).getByRole("button", { name: "設定" }));

    const optimize = await screen.findByRole("button", { name: "バックアップして軽量化" });
    expect(optimize).toBeEnabled();
    fireEvent.click(optimize);
    expect(await screen.findByText(/ワールドの軽量設定を反映しました/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("6")).toBeInTheDocument();
    expect(screen.getByDisplayValue("4")).toBeInTheDocument();

    const regenerate = screen.getByRole("button", { name: "バックアップしてワールドを再生成" });
    expect(regenerate).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "ワールド再生成確認用サーバー名" }), { target: { value: "Creative Test" } });
    expect(regenerate).toBeEnabled();
    fireEvent.click(regenerate);
    expect(await screen.findByText(/次回起動時に新しいワールドを作ります/)).toBeInTheDocument();
  });

  it("opens the read-only existing server import flow", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".titlebar")!).getByRole("button", { name: /既存サーバーを取り込む/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("元のサーバーフォルダーを壊さずに調べます")).toBeInTheDocument();
  });

  it("shows profile, Java, template and update safety tools", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(screen.getByRole("button", { name: "安全ツール" }));
    expect(await screen.findByRole("heading", { name: "Modパックプロファイル" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Java環境" })).toBeInTheDocument();
    expect(screen.getByText("まだ検出していません")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Javaを検出" }));
    expect(await screen.findByText("1件が互換")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "サーバーテンプレート" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "確認付きサーバー更新" })).toBeInTheDocument();
  });

  it("keeps safety features free and labels implemented Pro development features honestly", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".sidebar-footer button")!);
    fireEvent.click(await screen.findByRole("button", { name: "プラン" }));
    expect(await screen.findByRole("heading", { name: "無料版とPro／サポーター版" })).toBeInTheDocument();
    expect(screen.getByText("手動バックアップ・復元と変更前の安全バックアップ")).toBeInTheDocument();
    expect(screen.getByText("予約・複数世代バックアップ（基盤実装済み・予約UI開発中）")).toBeInTheDocument();
    expect(screen.getByText("複数サーバーの一括操作（開発版を利用可能）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "準備中（購入できません）" })).toBeDisabled();
    expect(screen.queryByText("広告非表示")).not.toBeInTheDocument();
  });

  it("operates multiple servers and saves Pro appearance settings", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".sidebar-footer button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Pro運用" }));
    expect(await screen.findByRole("heading", { name: "複数サーバー運用" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "複数サーバーの一括操作" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "高度な監視とアプリ内通知" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "すべて選択" }));
    fireEvent.click(screen.getByRole("button", { name: "一括起動" }));
    expect(await screen.findByText("Creative Test: 起動完了（running）")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "アメジスト" }));
    expect(container.querySelector(".app")).toHaveAttribute("data-accent", "amethyst");
    expect(localStorage.getItem("server-hub:appearance:v2")).toContain("amethyst");

    fireEvent.change(screen.getByRole("textbox", { name: "カラーコード" }), { target: { value: "#ffcc00" } });
    fireEvent.click(screen.getByRole("button", { name: "この色を適用" }));
    expect(container.querySelector(".app")).toHaveAttribute("data-accent", "custom");
    expect(container.querySelector(".app")).toHaveStyle({ "--accent": "#FFCC00", "--accent-contrast": "#07110A" });
    expect(localStorage.getItem("server-hub:appearance:v2")).toContain("#FFCC00");
  });

  it("shows a saved custom server icon in the list and server settings", async () => {
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    localStorage.setItem("server-hub:server-icons:v1", JSON.stringify({ "demo-vanilla": tinyPng }));
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Creative Test").closest("button")!);
    fireEvent.click(within(screen.getByRole("navigation", { name: "サーバー詳細" })).getByRole("button", { name: "設定" }));
    expect(screen.getByRole("img", { name: "サーバーアイコン" })).toHaveAttribute("src", tinyPng);
    expect(screen.getByLabelText("画像を選ぶ")).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
    expect(screen.getByRole("button", { name: "標準に戻す" })).toBeEnabled();
  });

  it("applies an update only after safety review, warning acceptance and server-name confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Creative Test").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "安全ツール" }));
    fireEvent.change(screen.getByDisplayValue("1.21.11"), { target: { value: "1.21.12" } });
    fireEvent.click(screen.getByRole("button", { name: "安全確認" }));
    const apply = await screen.findByRole("button", { name: "バックアップして更新を適用" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "更新確認用サーバー名" }), { target: { value: "Creative Test" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /警告を読み/ }));
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(await screen.findByText("更新を適用しました")).toBeInTheDocument();
  });

  it("prepares a managed Java runtime only after an explicit review", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Creative Test").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "安全ツール" }));
    fireEvent.click(screen.getByRole("button", { name: "必要なJavaを自動で準備" }));
    expect(await screen.findByRole("dialog", { name: "Javaをアプリ内に準備" })).toBeInTheDocument();
    expect(screen.getByText("Eclipse Adoptium")).toBeInTheDocument();
    expect(screen.getByText("GNU GPL v2 with the Classpath Exception")).toBeInTheDocument();
    const install = screen.getByRole("button", { name: "ダウンロードして自動選択" });
    expect(install).toBeDisabled();
    fireEvent.click(screen.getByText("配布元・ライセンス・バージョン・容量・保存先を確認しました").closest(".java-license-consent")!);
    expect(install).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /配布元・ライセンス・バージョン・容量・保存先/ }));
    expect(install).toBeEnabled();
    fireEvent.click(install);
    expect(await screen.findByText(/Javaを安全に準備し、このサーバーへの設定まで完了しました/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Javaをアプリ内に準備" })).not.toBeInTheDocument();
  });

  it("shows expanded server.properties controls", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Creative Test").closest("button")!);
    fireEvent.click(screen.getAllByRole("button", { name: "設定" }).find((button) => button.closest(".tabs"))!);
    expect(screen.getByRole("heading", { name: "サーバー設定" })).toBeInTheDocument();
    expect(screen.getByText("公式アカウント認証")).toBeInTheDocument();
    expect(screen.getByText("飛行を許可")).toBeInTheDocument();
    expect(screen.getByText("ゲームモードを強制")).toBeInTheDocument();
    expect(screen.getByText("リソースパックを必須にする")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("https://example.com/server-pack.zip")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "ワールドタイプ" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "ワールド生成のシード値" })).toBeInTheDocument();
    expect(screen.getByText("村や要塞などを生成")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "1 GiB" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "16 GiB" })).toBeInTheDocument();
  });

  it("shows Modrinth popular items before entering a search query", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(screen.getByRole("button", { name: "拡張機能" }));
    expect(await screen.findByRole("heading", { name: "人気のプラグイン" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /ViaVersion/ })).toBeInTheDocument();
    expect(screen.getAllByText(/ダウンロード数順/).length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "プラグインを検索" })).toHaveValue("");
  });

  it("switches between whitelist, operators and masked ban lists", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "サーバー詳細" })).getByRole("button", { name: "プレイヤー" }));
    expect(await screen.findByRole("heading", { name: "プレイヤー管理" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /権限者/ }));
    expect(await screen.findByText("ServerOwner", undefined, { timeout: 10_000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /BANしたIP/ }));
    expect(await screen.findByText("203.0.***.***", undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByText("203.0.113.42")).not.toBeInTheDocument();
    expect(screen.getByText(/登録済みIPは画面・監査ログで一部を伏せ字/)).toBeInTheDocument();
  });

  it("edits the whitelist before a stopped server is started", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Creative Test").closest("button")!);
    fireEvent.click(within(screen.getByRole("navigation", { name: "サーバー詳細" })).getByRole("button", { name: "プレイヤー" }));
    expect(await screen.findByText("停止中も編集可能")).toBeInTheDocument();
    expect(screen.getByText("起動前に登録できます")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "プレイヤー名" }), { target: { value: "PreStartUser" } });
    const add = screen.getByRole("button", { name: "追加" });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(await screen.findByText("PreStartUser")).toBeInTheDocument();
    expect(await screen.findByText("追加を停止中の設定ファイルへ保存しました")).toBeInTheDocument();
  });

  it("applies fixed members from player management before startup", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Creative Test").closest("button")!);
    fireEvent.click(container.querySelector<HTMLButtonElement>(".sidebar-footer button")!);
    expect(await screen.findByRole("heading", { name: "いつものメンバー" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "固定メンバーのプレイヤー名" }), { target: { value: "FixedFriend" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "権限者" }));
    fireEvent.click(screen.getByRole("button", { name: "メンバーを保存" }));
    expect(await screen.findByText("FixedFriend")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "サーバー詳細" })).getByRole("button", { name: "プレイヤー" }));
    const whitelistApply = await screen.findByRole("button", { name: "ホワイトリストへ反映（1人）" });
    expect(whitelistApply).toBeEnabled();
    fireEvent.click(whitelistApply);
    expect(await screen.findByText(/いつものメンバーをホワイトリストへ反映しました/)).toBeInTheDocument();
    expect(await screen.findByText("FixedFriend")).toBeInTheDocument();
    fireEvent.click(whitelistApply);
    expect(await screen.findByText(/追加0件・登録済み1件/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /権限者/ }));
    const operatorApply = await screen.findByRole("button", { name: "権限者へ反映（1人）" });
    fireEvent.click(operatorApply);
    expect(await screen.findByText(/いつものメンバーを権限者へ反映しました/)).toBeInTheDocument();
    expect(await screen.findByText("FixedFriend")).toBeInTheDocument();
  });

  it("keeps Bedrock fixed members separate and applies them to the Floodgate whitelist", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".sidebar-footer button")!);
    expect(await screen.findByRole("heading", { name: "いつものメンバー" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "統合版専用" }));
    fireEvent.change(screen.getByRole("textbox", { name: "固定メンバーのXboxゲーマータグ" }), { target: { value: "Bedrock Friend" } });
    fireEvent.click(screen.getByRole("button", { name: "メンバーを保存" }));
    expect(await screen.findByText("Bedrock Friend")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "サーバー詳細" })).getByRole("button", { name: "プレイヤー" }));
    fireEvent.click(await screen.findByRole("button", { name: /統合版ホワイトリスト/ }));
    const apply = await screen.findByRole("button", { name: "統合版ホワイトリストへ反映（1人）" });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(await screen.findByText(/いつものメンバーを統合版ホワイトリストへ反映しました/)).toBeInTheDocument();
    expect(await screen.findByText("Bedrock Friend")).toBeInTheDocument();
  });

  it("opens the Windows uninstall settings only after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".sidebar-footer button")!);
    fireEvent.click(await screen.findByRole("button", { name: "アンインストール" }));
    expect(screen.getByRole("heading", { name: "アプリをアンインストール" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "アンインストール画面を開く" }));
    expect(await screen.findByText("Windowsのアンインストール画面を開きました")).toBeInTheDocument();
  });

  it("offers a safe Modrinth catalog with an immediate confirmation dialog", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(screen.getByRole("button", { name: "拡張機能" }));
    expect(screen.getByRole("heading", { name: "プラグインを探して導入" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /ViaVersion/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "プラグインを検索" }), { target: { value: "Essentials" } });
    fireEvent.click(screen.getByRole("button", { name: "検索" }));
    fireEvent.click(await screen.findByRole("button", { name: /Essentials Example/ }));
    expect(await screen.findByText("example.jar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "導入内容を確認" }));
    expect(await screen.findByRole("dialog", { name: "導入内容の確認" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "サーバー停止後に導入" })).toBeDisabled();
    expect(screen.queryByText(/CurseForge/)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "導入内容の確認" })).not.toBeInTheDocument();
  });

  it("installs a catalog item only for a stopped server after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Creative Test").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "拡張機能" }));
    expect(await screen.findByRole("button", { name: /Terralith/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "データパックを検索" }), { target: { value: "Terralith" } });
    fireEvent.click(screen.getByRole("button", { name: "検索" }));
    fireEvent.click(await screen.findByRole("button", { name: /Terralith Example/ }));
    fireEvent.click(await screen.findByRole("button", { name: "導入内容を確認" }));
    const install = await screen.findByRole("button", { name: "バックアップして導入" });
    expect(install).toBeEnabled();
    fireEvent.click(install);
    expect(await screen.findByText("データパックと必須依存 0件をバックアップ後に導入しました")).toBeInTheDocument();
  });

  it("publishes and closes an internet invite from the app", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(screen.getByRole("button", { name: "友達を招待" }));
    const publish = await screen.findByRole("button", { name: "別の家の友達向けに公開" });
    expect(publish).toBeEnabled();
    fireEvent.click(publish);
    expect(await screen.findByText("203.0.113.42:25565")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "公開を終了" }));
    expect(await screen.findByRole("button", { name: "別の家の友達向けに公開" })).toBeEnabled();
  });

  it("places the Bedrock crossplay invite before the regular Java invite", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    const bedrockInvite = screen.getByRole("button", { name: "統合版を招待" });
    const javaInvite = screen.getByRole("button", { name: "友達を招待" });
    expect(bedrockInvite.compareDocumentPosition(javaInvite) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(bedrockInvite);
    expect(await screen.findByRole("heading", { name: "統合版を招待" })).toBeInTheDocument();
    expect(screen.getByText("Java版と統合版をつなぐ")).toBeInTheDocument();
    expect(screen.getByText(/同じワールドへ/)).toBeInTheDocument();
  });

  it("saves a custom invite name and joins host and remote players to the same server", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(screen.getByRole("button", { name: "友達を招待" }));
    expect(await screen.findByRole("heading", { name: "招待名を自分で設定" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "招待名" }), { target: { value: "夜ふかしサバイバル" } });
    fireEvent.change(screen.getByRole("textbox", { name: "独自ドメイン・DDNS（任意）" }), { target: { value: "play.example.net" } });
    fireEvent.click(screen.getByRole("button", { name: "招待設定を保存" }));
    expect(await screen.findByText("招待名と接続名の設定を保存しました")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "別の家の友達向けに公開" }));
    expect(await screen.findByText("play.example.net")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ホスト本人" })).toBeInTheDocument();
    expect(screen.getByText("ホスト本人と別の家の友達は、どちらも同じサーバー・同じワールドに参加します。")).toBeInTheDocument();
  });

  it("shows a public endpoint only after the official tunnel setup is confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(screen.getByRole("button", { name: "友達を招待" }));
    const tunnelHeading = await screen.findByRole("heading", { name: "ポート開放なしで友達を招待" });
    expect(tunnelHeading).toBeInTheDocument();
    const tunnelPanel = within(tunnelHeading.closest("section")!);
    fireEvent.click(tunnelPanel.getByText("詳しい設定と診断"));
    const start = tunnelPanel.getByRole("button", { name: "トンネルを開始" });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "選択" }));
    expect(await screen.findByText("C:\\Program Files\\playit\\playit.exe")).toBeInTheDocument();
    const validate = screen.getByRole("button", { name: "署名を検証" });
    await waitFor(() => expect(validate).toBeEnabled());
    fireEvent.click(validate);
    expect(await screen.findByText("デスクトップ版で公式署名を検証してください")).toBeInTheDocument();
    const firstUseTerms = tunnelPanel.queryByRole("checkbox");
    if (firstUseTerms) fireEvent.click(firstUseTerms);
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(await screen.findByText("ログイン確認待ち")).toBeInTheDocument();
    expect(screen.queryByText("demo.gl.joinmc.link:25565")).not.toBeInTheDocument();
    fireEvent.click(tunnelPanel.getByRole("button", { name: "公式画面でログイン" }));
    expect(await screen.findByText("playit.gg公式ログイン画面を開きました")).toBeInTheDocument();
    fireEvent.click(tunnelPanel.getByRole("button", { name: "公式画面でトンネルを追加" }));
    expect(await screen.findByText("playit.gg公式トンネル設定画面を開きました")).toBeInTheDocument();
    fireEvent.click(tunnelPanel.getByRole("button", { name: "接続先を再確認" }));
    expect(await screen.findByText("demo.gl.joinmc.link:25565")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "接続先をコピー" })).toBeEnabled();
    fireEvent.click(tunnelPanel.getByRole("button", { name: "外部経路をテスト" }));
    expect(await screen.findByText("外部経路: 未確認")).toBeInTheDocument();
    expect(screen.getByText(/ブラウザデモのためTCP接続は実測していません/)).toBeInTheDocument();
    expect(screen.getByText("この結果だけでは別の家からのMinecraft参加を保証しません。")).toBeInTheDocument();
    fireEvent.click(tunnelPanel.getByRole("button", { name: "招待を停止" }));
    expect(await screen.findByText("エージェントを停止しました")).toBeInTheDocument();
  });

  it("confirms, prepares, and publishes the official agent with the beginner flow", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(within(document.querySelector(".server-list")!).getByText("Creative Test").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "友達を招待" }));
    const tunnelHeading = await screen.findByRole("heading", { name: "ポート開放なしで友達を招待" });
    const tunnelPanel = within(tunnelHeading.closest("section")!);
    const firstUseTerms = tunnelPanel.queryByRole("checkbox");
    if (firstUseTerms) fireEvent.click(firstUseTerms);
    const quickPublish = tunnelPanel.getByRole("button", { name: "友達と遊べるようにする" });
    expect(quickPublish).toBeEnabled();
    fireEvent.click(quickPublish);
    expect(await tunnelPanel.findByText("playit.gg公式エージェントを準備")).toBeInTheDocument();
    expect(tunnelPanel.getByText("Developed Methods LLC / GitHub Releases")).toBeInTheDocument();
    expect(tunnelPanel.getByText("BSD-2-Clause")).toBeInTheDocument();
    const install = tunnelPanel.getByRole("button", { name: "公式エージェントを入れて公開を続ける" });
    expect(install).toBeDisabled();
    fireEvent.click(tunnelPanel.getAllByRole("checkbox").at(-1)!);
    expect(install).toBeEnabled();
    fireEvent.click(install);
    expect(await tunnelPanel.findByText("demo.gl.joinmc.link:25566")).toBeInTheDocument();
    expect(await screen.findByText("友達が参加できる状態になりました")).toBeInTheDocument();
  });

  it("cycles the visual theme and persists the selection", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    const button = screen.getByRole("button", { name: "テーマ: system" });
    fireEvent.click(button);
    await waitFor(() => expect(container.querySelector(".app")).toHaveAttribute("data-theme", "dark"));
    expect(localStorage.getItem("server-hub:theme:v1")).toBe("dark");
  });

  it("switches the app shell to English and persists the language", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Survival World" });
    fireEvent.click(screen.getAllByRole("button", { name: "設定" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "言語" }));
    const language = await screen.findByRole("combobox", { name: "表示言語" });
    fireEvent.change(language, { target: { value: "en" } });
    expect(await within(document.querySelector(".titlebar")!).findByRole("button", { name: /New server/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Server details" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Language preference saved");
    expect(localStorage.getItem("server-hub:language:v1")).toBe("en");
  });
});
