import { defineConfig } from "tsup";
import { resolve } from "path";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: ["express", "ws", "mime-types", "chokidar", "@ai-sdk/anthropic", "ai"],
  external: ["node-pty"],
  banner: {
    js: `import { createRequire } from "module"; const require = createRequire(import.meta.url);`,
  },
  esbuildOptions(options) {
    options.alias = {
      "@core": resolve(__dirname, "../core"),
    };
  },
});
