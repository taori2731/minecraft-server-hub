const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const website = path.resolve(__dirname, "..");
const root = path.resolve(website, "..");
const { chromium } = require(path.join(root, "node_modules", "playwright"));
const url = "http://127.0.0.1:4173/";
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
  await desktop.getByRole("heading", { name: "今できることと、まだできないこと" }).scrollIntoViewIfNeeded();
  await Promise.all([
    desktop.getByRole("heading", { name: "Minecraft Java", exact: true }).waitFor(),
    desktop.getByRole("heading", { name: "Palworld", exact: true }).waitFor(),
    desktop.getByRole("heading", { name: "一般配布", exact: true }).waitFor(),
  ]);
  fs.mkdirSync(path.join(website, "artifacts"), { recursive: true });
  const initialTheme = await desktop.locator("html").getAttribute("data-theme");
  await desktop.screenshot({ path: path.join(website, "artifacts", `site-updates-${initialTheme}.png`), fullPage: false });
  await desktop.getByRole("button", { name: /テーマに切り替える/ }).click(); await desktop.waitForTimeout(250);
  const toggledTheme = await desktop.locator("html").getAttribute("data-theme");
  if (initialTheme === toggledTheme) throw new Error("紹介サイトのテーマが切り替わりませんでした");
  await desktop.screenshot({ path: path.join(website, "artifacts", `site-updates-${toggledTheme}.png`), fullPage: false });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(url, { waitUntil: "networkidle" }); await mobile.getByRole("button", { name: "メニューを開く" }).click(); await mobile.getByRole("navigation", { name: "モバイルナビゲーション" }).getByRole("link", { name: "現在の状態" }).waitFor(); await mobile.waitForTimeout(250);
  await mobile.screenshot({ path: path.join(website, "artifacts", "site-mobile-menu.png"), fullPage: false });
  if (errors.length) throw new Error(`紹介サイトのブラウザエラー: ${errors.join(" | ")}`);
  console.log("Website UI smoke PASS: desktop dark/light, update status, mobile navigation");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close().catch(() => undefined); if (server) server.kill(); });
