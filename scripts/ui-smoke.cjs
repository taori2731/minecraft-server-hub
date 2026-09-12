const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const url = "http://127.0.0.1:1420/";
const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

async function isReady() {
  try { return (await fetch(url)).ok; } catch { return false; }
}

async function waitForServer() {
  for (let index = 0; index < 60; index += 1) {
    if (await isReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite開発サーバーが起動しませんでした");
}

let devServer;
let browser;

(async () => {
  if (!await isReady()) {
    const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
    devServer = spawn(process.execPath, [viteEntry, "--port", "1420", "--host", "127.0.0.1"], { cwd: root, stdio: "ignore", windowsHide: true });
    await waitForServer();
  }
  const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true });
  const page = await browser.newPage({ viewport: { width: 1580, height: 980 } });
  await page.addInitScript(() => localStorage.setItem("server-hub:language:v1", "ja"));
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  await page.getByRole("heading", { name: "Survival World" }).waitFor();
  const globalSearch = page.getByRole("searchbox", { name: "サーバー、プレイヤー、テンプレート、設定を検索…" });
  await globalSearch.fill("Creative Test");
  await page.locator(".global-search-results").getByRole("button", { name: /Creative Test/ }).click();
  await page.getByRole("heading", { name: "Creative Test" }).waitFor();
  const appNavigation = page.locator(".sidebar-navigation");
  await appNavigation.getByRole("button", { name: "テンプレート" }).click();
  await page.getByRole("heading", { name: "テンプレート" }).waitFor();
  await appNavigation.getByRole("button", { name: "発見" }).click();
  await page.getByRole("heading", { name: "発見" }).waitFor();
  await appNavigation.getByRole("button", { name: "ニュース" }).click();
  await page.getByRole("heading", { name: "ニュース" }).waitFor();
  await appNavigation.getByRole("button", { name: "サーバー" }).click();
  await page.getByRole("heading", { name: "すべてのサーバー" }).waitFor();
  await appNavigation.getByRole("button", { name: "ホーム" }).click();
  await page.getByRole("heading", { name: "Creative Test" }).waitFor();
  const inspectorLinks = page.locator(".home-inspector-links");
  await inspectorLinks.getByRole("button", { name: "アクセスログ" }).click();
  await page.locator("#server-access-log").waitFor();
  await inspectorLinks.getByRole("button", { name: "バックアップ" }).click();
  await page.locator("#server-backups").waitFor();
  await page.locator(".tabs").getByRole("button", { name: "ファイル" }).click();
  await page.getByRole("heading", { name: "サーバーファイル" }).waitFor();
  await page.getByText("アクセス範囲はこのサーバーフォルダー内だけです。ファイル変更はサーバー停止中のみ実行できます。").waitFor();
  await page.screenshot({ path: path.join(root, "artifacts", "workspace-navigation-and-files.png"), fullPage: true });
  await page.setViewportSize({ width: 620, height: 760 });
  const mobileNavigation = page.locator(".mobile-navigation");
  await mobileNavigation.waitFor();
  await mobileNavigation.getByRole("combobox", { name: "サーバー一覧" }).selectOption("demo-paper");
  await mobileNavigation.getByRole("button", { name: "テンプレート" }).click();
  await page.getByRole("heading", { name: "テンプレート" }).waitFor();
  const documentOverflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (documentOverflows) throw new Error("モバイル表示でページ全体が横方向にはみ出しています");
  await page.screenshot({ path: path.join(root, "artifacts", "workspace-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1580, height: 980 });
  await appNavigation.getByRole("button", { name: "ホーム" }).click();
  await page.getByRole("heading", { name: "Survival World" }).waitFor();
  await page.locator(".server-list").getByText("Survival World", { exact: true }).click();
  await page.getByRole("heading", { name: "Survival World" }).waitFor();
  if (await page.getByRole("button", { name: "共同管理" }).count()) throw new Error("削除済みの共同管理ボタンが残っています");
  await page.getByRole("button", { name: "友達を招待" }).waitFor();
  await page.getByRole("button", { name: "統合版を招待" }).waitFor();
  const monitor = page.getByLabel("負荷監視");
  await monitor.getByText(/^19\.[89]$/).waitFor();
  if (await monitor.getByText("未取得", { exact: true }).count()) throw new Error("負荷監視に固定の未取得表示が残っています");
  await monitor.getByText(/^[123] ms$/).waitFor();
  const memoryMeter = page.getByRole("progressbar", { name: "使用メモリ" });
  const firstMemory = await memoryMeter.getAttribute("aria-valuenow");
  await page.waitForTimeout(1_100);
  if (await memoryMeter.getAttribute("aria-valuenow") === firstMemory) throw new Error("使用メモリが1秒間隔で更新されませんでした");

  await page.getByRole("button", { name: "テーマ: system" }).click();
  if (await page.locator(".app").getAttribute("data-theme") !== "dark") throw new Error("ダークテーマへ切り替わりませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "ui-smoke-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "テーマ: dark" }).click();
  if (await page.locator(".app").getAttribute("data-theme") !== "light") throw new Error("ライトテーマへ切り替わりませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "ui-smoke-light.png"), fullPage: true });

  await page.locator(".tabs").getByRole("button", { name: "自動運用" }).click();
  await page.getByRole("heading", { name: "新しいPCへサーバーを引っ越す" }).waitFor();
  await page.getByRole("heading", { name: "0人になったら安全に自動停止" }).waitFor();
  await page.getByRole("heading", { name: "Windows通知" }).waitFor();
  await page.getByRole("heading", { name: "Mod・プラグイン競合チェック" }).waitFor();
  await page.getByRole("heading", { name: "更新センター" }).waitFor();
  await page.getByRole("checkbox", { name: /自動停止を使う/ }).check();
  if (!await page.getByRole("combobox", { name: "0人になってから" }).isEnabled()) throw new Error("自動停止を選択しても待機時間を変更できません");
  await page.getByRole("combobox", { name: "0人になってから" }).selectOption("30");
  await page.screenshot({ path: path.join(root, "artifacts", "operations-center-light.png"), fullPage: true });
  await page.getByRole("button", { name: "テーマ: light" }).click();
  await page.getByRole("button", { name: "テーマ: system" }).click();
  if (await page.locator(".app").getAttribute("data-theme") !== "dark") throw new Error("自動運用をダークテーマで確認できませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "operations-center-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "テーマ: dark" }).click();

  await page.locator(".server-list").getByText("Creative Test", { exact: true }).click();
  await page.locator(".tabs").getByRole("button", { name: "サーバーラボ" }).click();
  await page.getByRole("heading", { name: "サーバーラボ" }).waitFor();
  await page.getByRole("button", { name: /標準サバイバル/ }).click();
  await page.getByRole("table", { name: "ラボの設定差分" }).getByText("gamemode", { exact: true }).waitFor();
  if (!await page.getByRole("button", { name: "バックアップして全変更を保存" }).isEnabled()) throw new Error("サーバーラボのプリセットを保存候補へ反映できませんでした");
  await page.getByRole("button", { name: "下書きをこのPCへ保存" }).click();
  if (!String(await page.evaluate(() => localStorage.getItem("server-hub:server-lab-draft:v1:demo-vanilla"))).includes('"defaultGameMode":"survival"')) throw new Error("サーバーラボの下書きがサーバー別に保存されませんでした");
  await page.getByRole("button", { name: "未保存変更をリセット" }).click();
  await page.getByText("現在のサーバー設定から変更はありません。").waitFor();
  await page.getByRole("button", { name: "下書きを復元" }).click();
  await page.getByRole("table", { name: "ラボの設定差分" }).getByText("gamemode", { exact: true }).waitFor();
  await page.getByRole("spinbutton", { name: "ラボの予定プレイヤー数" }).fill("12");
  await page.getByRole("button", { name: "人数と推奨メモリを反映" }).click();
  await page.screenshot({ path: path.join(root, "artifacts", "server-lab-light.png"), fullPage: true });
  await page.locator(".theme-button").evaluate((button) => button.click());
  await page.locator(".theme-button").evaluate((button) => button.click());
  if (await page.locator(".app").getAttribute("data-theme") !== "dark") throw new Error("サーバーラボをダークテーマで確認できませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "server-lab-dark.png"), fullPage: true });
  await page.locator(".theme-button").evaluate((button) => button.click());
  await page.locator(".server-list").getByText("Survival World", { exact: true }).click();

  await page.locator(".tabs").getByRole("button", { name: "設定" }).click();
  await page.getByRole("heading", { name: "サーバー設定" }).waitFor();
  await page.getByText("サーバーアイコン", { exact: true }).waitFor();
  const iconFixtures = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 12;
    canvas.height = 12;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("アイコン検証用Canvasを作成できません");
    context.fillStyle = "#49da6b";
    context.fillRect(0, 0, 12, 12);
    return ["image/png", "image/jpeg", "image/webp"].map((mimeType) => {
      const dataUrl = canvas.toDataURL(mimeType, 0.9);
      if (!dataUrl.startsWith(`data:${mimeType};base64,`)) throw new Error(`${mimeType}の検証画像を生成できません`);
      return { mimeType, base64: dataUrl.split(",")[1], extension: mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] };
    });
  });
  for (const fixture of iconFixtures) {
    await page.getByLabel("画像を選ぶ").setInputFiles({ name: `smoke-icon.${fixture.extension}`, mimeType: fixture.mimeType, buffer: Buffer.from(fixture.base64, "base64") });
    await page.getByText("サーバーアイコンを保存しました", { exact: true }).waitFor();
    if (!String(await page.locator(".server-icon-preview").getAttribute("src")).startsWith("data:image/")) throw new Error(`${fixture.mimeType}アイコンがプレビューへ反映されませんでした`);
  }
  await page.getByText("公式アカウント認証").waitFor();
  await page.getByText("リソースパックを必須にする").waitFor();
  await page.getByText("ワールドの負荷を軽くする").waitFor();
  await page.getByText("ワールドを最初から作り直す").waitFor();
  await page.screenshot({ path: path.join(root, "artifacts", "server-properties-light.png"), fullPage: true });
  await page.locator(".world-maintenance-grid").screenshot({ path: path.join(root, "artifacts", "world-maintenance-light.png") });
  await page.locator(".theme-button").evaluate((button) => button.click());
  await page.locator(".theme-button").evaluate((button) => button.click());
  if (await page.locator(".app").getAttribute("data-theme") !== "dark") throw new Error("カタログ確認前にダークテーマへ切り替わりませんでした");
  await page.locator(".tabs").getByRole("button", { name: "拡張機能" }).click();
  await page.getByRole("heading", { name: "プラグインを探して導入" }).waitFor();
  await page.getByRole("heading", { name: "人気のプラグイン" }).waitFor();
  await page.getByRole("button", { name: /ViaVersion/ }).waitFor();
  if (await page.getByRole("textbox", { name: "プラグインを検索" }).inputValue() !== "") throw new Error("未検索時の人気カタログでは検索欄が空である必要があります");
  await page.screenshot({ path: path.join(root, "artifacts", "modrinth-popular-dark.png"), fullPage: true });
  await page.getByRole("textbox", { name: "プラグインを検索" }).fill("Essentials");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: /Essentials Example/ }).click();
  await page.getByText("example.jar").waitFor();
  await page.getByRole("button", { name: "導入内容を確認", exact: true }).click();
  const planDialog = page.getByRole("dialog", { name: "導入内容の確認" });
  await planDialog.waitFor();
  const darkPlanBox = await planDialog.boundingBox();
  if (!darkPlanBox || darkPlanBox.y > 110) throw new Error("導入内容の確認が画面上部に表示されていません");
  if (await page.getByText(/CurseForge/).count()) throw new Error("削除済みのCurseForge表示が残っています");
  await page.screenshot({ path: path.join(root, "artifacts", "safe-extension-catalog-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "導入確認を閉じる" }).click();
  await page.getByRole("button", { name: "テーマ: dark" }).click();
  await page.getByRole("button", { name: "導入内容を確認", exact: true }).click();
  await planDialog.waitFor();
  const lightPlanBox = await planDialog.boundingBox();
  if (!lightPlanBox || lightPlanBox.y > 110) throw new Error("ライトテーマで導入内容の確認が画面上部に表示されていません");
  await page.screenshot({ path: path.join(root, "artifacts", "safe-extension-catalog-light.png"), fullPage: true });
  await page.getByRole("button", { name: "導入確認を閉じる" }).click();
  await page.locator(".tabs").getByRole("button", { name: "プレイヤー" }).click();
  await page.getByRole("heading", { name: "プレイヤー管理" }).waitFor();
  await page.getByRole("button", { name: /統合版ホワイトリスト/ }).click();
  await page.getByText("Floodgate専用").waitFor();
  await page.getByText(".BedrockFriend", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, "artifacts", "floodgate-whitelist-light.png"), fullPage: true });
  await page.getByRole("button", { name: /権限者/ }).click();
  await page.getByText("ServerOwner").waitFor();
  await page.getByRole("button", { name: /BANしたIP/ }).click();
  await page.getByText("203.0.***.***").waitFor();
  await page.locator(".server-list").getByText("Creative Test", { exact: true }).click();
  await page.locator(".tabs").getByRole("button", { name: "プレイヤー" }).click();
  await page.getByText("停止中も編集可能").waitFor();
  await page.getByText("起動前に登録できます").waitFor();
  await page.getByRole("textbox", { name: "プレイヤー名" }).fill("PreStartUser");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await page.getByText("PreStartUser", { exact: true }).waitFor();
  if (await page.locator(".app").getAttribute("data-theme") !== "light") throw new Error("停止中プレイヤー管理をライトテーマで確認できませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "player-access-before-start-light.png"), fullPage: true });
  for (let attempt = 0; attempt < 3 && await page.locator(".app").getAttribute("data-theme") !== "dark"; attempt += 1) await page.locator(".theme-button").evaluate((button) => button.click());
  if (await page.locator(".app").getAttribute("data-theme") !== "dark") throw new Error("停止中プレイヤー管理をダークテーマに切り替えられませんでした");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, "artifacts", "player-access-before-start-dark.png"), fullPage: true });
  await page.locator(".theme-button").evaluate((button) => button.click());
  if (await page.locator(".app").getAttribute("data-theme") !== "light") throw new Error("停止中プレイヤー管理からライトテーマへ戻せませんでした");
  await page.locator(".sidebar-footer").getByRole("button", { name: "設定" }).click();
  await page.getByRole("heading", { name: "いつものメンバー" }).waitFor();
  await page.getByRole("textbox", { name: "固定メンバーのプレイヤー名" }).fill("SmokeFriend");
  await page.getByRole("button", { name: "メンバーを保存" }).click();
  await page.getByText("SmokeFriend", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, "artifacts", "fixed-members-light.png"), fullPage: true });
  await page.getByRole("button", { name: "Pro運用" }).click();
  await page.getByRole("heading", { name: "追加テーマ・アイコン" }).waitFor();
  await page.getByRole("textbox", { name: "カラーコード" }).fill("#FFCC00");
  await page.getByRole("button", { name: "この色を適用" }).click();
  if (await page.locator(".app").getAttribute("data-accent") !== "custom") throw new Error("自由に選んだテーマ色が反映されませんでした");
  if (!String(await page.locator(".app").getAttribute("style")).includes("#FFCC00")) throw new Error("自由色のCSS変数が反映されませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "custom-accent-light.png"), fullPage: true });
  await page.getByRole("button", { name: "エメラルド" }).click();
  await page.getByRole("button", { name: "いつものメンバー" }).click();
  for (let attempt = 0; attempt < 3 && await page.locator(".app").getAttribute("data-theme") !== "dark"; attempt += 1) await page.locator(".theme-button").evaluate((button) => button.click());
  await page.waitForTimeout(300);
  if (await page.locator(".app").getAttribute("data-theme") !== "dark") throw new Error("固定メンバー設定をダークテーマで確認できませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "fixed-members-dark.png"), fullPage: true });
  await page.locator(".theme-button").evaluate((button) => button.click());
  await page.getByRole("button", { name: "閉じる" }).click();
  await page.getByRole("button", { name: "ホワイトリストへ反映（1人）" }).click();
  await page.getByText(/いつものメンバーをホワイトリストへ反映しました/).waitFor();
  await page.getByText("SmokeFriend", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, "artifacts", "fixed-members-player-management-light.png"), fullPage: true });
  for (let attempt = 0; attempt < 3 && await page.locator(".app").getAttribute("data-theme") !== "dark"; attempt += 1) await page.locator(".theme-button").evaluate((button) => button.click());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, "artifacts", "fixed-members-player-management-dark.png"), fullPage: true });
  await page.locator(".theme-button").evaluate((button) => button.click());
  await page.locator(".server-list").getByText("Survival World", { exact: true }).click();
  await page.locator(".tabs").getByRole("button", { name: "安全ツール" }).click();
  await page.getByRole("heading", { name: "Modパックプロファイル" }).waitFor();
  await page.getByRole("heading", { name: "確認付きサーバー更新" }).waitFor();
  await page.getByText("まだ検出していません").waitFor();
  await page.getByRole("button", { name: "Javaを検出" }).click();
  await page.getByText("1件が互換").waitFor();
  await page.getByRole("button", { name: "必要なJavaを自動で準備" }).click();
  const javaSetupDialog = page.getByRole("dialog", { name: "Javaをアプリ内に準備" });
  await javaSetupDialog.waitFor();
  if (await javaSetupDialog.getByRole("button", { name: "ダウンロードして自動選択" }).isEnabled()) throw new Error("Java取得が確認前に有効になっています");
  await page.screenshot({ path: path.join(root, "artifacts", "java-setup-review-light.png"), fullPage: true });
  await javaSetupDialog.getByRole("button", { name: "Java確認画面を閉じる" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, "artifacts", "safety-tools-light.png"), fullPage: true });
  await page.getByRole("button", { name: "テーマ: light" }).click();
  await page.getByRole("button", { name: "テーマ: system" }).click();
  if (await page.locator(".app").getAttribute("data-theme") !== "dark") throw new Error("安全ツールをダークテーマで確認できませんでした");
  await page.getByRole("button", { name: "必要なJavaを自動で準備" }).click();
  await javaSetupDialog.waitFor();
  await javaSetupDialog.getByRole("checkbox", { name: /配布元・ライセンス・バージョン・容量・保存先/ }).check();
  await page.screenshot({ path: path.join(root, "artifacts", "java-setup-review-dark.png"), fullPage: true });
  await javaSetupDialog.getByRole("button", { name: "ダウンロードして自動選択" }).click();
  await page.getByText(/Javaを安全に準備しました/).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, "artifacts", "safety-tools-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "安全確認" }).click();
  await page.getByRole("button", { name: "バックアップして更新を適用" }).waitFor();
  await page.locator(".update-check-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, "artifacts", "confirmed-update-review-dark.png"), fullPage: true });

  await page.locator(".tabs").getByRole("button", { name: "設定" }).click();
  await page.getByRole("heading", { name: "サーバー設定" }).waitFor();
  await page.screenshot({ path: path.join(root, "artifacts", "server-properties-dark.png"), fullPage: true });
  await page.locator(".world-maintenance-grid").screenshot({ path: path.join(root, "artifacts", "world-maintenance-dark.png") });
  await page.locator(".tabs").getByRole("button", { name: "プレイヤー" }).click();
  await page.getByRole("button", { name: /BANしたIP/ }).click();
  await page.getByText("203.0.***.***").waitFor();
  await page.screenshot({ path: path.join(root, "artifacts", "player-access-dark.png"), fullPage: true });

  await page.locator(".top-button.import-button").click();
  await page.getByRole("dialog").getByRole("heading", { name: "既存サーバーを取り込む" }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: /選択/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "安全にスキャン" }).click();
  await page.getByText("読み取り完了").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "キャンセル" }).click();

  await page.getByRole("button", { name: "友達を招待" }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "友達を招待", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "招待名" }).fill("夜ふかしサバイバル");
  await page.getByRole("textbox", { name: "独自ドメイン・DDNS（任意）" }).fill("play.example.net");
  await page.getByRole("button", { name: "招待設定を保存" }).click();
  await page.getByText("招待名と接続名の設定を保存しました").waitFor();
  await page.getByRole("heading", { name: "ホスト本人" }).waitFor();
  const tunnelPanel = page.locator(".tunnel-local-panel");
  await tunnelPanel.getByRole("heading", { name: "ポート開放なしで友達を招待" }).waitFor();
  if (await tunnelPanel.getByText(/管理画面・SQLite・バックアップは公開しません/).count() !== 1) throw new Error("Minecraftポート限定の公開境界が表示されていません");
  await tunnelPanel.getByText("詳しい設定と診断").click();
  await tunnelPanel.getByRole("button", { name: "選択" }).click();
  await tunnelPanel.getByText("C:\\Program Files\\playit\\playit.exe").waitFor();
  await tunnelPanel.getByRole("button", { name: "署名を検証" }).click();
  await tunnelPanel.getByText("デスクトップ版で公式署名を検証してください").waitFor();
  await tunnelPanel.getByRole("checkbox").check();
  page.once("dialog", (dialog) => dialog.accept());
  await tunnelPanel.getByRole("button", { name: "トンネルを開始" }).click();
  await tunnelPanel.getByText("ログイン確認待ち", { exact: true }).waitFor();
  if (await tunnelPanel.getByText("demo.gl.joinmc.link:25565", { exact: true }).count()) throw new Error("公式トンネル設定前に公開接続先が表示されています");
  await tunnelPanel.getByRole("button", { name: "公式画面でログイン" }).click();
  await page.getByText("playit.gg公式ログイン画面を開きました").waitFor();
  await tunnelPanel.getByRole("button", { name: "公式画面でトンネルを追加" }).click();
  await page.getByText("playit.gg公式トンネル設定画面を開きました").waitFor();
  await tunnelPanel.getByRole("button", { name: "接続先を再確認" }).click();
  await tunnelPanel.getByText("demo.gl.joinmc.link:25565", { exact: true }).waitFor();
  await tunnelPanel.getByRole("button", { name: "外部経路をテスト" }).click();
  await tunnelPanel.getByText("外部経路: 未確認", { exact: true }).waitFor();
  await tunnelPanel.getByText(/ブラウザデモのためTCP接続は実測していません/).waitFor();
  for (let attempt = 0; attempt < 3 && await page.locator(".app").getAttribute("data-theme") !== "dark"; attempt += 1) await page.locator(".theme-button").evaluate((button) => button.click());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, "artifacts", "tunnel-local-agent-dark.png"), fullPage: true });
  await page.locator(".theme-button").evaluate((button) => button.click());
  if (await page.locator(".app").getAttribute("data-theme") !== "light") throw new Error("トンネル管理をライトテーマで確認できませんでした");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, "artifacts", "tunnel-local-agent-light.png"), fullPage: true });
  await tunnelPanel.getByRole("button", { name: "招待を停止" }).click();
  await page.getByText("エージェントを停止しました", { exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await tunnelPanel.getByRole("button", { name: "友達と遊べるようにする" }).click();
  await tunnelPanel.getByText("demo.gl.joinmc.link:25565", { exact: true }).waitFor();
  await page.getByText("友達が参加できる状態になりました").waitFor();
  await tunnelPanel.getByRole("button", { name: "招待を停止" }).click();
  await page.locator(".theme-button").evaluate((button) => button.click());
  await page.locator(".theme-button").evaluate((button) => button.click());
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("dialog").getByRole("button", { name: "別の家の友達向けに公開" }).click();
  await page.getByText("play.example.net", { exact: true }).waitFor();
  await page.getByText("203.0.113.42:25565").waitFor();
  await page.screenshot({ path: path.join(root, "artifacts", "internet-invite-published.png"), fullPage: true });
  await page.locator(".theme-button").evaluate((button) => button.click());
  await page.waitForTimeout(100);
  if (await page.locator(".app").getAttribute("data-theme") !== "light") throw new Error("招待画面をライトテーマで確認できませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "internet-invite-published-light.png"), fullPage: true });
  await page.locator(".theme-button").evaluate((button) => button.click());
  await page.getByRole("dialog").getByRole("button", { name: "公開を終了" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "別の家の友達向けに公開" }).waitFor();
  await page.locator(".invite-dialog").getByRole("button", { name: "閉じる" }).first().click();

  await page.locator(".server-list").getByText("Palworld Friends", { exact: true }).click();
  await page.getByRole("heading", { name: "Palworld Friends" }).waitFor();
  if (await page.locator(".tabs > button").count() !== 6) throw new Error("Palworldのタブ数が想定と異なります");
  await page.locator(".tabs").getByRole("button", { name: "自動運用" }).click();
  await page.getByRole("heading", { name: "0人になったら安全に自動停止" }).waitFor();
  await page.getByRole("checkbox", { name: /自動停止を使う/ }).check();
  await page.getByRole("combobox", { name: "0人になってから" }).selectOption("15");
  if (await page.locator(".migration-panel, .conflict-panel, .update-center-panel").count()) throw new Error("Palworldの自動運用にMinecraft専用操作があります");
  await page.screenshot({ path: path.join(root, "artifacts", "palworld-operations.png"), fullPage: true });
  await page.locator(".tabs > button").first().click();
  await page.getByRole("button", { name: "友達を招待" }).click();
  await page.getByRole("heading", { name: "Palworldの友達を招待" }).waitFor();
  await page.getByText("別の家の友達に渡すアドレス", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, "artifacts", "palworld-automatic-invite.png"), fullPage: true });
  await page.getByRole("dialog").getByRole("button", { name: "閉じる" }).first().click();
  await page.locator(".tabs").getByRole("button", { name: "コンソール" }).click();
  if (await page.locator(".command-line").count()) throw new Error("Palworldの読み取り専用ログにコマンド入力が表示されています");
  await page.locator(".tabs").getByRole("button", { name: "設定" }).click();
  await page.getByRole("heading", { name: "Palworldサーバー設定" }).waitFor();
  if (await page.getByLabel("ゲーム接続ポート（UDP）").inputValue() !== "8211") throw new Error("Palworldのゲーム接続ポートを編集できません");
  if (await page.getByLabel("REST管理ポート（TCP・ローカル専用）").inputValue() !== "8212") throw new Error("PalworldのREST管理ポートを編集できません");
  await page.getByLabel("経験値倍率").fill("2");
  if (!await page.getByRole("button", { name: "設定を安全に保存" }).isEnabled()) throw new Error("有効なPalworld設定を保存候補へ反映できません");
  await page.screenshot({ path: path.join(root, "artifacts", "palworld-pw0-pw2-light.png"), fullPage: true });
  await page.getByRole("button", { name: "Palworld Friendsを削除" }).click();
  const palworldDeleteDialog = page.getByRole("dialog");
  await palworldDeleteDialog.getByText("重要データを保存して高速削除（おすすめ）").click();
  await palworldDeleteDialog.getByText(/Palworldの重要データには参加・管理パスワード/).waitFor();
  await palworldDeleteDialog.getByText(/SteamCMDで公式サーバーを再取得/).waitFor();
  const palworldDeleteButton = palworldDeleteDialog.getByRole("button", { name: "重要データを保存して高速削除" });
  if (await palworldDeleteButton.isEnabled()) throw new Error("Palworld削除確認前に高速削除ボタンが有効です");
  await palworldDeleteDialog.getByPlaceholder("Delete").fill("Delete");
  if (!await palworldDeleteButton.isEnabled()) throw new Error("PalworldをDelete確認後に高速削除できません");
  await page.screenshot({ path: path.join(root, "artifacts", "palworld-fast-delete-confirmation.png"), fullPage: true });
  await palworldDeleteDialog.getByText("バックアップせず今すぐ削除").click();
  await palworldDeleteDialog.getByText(/最終バックアップは作成されません/).waitFor();
  if (await palworldDeleteDialog.getByText(/参加・管理パスワード/).count()) throw new Error("バックアップなし削除にバックアップ共有警告が残っています");
  const palworldImmediateDeleteButton = palworldDeleteDialog.getByRole("button", { name: "今すぐ削除" });
  if (!await palworldImmediateDeleteButton.isEnabled()) throw new Error("Palworldのバックアップなし削除を選択できません");
  await page.screenshot({ path: path.join(root, "artifacts", "palworld-immediate-delete-confirmation.png"), fullPage: true });
  await palworldDeleteDialog.getByRole("button", { name: "削除画面を閉じる" }).click();
  await page.locator(".server-list").getByText("Survival World", { exact: true }).click();

  await page.locator(".sidebar-footer").getByRole("button", { name: "設定" }).click();
  await page.getByRole("heading", { name: "アプリ設定" }).waitFor();
  await page.locator(".settings-dialog-layout nav").getByRole("button", { name: "言語" }).click();
  await page.getByRole("combobox", { name: "表示言語" }).selectOption("en");
  await page.locator(".titlebar").getByRole("button", { name: "New server" }).waitFor();
  await page.getByRole("navigation", { name: "Server details" }).waitFor();
  if (await page.evaluate(() => localStorage.getItem("server-hub:language:v1")) !== "en") throw new Error("英語設定が保存されませんでした");
  if (await page.evaluate(() => document.documentElement.lang) !== "en") throw new Error("document言語が英語へ更新されませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "language-english-shell.png"), fullPage: true });
  const findJapaneseUiLeftovers = () => page.evaluate(() => {
    const excluded = "[data-no-translate],pre,code,select,option";
    const values = [];
    for (const element of document.querySelectorAll("body *")) {
      if (element.closest(excluded)) continue;
      for (const child of element.childNodes) {
        const text = child.nodeType === Node.TEXT_NODE ? (child.nodeValue || "").trim() : "";
        if (/[\u3041-\u30fa]/.test(text)) values.push(text);
      }
    }
    return [...new Set(values)];
  });
  const languageSelect = page.locator(".language-settings-card select");
  for (const locale of ["en", "zh-CN", "zh-TW", "ko", "es", "de", "fr", "pt-BR"]) {
    await languageSelect.selectOption(locale);
    await page.waitForFunction((expected) => document.documentElement.lang === expected, locale);
    let leftovers = await findJapaneseUiLeftovers();
    if (leftovers.length) throw new Error(`${locale}の言語設定画面に日本語の表示漏れがあります: ${leftovers.slice(0, 5).join(" / ")}`);

    await page.locator(".app-settings-dialog .icon-button").click();
    const serverTabs = page.locator(".tabs > button");
    const tabCount = await serverTabs.count();
    for (let index = 0; index < tabCount; index += 1) {
      await serverTabs.nth(index).click();
      await page.locator(".tab-content").waitFor();
      await page.waitForTimeout(30);
      leftovers = await findJapaneseUiLeftovers();
      if (leftovers.length) throw new Error(`${locale}のサーバータブ${index + 1}に日本語の表示漏れがあります: ${leftovers.slice(0, 5).join(" / ")}`);
      const floodgateTab = page.locator(".player-access-tabs .bedrock_whitelist");
      if (await floodgateTab.count()) {
        await floodgateTab.click();
        await page.waitForTimeout(30);
        leftovers = await findJapaneseUiLeftovers();
        if (leftovers.length) throw new Error(`${locale}の統合版ホワイトリストに日本語の表示漏れがあります: ${leftovers.slice(0, 5).join(" / ")}`);
      }
    }

    await page.locator(".server-list").getByText("Palworld Friends", { exact: true }).click();
    const palworldTabs = page.locator(".tabs > button");
    if (await palworldTabs.count() !== 6) throw new Error(`${locale}のPalworldタブ数が想定と異なります`);
    for (let index = 0; index < 6; index += 1) {
      await palworldTabs.nth(index).click();
      await page.locator(".tab-content").waitFor();
      await page.waitForTimeout(30);
      leftovers = await findJapaneseUiLeftovers();
      if (leftovers.length) throw new Error(`${locale}のPalworldタブ${index + 1}に日本語の表示漏れがあります: ${leftovers.slice(0, 5).join(" / ")}`);
    }
    await palworldTabs.nth(1).click();
    if (await page.locator(".command-line").count()) throw new Error(`${locale}のPalworldログにコマンド入力が表示されています`);
    await page.locator(".server-list").getByText("Survival World", { exact: true }).click();

    await page.locator(".sidebar-footer button").first().click();
    await page.locator(".app-settings-dialog").waitFor();
    await page.locator(".settings-dialog-layout nav button").first().click();
  }
  await page.setViewportSize({ width: 900, height: 720 });
  const narrowOverflow = await page.evaluate(() => {
    const workspace = document.querySelector(".workspace");
    return document.documentElement.scrollWidth > document.documentElement.clientWidth || Boolean(workspace && workspace.scrollWidth > workspace.clientWidth);
  });
  if (narrowOverflow) throw new Error("900px幅の多言語画面に横スクロールが残っています");
  await page.screenshot({ path: path.join(root, "artifacts", "language-portuguese-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1580, height: 980 });
  await languageSelect.selectOption("ja");
  await page.locator(".titlebar").getByRole("button", { name: "新しいサーバー" }).waitFor();
  await page.locator(".settings-dialog-layout nav").getByRole("button", { name: "Pro運用" }).click();
  await page.getByRole("heading", { name: "複数サーバー運用" }).waitFor();
  await page.getByRole("heading", { name: "高度な監視とアプリ内通知" }).waitFor();
  await page.getByRole("heading", { name: "長期操作履歴" }).waitFor();
  await page.getByRole("button", { name: "すべて選択" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "一括起動" }).click();
  await page.getByText("Creative Test: 起動完了（running）", { exact: true }).waitFor();
  await page.getByRole("button", { name: "アメジスト" }).click();
  if (await page.locator(".app").getAttribute("data-accent") !== "amethyst") throw new Error("Pro追加テーマが反映されませんでした");
  await page.locator(".settings-dialog-content").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(root, "artifacts", "pro-operations-amethyst.png"), fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "一括安全停止" }).click();
  await page.getByText("Creative Test: 安全停止完了（stopped）", { exact: true }).waitFor();
  await page.getByRole("button", { name: "エメラルド" }).click();
  await page.locator(".settings-dialog-layout nav").getByRole("button", { name: "プラン" }).click();
  await page.getByRole("heading", { name: "無料版とPro／サポーター版" }).waitFor();
  await page.locator(".app-settings-dialog").getByRole("button", { name: "閉じる" }).click();

  await page.locator(".top-button.create").click();
  await page.getByRole("dialog").getByRole("heading", { name: "PC診断" }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "選択", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "このPCを診断" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "この構成をサーバーに反映" }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "この構成をサーバーに反映" }).click();
  await page.getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "テンプレートと基本情報" }).waitFor();
  await page.locator(".wizard-body input").first().fill("Fabric Smoke Test");
  await page.getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("radio", { name: /Fabric/ }).click();
  await page.locator(".wizard-body select").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "Javaとメモリ" }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "ワールド設定" }).waitFor();
  await page.getByRole("dialog").getByRole("combobox", { name: "ワールドタイプ" }).selectOption("minecraft:amplified");
  await page.getByRole("dialog").getByRole("textbox", { name: "ワールド生成のシード値" }).fill("smoke-seed-2026");
  await page.getByText("村や要塞などの構造物を生成する").waitFor();
  for (let attempt = 0; attempt < 3 && await page.locator(".app").getAttribute("data-theme") !== "dark"; attempt += 1) await page.locator(".theme-button").evaluate((button) => button.click());
  if (await page.locator(".app").getAttribute("data-theme") !== "dark") throw new Error("ワールド設定をダークテーマに切り替えられませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "world-generation-dark.png"), fullPage: true });
  await page.locator(".theme-button").evaluate((button) => button.click());
  if (await page.locator(".app").getAttribute("data-theme") !== "light") throw new Error("ワールド設定をライトテーマに切り替えられませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "world-generation-light.png"), fullPage: true });
  await page.locator(".wizard-header").getByRole("button", { name: "作成画面を閉じる" }).click();

  await page.getByRole("button", { name: "Creative Testを削除" }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "サーバーを削除" }).waitFor();
  await page.getByText("一覧から外す（おすすめ）").waitFor();
  const removeServerButton = page.getByRole("dialog").getByRole("button", { name: "一覧から外す" });
  const deleteConfirmation = page.getByRole("dialog").getByPlaceholder("Delete");
  if (await removeServerButton.isEnabled()) throw new Error("削除確認前に削除ボタンが有効です");
  await deleteConfirmation.fill("Creative Test");
  if (await removeServerButton.isEnabled()) throw new Error("サーバー名で削除確認を通過しました");
  await deleteConfirmation.fill("delete");
  if (await removeServerButton.isEnabled()) throw new Error("小文字deleteで削除確認を通過しました");
  await deleteConfirmation.fill("Delete");
  if (!await removeServerButton.isEnabled()) throw new Error("全言語共通のDeleteで削除確認できませんでした");
  await page.getByRole("dialog").getByText("バックアップせず今すぐ削除", { exact: true }).click();
  await page.getByText("最終バックアップは作成されません。削除したワールド、設定、Mod／プラグインはこのアプリから復旧できません。").waitFor();
  const immediateMinecraftDeleteButton = page.getByRole("dialog").getByRole("button", { name: "今すぐ削除" });
  if (!await immediateMinecraftDeleteButton.isEnabled()) throw new Error("Minecraftのバックアップなし削除をDeleteで確認できませんでした");
  await page.screenshot({ path: path.join(root, "artifacts", "minecraft-immediate-delete-confirmation.png"), fullPage: true });
  await page.getByRole("button", { name: "削除画面を閉じる" }).click();

  if (errors.length) throw new Error(`ブラウザエラー: ${errors.join(" | ")}`);

  console.log("UI smoke PASS: workspace navigation and global search, sandboxed file manager for Minecraft and Palworld, real access-log/backup shortcuts, Palworld automatic friend-invite plus essential-data fast deletion and no-backup immediate deletion, Minecraft backed-up deletion plus no-backup immediate deletion, Palworld six-tab adapter with automatic operation and all 8 non-Japanese Palworld tabs, read-only Palworld logs/editable guarded Palworld settings, Server Lab 15 tools with local drafts/diff/estimates in light and dark themes, all 8 non-Japanese Minecraft locales across all server tabs plus the Floodgate whitelist, language switching/persistence, English app shell, PNG/JPEG/WebP custom server icons, free accent colors, migration/auto-stop/Windows notifications/conflict/update-center UI, Pro bulk operations/monitoring/history/appearance, live memory/TPS/latency, dashboard/themes, world-generation/settings, player access/fixed members, Modrinth catalog, explicit-review Java, confirmed update review, tunnel endpoint gate/probe/stop, import/invite/publish, PC diagnosis, exact Delete confirmation");
  await browser.close();
  if (devServer) devServer.kill();
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close().catch(() => undefined);
  if (devServer) devServer.kill();
  process.exitCode = 1;
});
