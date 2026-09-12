import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { bundleReportPlugin } from "./scripts/vite-bundle-report.ts";

export default defineConfig({
  plugins: [react(), bundleReportPlugin()],
  clearScreen: false,
  server: {
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**", "**/artifacts/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.idea/**", "**/.git/**", "**/.cache/**"],
    coverage: {
      provider: "v8",
      reporter: ["json-summary"],
      reportsDirectory: "coverage/quality",
      include: ["src/**/*.{ts,tsx}", "developer-tools/src/**/*.{ts,tsx}", "website/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/test/**", "**/*.d.ts"],
    },
  },
});
