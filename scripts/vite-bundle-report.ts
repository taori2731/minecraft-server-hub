import { Buffer } from "node:buffer";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

export const DEFAULT_BUNDLE_BUDGETS = {
  entryJavaScriptBytes: 500 * 1024,
  chunkJavaScriptBytes: 500 * 1024,
  totalJavaScriptGzipBytes: 1200 * 1024,
  totalCssBytes: 250 * 1024,
} as const;

function bytes(value: string | Uint8Array) {
  return typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
}

function localModuleId(id: string, workspaceRoot: string) {
  const clean = id.replace(/^\0+/, "virtual:").split("?")[0].replaceAll("\\", "/");
  const normalizedRoot = workspaceRoot.replaceAll("\\", "/").replace(/\/$/, "");
  if (clean.startsWith(`${normalizedRoot}/`)) return clean.slice(normalizedRoot.length + 1);
  const nodeModules = clean.lastIndexOf("/node_modules/");
  if (nodeModules >= 0) return clean.slice(nodeModules + 1);
  return clean.startsWith("virtual:") ? clean : path.posix.basename(clean);
}

export function bundleReportPlugin(): Plugin {
  return {
    name: "minecraft-server-hub-bundle-report",
    apply: "build",
    generateBundle(_options, bundle) {
      const workspaceRoot = process.cwd();
      const chunks = Object.values(bundle)
        .filter((item) => item.type === "chunk")
        .map((chunk) => {
          const content = Buffer.from(chunk.code);
          const modules = Object.entries(chunk.modules)
            .map(([id, detail]) => ({
              id: localModuleId(id, workspaceRoot),
              renderedBytes: detail.renderedLength,
            }))
            .sort((left, right) => right.renderedBytes - left.renderedBytes || left.id.localeCompare(right.id));
          return {
            fileName: chunk.fileName,
            name: chunk.name,
            entry: chunk.isEntry,
            dynamicEntry: chunk.isDynamicEntry,
            rawBytes: content.length,
            gzipBytes: gzipSync(content).length,
            imports: [...chunk.imports],
            dynamicImports: [...chunk.dynamicImports],
            moduleCount: modules.length,
            largestModules: modules.slice(0, 30),
          };
        })
        .sort((left, right) => right.rawBytes - left.rawBytes || left.fileName.localeCompare(right.fileName));
      const assets = Object.values(bundle)
        .filter((item) => item.type === "asset")
        .map((asset) => {
          const content = bytes(asset.source);
          return { fileName: asset.fileName, rawBytes: content.length, gzipBytes: gzipSync(content).length };
        })
        .sort((left, right) => right.rawBytes - left.rawBytes || left.fileName.localeCompare(right.fileName));
      const totalJavaScriptBytes = chunks.reduce((total, item) => total + item.rawBytes, 0);
      const totalJavaScriptGzipBytes = chunks.reduce((total, item) => total + item.gzipBytes, 0);
      const totalCssBytes = assets.filter((item) => item.fileName.endsWith(".css")).reduce((total, item) => total + item.rawBytes, 0);
      const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        budgets: DEFAULT_BUNDLE_BUDGETS,
        totals: { totalJavaScriptBytes, totalJavaScriptGzipBytes, totalCssBytes, chunks: chunks.length, assets: assets.length },
        chunks,
        assets,
      };
      this.emitFile({ type: "asset", fileName: "bundle-report.json", source: `${JSON.stringify(report, null, 2)}\n` });
    },
  };
}
