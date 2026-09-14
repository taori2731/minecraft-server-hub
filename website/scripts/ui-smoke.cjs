const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const website = path.resolve(__dirname, "..");
const root = path.resolve(website, "..");
const { chromium } = require(path.join(root, "node_modules", "playwright"));
const url = "http://127.0.0.1:4173/";
const outputArgIndex = process.argv.indexOf("--output-dir");
const outputDir = outputArgIndex >= 0 && process.argv[outputArgIndex + 1] ? path.resolve(process.argv[outputArgIndex + 1]) : path.join(website, "artifacts");
let server;
let browser;

async function waitForServer() {
  for (let index = 0; index < 60; index += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("紹介サイトのViteサーバーが起動しませんでした");
}

(async () => {
  const viteEntry = path.join(website, "node_modules", "vite", "bin", "vite.js");
  server = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", "4173"], { cwd: website, stdio: "ignore", windowsHide: true });
  await waitForServer();
  const chrome = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(fs.existsSync);
  browser = await chromium.launch(chrome ? { headless: true, executablePath: chrome } : { headless: true });
  const errors = [];
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  desktop.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); }); desktop.on("pageerror", (error) => errors.push(error.message));
  await desktop.goto(url, { waitUntil: "networkidle" });
  if (await desktop.title() !== "TomoNode｜Windows向けゲームサーバー管理アプリ") throw new Error("紹介サイトのタイトルがTomoNodeではありません");
  await desktop.getByRole("link", { name: "TomoNode トップへ" }).waitFor();
  await desktop.getByRole("heading", { name: "今できることと、まだできないこと" }).scrollIntoViewIfNeeded();
  await Promise.all([
    desktop.getByRole("heading", { name: "Minecraft Java", exact: true }).waitFor(),
    desktop.getByRole("heading", { name: "Palworld", exact: true }).waitFor(),
    desktop.getByRole("heading", { name: "Windowsパッケージ表示", exact: true }).waitFor(),
    desktop.getByRole("link", { name: "0.4.4をダウンロード" }).first().waitFor(),
  ]);
  const supportHeading = desktop.getByRole("heading", { name: "TomoNodeを応援" });
  await supportHeading.scrollIntoViewIfNeeded(); await supportHeading.waitFor({ state: "visible" });
  await desktop.getByText("支援受付は準備中").first().waitFor({ state: "visible" });
  const pageText = (await desktop.locator("body").textContent()) ?? "";
  for (const oldText of ["無料版", "Pro版", "価格未定", "準備中（購入・認証なし）", "優先サポート"]) {
    if (pageText.includes(oldText)) throw new Error(`旧支援表示が残っています: ${oldText}`);
  }
  if (!pageText.includes("基本・安全・高度な運用は全員無料")) throw new Error("全員無料の運用方針が表示されません");
  for (const oldReleaseText of ["公開予定 0.4.4", "公開前（候補資産）", "0.4.4候補を確認", "GitHub公開前です"]) {
    if (pageText.includes(oldReleaseText)) throw new Error(`旧公開状態が残っています: ${oldReleaseText}`);
  }
  if (!pageText.includes("公開版 0.4.4")) throw new Error("公開版0.4.4が表示されません");
  if (!pageText.includes("公開再取得検証PASS")) throw new Error("公開再取得検証PASSが表示されません");
  if (!pageText.includes("Windows Authenticodeは未署名（NotSigned）")) throw new Error("Authenticode未署名状態が表示されません");
  if (!pageText.includes("0.4.3からの実アプリ更新・再起動確認は未実施/継続中")) throw new Error("実アプリ更新確認状態が表示されません");
  fs.mkdirSync(outputDir, { recursive: true });
  const initialTheme = await desktop.locator("html").getAttribute("data-theme");
  await desktop.screenshot({ path: path.join(outputDir, `site-updates-${initialTheme}.png`), fullPage: false });
  await desktop.getByRole("button", { name: /テーマに切り替える/ }).click(); await desktop.waitForTimeout(250);
  const toggledTheme = await desktop.locator("html").getAttribute("data-theme");
  if (initialTheme === toggledTheme) throw new Error("紹介サイトのテーマが切り替わりませんでした");
  await desktop.screenshot({ path: path.join(outputDir, `site-updates-${toggledTheme}.png`), fullPage: false });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(url, { waitUntil: "networkidle" }); await mobile.getByRole("button", { name: "メニューを開く" }).click(); await mobile.getByRole("navigation", { name: "モバイルナビゲーション" }).getByRole("link", { name: "現在の状態" }).waitFor(); await mobile.waitForTimeout(250);
  await mobile.screenshot({ path: path.join(outputDir, "site-mobile-menu.png"), fullPage: false });
  if (errors.length) throw new Error(`紹介サイトのブラウザエラー: ${errors.join(" | ")}`);
  console.log("Website UI smoke PASS: desktop dark/light, published 0.4.4 status, support policy, mobile navigation");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close().catch(() => undefined); if (server) server.kill(); });
