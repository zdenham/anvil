import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["lib/**/*.test.ts", "types/**/*.test.ts"],
    exclude: ["node_modules"],
  },
  resolve: {
    alias: {
      "@core": resolve(__dirname, "."),
    },
  },
});
