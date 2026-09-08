import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { compactEmbeddedReport } from "./src/embeddedReport.ts";
// @ts-expect-error The inspection module is intentionally shared with the Node CLI without a build step.
import { inspectDeveloperWorkspace } from "../scripts/developer-inspection.mjs";

const developerRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = path.resolve(developerRoot, "..");
const entryBudgetBytes = 300 * 1024;
const requiredDeferredModules = ["DeveloperUpdateCenter.tsx", "QualityEvidenceCenter.tsx", "BundlePerformanceCenter.tsx", "DependencyCenter.tsx", "ReleaseEvidenceCenter.tsx", "ReleaseApprovalCenter.tsx", "ReleaseHandoffCenter.tsx"];
const requiredLocalePacks = ["ja", "en", "zh-CN", "zh-TW", "ko", "es", "de", "fr", "pt-BR"].map((locale) => `${locale}.json`);

export default defineConfig(async ({ mode }) => {
  const initialReport = await inspectDeveloperWorkspace(workspaceRoot, { checkRemoteFeed: mode !== "test" });
  const embeddedPayload = compactEmbeddedReport(initialReport);
  return {
    root: developerRoot,
    plugins: [react(), {
      name: "msh-read-only-developer-inspection",
      configureServer(server) {
        server.middlewares.use("/__developer-tools/embedded-report", (_request, response) => {
          response.statusCode = 200;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.end(JSON.stringify(embeddedPayload));
        });
        server.middlewares.use("/__developer-tools/report", async (_request, response) => {
          try {
            const report = await inspectDeveloperWorkspace(workspaceRoot, { checkRemoteFeed: true });
            response.statusCode = 200;
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.setHeader("cache-control", "no-store");
            response.end(JSON.stringify(report));
          } catch (reason) {
            response.statusCode = 500;
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ error: reason instanceof Error ? reason.message : String(reason) }));
          }
        });
      },
      generateBundle(_options, bundle) {
        this.emitFile({ type: "asset", fileName: "developer-report.json", source: JSON.stringify(embeddedPayload) });
        const chunks = Object.values(bundle).filter((output) => output.type === "chunk");
        const entry = chunks.find((chunk) => chunk.isEntry);
        if (!entry) this.error("Developer Tools entry chunk was not generated.");
        const deferredChunks = requiredDeferredModules.map((moduleName) => {
          const chunk = chunks.find((candidate) => Object.keys(candidate.modules).some((moduleId) => moduleId.replaceAll("\\", "/").endsWith(`/${moduleName}`)));
          if (!chunk) this.error(`Required deferred module was bundled into the initial entry: ${moduleName}`);
          return {
            module: moduleName,
            fileName: chunk.fileName,
            rawBytes: Buffer.byteLength(chunk.code),
            gzipBytes: gzipSync(chunk.code).byteLength,
          };
        });
        const localeChunks = requiredLocalePacks.map((packName) => {
          const chunk = chunks.find((candidate) => Object.keys(candidate.modules).some((moduleId) => moduleId.replaceAll("\\", "/").endsWith(`/locale-packs/${packName}`)));
          if (!chunk || chunk.isEntry) this.error(`Required locale pack was bundled into the initial entry: ${packName}`);
          return {
            locale: packName.replace(/\.json$/, ""),
            module: `locale-packs/${packName}`,
            fileName: chunk.fileName,
            rawBytes: Buffer.byteLength(chunk.code),
            gzipBytes: gzipSync(chunk.code).byteLength,
          };
        });
        if (new Set(localeChunks.map((chunk) => chunk.fileName)).size !== requiredLocalePacks.length) {
          this.error("Each Developer Tools locale pack must be emitted as an independent lazy chunk.");
        }
        const entryRawBytes = Buffer.byteLength(entry.code);
        const entryGzipBytes = gzipSync(entry.code).byteLength;
        const report = {
          schemaVersion: 2,
          entryBudgetBytes,
          withinBudget: entryRawBytes <= entryBudgetBytes,
          entry: { fileName: entry.fileName, rawBytes: entryRawBytes, gzipBytes: entryGzipBytes },
          deferredChunks,
          localeChunks,
          javascript: {
            chunks: chunks.length,
            rawBytes: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
            gzipBytes: chunks.reduce((sum, chunk) => sum + gzipSync(chunk.code).byteLength, 0),
          },
        };
        this.emitFile({ type: "asset", fileName: "developer-bundle-report.json", source: `${JSON.stringify(report, null, 2)}\n` });
        if (!report.withinBudget) this.error(`Developer Tools entry chunk ${entryRawBytes} bytes exceeds the ${entryBudgetBytes} byte budget.`);
      },
    }],
    define: { __MSH_EMBEDDED_REPORT_URL__: JSON.stringify(mode === "development" ? "/__developer-tools/embedded-report" : "./developer-report.json") },
    clearScreen: false,
    server: { host: "127.0.0.1", port: 1421, strictPort: true },
    build: { outDir: "dist", emptyOutDir: true },
    test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], css: true },
  };
});
