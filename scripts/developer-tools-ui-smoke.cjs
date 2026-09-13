const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const url = "http://127.0.0.1:1421/";
const productName = "TomoNode Developer Tools";
const consumerFeed = "https://github.com/taori2731/minecraft-server-hub-releases/releases/latest/download/latest.json";
const developerFeed = "https://raw.githubusercontent.com/taori2731/minecraft-server-hub-releases/main/developer-tools/latest.json";
const localeValues = ["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"];
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
  throw new Error("Developer Tools Vite開発サーバーが起動しませんでした");
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  if (dimensions.scrollWidth > dimensions.clientWidth + 1 || dimensions.bodyScrollWidth > dimensions.clientWidth + 1) {
    throw new Error(`${label}で横方向のオーバーフローがあります: ${JSON.stringify(dimensions)}`);
  }
}

let devServer;
let browser;
let tempDir;

(async () => {
  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tomonode-developer-tools-smoke-"));
    if (!await isReady()) {
      const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
      devServer = spawn(process.execPath, [viteEntry, "--mode", "test", "--config", "developer-tools/vite.config.ts", "--host", "127.0.0.1"], { cwd: root, stdio: "ignore", windowsHide: true });
      await waitForServer();
    }
    const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
    browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => localStorage.setItem("msh-developer-tools:locale", "en"));
    const errors = [];
    const httpErrors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(`${message.text()} @ ${message.location().url}`); });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });
    await page.goto(url, {
      waitUntil: "commit",
      timeout: 30_000,
    });
    await page.locator(".brand strong").waitFor({
      state: "visible",
      timeout: 60_000,
    });
    if (await page.title() !== productName) throw new Error(`HTMLタイトルが${productName}ではありません`);
    if (await page.locator(".brand strong").textContent() !== productName) throw new Error("Reactヘッダーの製品名が一致しません");
    if (await page.locator(".brand").getAttribute("aria-label") !== productName) throw new Error("ブランドのアクセシビリティラベルが一致しません");

    for (const viewport of [
      { name: "1280x720", width: 1280, height: 720 },
      { name: "1536x960", width: 1536, height: 960 },
      { name: "200-percent-equivalent", width: 768, height: 480 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await assertNoHorizontalOverflow(page, viewport.name);
      if (await page.locator(".brand strong").textContent() !== productName) throw new Error(`${viewport.name}で製品名が表示されません`);
      await page.screenshot({ path: path.join(tempDir, `${viewport.name}.png`), fullPage: true });
    }

    const localeSelect = page.locator(".topbar select");
    for (const locale of localeValues) {
      await localeSelect.selectOption(locale);
      await page.waitForFunction((expected) => document.querySelector(".brand strong")?.textContent === expected, productName, { timeout: 15_000 });
      if (await page.locator(".brand strong").textContent() !== productName) throw new Error(`${locale}のappNameが一致しません`);
      const navigationLabel = await page.locator(".operations-navigator").getAttribute("aria-label");
      if (!navigationLabel?.includes(productName)) throw new Error(`${locale}のアクセシビリティラベルに製品名がありません`);
    }

    await localeSelect.selectOption("en");
    await page.waitForFunction((expected) => document.querySelector(".brand strong")?.textContent === expected, productName, { timeout: 15_000 });
    await page.getByRole("button", { name: `${productName} update`, exact: true }).click();
    const updatePanel = page.locator("#developer-update-center");
    await updatePanel.waitFor({ state: "visible", timeout: 15_000 });
    if (!await updatePanel.getByText(productName, { exact: false }).count()) throw new Error("更新画面にDeveloper Tools製品名がありません");
    await updatePanel.getByText(developerFeed, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    if (await updatePanel.getByText(consumerFeed, { exact: true }).count()) throw new Error("一般向け更新フィードがDeveloper Tools画面へ混入しています");
    await assertNoHorizontalOverflow(page, "更新画面");
    if (errors.length > 0 || httpErrors.length > 0) throw new Error(`UIでブラウザエラーが発生しました: ${errors.join(" | ")} ${httpErrors.join(" | ")}`);
    console.log(`Developer Tools UI smoke PASS: ${productName}, ${localeValues.length} locales, 1280x720, 1536x960, 200%-equivalent, dedicated feed`);
  } finally {
    if (browser) await browser.close();
    if (devServer) devServer.kill();
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
