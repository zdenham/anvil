import { resolve } from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest configuration for UI isolation tests.
 *
 * Uses happy-dom for fast, isolated component testing without a real browser.
 * Tests run against mocked Tauri APIs and an in-memory virtual filesystem.
 *
 * See plans/ui-isolation-testing.md for the full architecture.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@core": resolve(__dirname, "./core"),
    },
  },
  define: {
    __PROJECT_ROOT__: JSON.stringify(process.cwd()),
    __MORT_APP_SUFFIX__: JSON.stringify(""),
    __MORT_WS_PORT__: JSON.stringify("0"),
  },
  test: {
    name: "ui",
    include: ["src/**/*.ui.test.{ts,tsx}"],
    environment: "happy-dom",
    setupFiles: ["./src/test/setup-ui.ts"],
    globals: true,
  },
});
