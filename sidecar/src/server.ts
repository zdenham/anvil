/**
 * Anvil sidecar server entry point.
 *
 * Express + WebSocket server that handles all data commands for the
 * Anvil frontend (both Tauri webview and standalone web browser).
 */

import express from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { lookup } from "mime-types";
import { readFile, stat, writeFile, unlink, mkdir } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { handleConnection } from "./ws-handler.js";
import { createState } from "./state.js";
import { createLogger } from "./logger.js";
import { createHookRouter } from "./hooks/hook-handler.js";
import { writeHooksJson } from "./hooks/hooks-writer.js";

const BASE_PORT = parseInt(process.env.ANVIL_WS_PORT ?? "9600", 10);
const MAX_PORT_RETRIES = 10;
const APP_SUFFIX = process.env.ANVIL_APP_SUFFIX ?? "";
const DATA_DIR = process.env.ANVIL_DATA_DIR ?? "";
const NO_AUTH = process.env.ANVIL_SIDECAR_NO_AUTH === "1";

let actualPort = BASE_PORT;
const authToken = randomBytes(32).toString("hex");

const app = express();
const server = createServer(app);
const state = createState();
const log = createLogger(state);

// ── CORS ────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set(["tauri://localhost", "http://tauri.localhost"]);

app.use((req, res, next) => {
  const origin = req.headers.origin ?? "";
  // Allow tauri:// origins and any http://localhost:<port>
  const allowed = ALLOWED_ORIGINS.has(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin);
  if (allowed) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Anvil-Thread-Id, Authorization",
  );
  next();
});

// ── Auth middleware (skip /health) ────────────────────────────────────

if (!NO_AUTH) {
  app.use((req, res, next) => {
    if (req.path === "/health") return next();

    const header = req.headers.authorization;
    if (header === `Bearer ${authToken}`) return next();

    res.status(401).json({ error: "Unauthorized" });
  });
}

// ── Hook endpoints (Claude CLI HTTP hooks) ───────────────────────────

app.use("/hooks", createHookRouter({
  dataDir: DATA_DIR,
  broadcaster: state.broadcaster,
  log,
}));

// ── File server (/files?path=<absolute-path>) ──────────────────────────

app.get("/files", async (req, res) => {
  const filePath = req.query.path;
  if (typeof filePath !== "string" || !filePath) {
    res.status(400).send("Missing 'path' query parameter");
    return;
  }

  const resolved = resolve(filePath);
  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      res.status(404).send("Not a file");
      return;
    }
    const content = await readFile(resolved);
    const mimeType =
      lookup(extname(resolved)) || "application/octet-stream";
    res.setHeader("Content-Type", mimeType);
    res.send(content);
  } catch {
    res.status(404).send("File not found");
  }
});

// ── Health check ────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", port: actualPort, appSuffix: APP_SUFFIX });
});

// ── WebSocket servers (noServer mode for correct path routing) ──────

const wss = new WebSocketServer({ noServer: true });
const wssAgent = new WebSocketServer({ noServer: true });

wss.on("connection", (socket) => handleConnection(socket, state));
wssAgent.on("connection", (socket) => state.agentHub.handleConnection(socket));

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // Validate token on WebSocket upgrade
  if (!NO_AUTH) {
    const token = url.searchParams.get("token");
    if (token !== authToken) {
      socket.destroy();
      return;
    }
  }

  if (pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else if (pathname === "/ws/agent") {
    wssAgent.handleUpgrade(request, socket, head, (ws) => {
      wssAgent.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ── Port file ────────────────────────────────────────────────────────────

function portFilePath(): string | null {
  if (!DATA_DIR) return null;
  const suffix = APP_SUFFIX || "default";
  return join(DATA_DIR, `sidecar-${suffix}.port`);
}

async function writePortFile(): Promise<void> {
  const path = portFilePath();
  if (!path) return;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ port: actualPort, appSuffix: APP_SUFFIX, pid: process.pid, token: authToken }),
    );
  } catch (err) {
    log.error(`Failed to write port file: ${err}`);
  }
}

async function removePortFile(): Promise<void> {
  const path = portFilePath();
  if (!path) return;
  try {
    await unlink(path);
  } catch {
    // File may not exist — that's fine
  }
}

// ── Start with EADDRINUSE retry ──────────────────────────────────────────

function tryListen(port: number, attempt: number): void {
  actualPort = port;
  server.listen(port, "127.0.0.1");
}

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    const nextPort = actualPort + 1;
    const attempt = nextPort - BASE_PORT;
    if (attempt >= MAX_PORT_RETRIES) {
      log.error(
        `All ports ${BASE_PORT}–${BASE_PORT + MAX_PORT_RETRIES - 1} are in use — giving up`,
      );
      process.exit(1);
    }
    log.info(`Port ${actualPort} in use, trying ${nextPort}`);
    tryListen(nextPort, attempt);
  } else {
    log.error(`Server error: ${err.message}`);
    process.exit(1);
  }
});

server.on("listening", () => {
  log.info(`listening on http://127.0.0.1:${actualPort} (ws, ws/agent, hooks)`);
  writePortFile();

  // Write hooks.json with resolved port for Claude CLI plugin
  if (DATA_DIR) {
    try {
      writeHooksJson(DATA_DIR, actualPort, NO_AUTH ? undefined : authToken);
      log.info(`wrote hooks.json to ${DATA_DIR}/hooks/hooks.json`);
    } catch (err) {
      log.warn(`failed to write hooks.json: ${err}`);
    }
  }
});

tryListen(BASE_PORT, 0);

// Graceful shutdown
function shutdown(signal: string): void {
  log.info(`${signal} received, shutting down`);
  state.terminalManager.dispose();
  state.fileWatcherManager.dispose();
  wss.close();
  server.close();
  removePortFile().finally(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Process-level error handlers ─────────────────────────────────────

process.on("uncaughtException", (err) => {
  log.error(`[fatal] uncaughtException: ${err.message}`);
  // Process is in undefined state — exit after logging
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg =
    reason instanceof Error ? reason.message : String(reason);
  log.error(`[fatal] unhandledRejection: ${msg}`);
  // Don't exit — rejection may be non-critical (e.g. dropped socket write)
});

// ── WebSocket server error handlers ──────────────────────────────────

wss.on("error", (err) => {
  log.error(`[ws] server error: ${err.message}`);
});

wssAgent.on("error", (err) => {
  log.error(`[ws/agent] server error: ${err.message}`);
});
