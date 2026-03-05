import { resolve } from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

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
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.ui.test.{ts,tsx}", "node_modules", "agents", "core"],
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
