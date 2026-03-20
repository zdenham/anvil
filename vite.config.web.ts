import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const wsPort = parseInt(process.env.MORT_WS_PORT || "9600", 10);

/**
 * Vite config for the standalone web build.
 *
 * Key difference from the Tauri config: all @tauri-apps/* imports are
 * aliased to shim modules so the build succeeds without Tauri packages
 * installed at runtime.
 */
export default defineConfig({
  plugins: [react()],

  define: {
    __PROJECT_ROOT__: JSON.stringify(process.cwd()),
    __MORT_APP_SUFFIX__: JSON.stringify(""),
    __MORT_WS_PORT__: JSON.stringify(wsPort),
  },

  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@core": resolve(__dirname, "./core"),

      // Tauri shims — redirect all @tauri-apps/* to browser-compatible stubs
      "@tauri-apps/api/core": resolve(__dirname, "./src/lib/tauri-shims/api-core.ts"),
      "@tauri-apps/api/window": resolve(__dirname, "./src/lib/tauri-shims/api-window.ts"),
      "@tauri-apps/api/path": resolve(__dirname, "./src/lib/tauri-shims/api-path.ts"),
      "@tauri-apps/api/app": resolve(__dirname, "./src/lib/tauri-shims/api-app.ts"),
      "@tauri-apps/api/event": resolve(__dirname, "./src/lib/tauri-shims/api-event.ts"),
      "@tauri-apps/plugin-shell": resolve(__dirname, "./src/lib/tauri-shims/plugin-shell.ts"),
      "@tauri-apps/plugin-dialog": resolve(__dirname, "./src/lib/tauri-shims/plugin-dialog.ts"),
      "@tauri-apps/plugin-opener": resolve(__dirname, "./src/lib/tauri-shims/plugin-opener.ts"),
      "@tauri-apps/plugin-http": resolve(__dirname, "./src/lib/tauri-shims/plugin-http.ts"),
      "@tauri-apps/plugin-global-shortcut": resolve(__dirname, "./src/lib/tauri-shims/plugin-global-shortcut.ts"),
    },
  },

  // Single-page web build — main view only (no spotlight, clipboard, etc.)
  build: {
    outDir: "dist-web",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "web.html"),
      },
    },
  },

  server: {
    port: 1421,
    strictPort: false,
    proxy: {
      "/ws": {
        target: `ws://localhost:${wsPort}`,
        ws: true,
      },
      "/files": {
        target: `http://localhost:${wsPort}`,
      },
    },
  },
});
