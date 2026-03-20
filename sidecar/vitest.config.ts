import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@core": resolve(__dirname, "../core"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10000,
  },
});
