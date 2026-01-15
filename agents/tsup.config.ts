import { defineConfig } from "tsup";
import { resolve } from "path";

export default defineConfig({
  entry: ["src/runner.ts", "src/cli/mort.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle most dependencies to minimize app size (was 523MB with full node_modules).
  // Keep @anthropic-ai/claude-agent-sdk external because it bundles its own Claude Code
  // CLI executable (cli.js) and ripgrep binaries (vendor/) that it needs to resolve at runtime.
  // Bundling the SDK breaks its internal path resolution for these files.
  // Current result: ~96MB app (vs 547MB before optimization)
  noExternal: [/^(?!@anthropic-ai\/claude-agent-sdk)/],
  esbuildOptions(options) {
    options.alias = {
      "@core": resolve(__dirname, "../core"),
      "@": resolve(__dirname, "../src"),
    };
  },
});
