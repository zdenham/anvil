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
    // IMPORTANT: Must alias as __createRequire to avoid collision with createRequire
    // imports inside bundled dependencies. Using `createRequire` directly causes
    // "Identifier 'createRequire' has already been declared" at runtime.
    js: `import { createRequire as __createRequire } from "module"; const require = __createRequire(import.meta.url);`,
  },
  esbuildOptions(options) {
    options.alias = {
      "@core": resolve(__dirname, "../core"),
    };
  },
});
