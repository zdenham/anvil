import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/testing/__tests__/**/*.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "../src"),
      "@core": resolve(__dirname, "../core"),
    },
  },
});
