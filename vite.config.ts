import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;
const vitePort = parseInt(process.env.MORT_VITE_PORT || "1420", 10);
const appSuffix = process.env.MORT_APP_SUFFIX || "";
const disableHmr = process.env.MORT_DISABLE_HMR === "true";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Expose project root for dev mode agent paths
  define: {
    __PROJECT_ROOT__: JSON.stringify(process.cwd()),
    __MORT_APP_SUFFIX__: JSON.stringify(appSuffix),
  },

  // Path aliases
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@core": resolve(__dirname, "./core"),
    },
  },

  // Multi-page app configuration for main, spotlight, clipboard, and error windows
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        spotlight: resolve(__dirname, "spotlight.html"),
        clipboard: resolve(__dirname, "clipboard.html"),
        error: resolve(__dirname, "error.html"),
        "control-panel": resolve(__dirname, "control-panel.html"),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: vitePort,
    strictPort: true,
    host: host || false,
    hmr: disableHmr
      ? false
      : host
        ? {
            protocol: "ws",
            host,
            port: vitePort + 1,
          }
        : vitePort !== 1420
          ? {
              port: vitePort + 1,
            }
          : undefined,
    // Keep watcher enabled even in no-hmr mode so Vite recompiles on request
    // Only ignore src-tauri in both modes
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
