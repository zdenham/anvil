/**
 * Mort sidecar server entry point.
 *
 * Express + WebSocket server that handles all data commands for the
 * Mort frontend (both Tauri webview and standalone web browser).
 */

import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { lookup } from "mime-types";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { handleConnection } from "./ws-handler.js";
import { createState } from "./state.js";
import { createLogger } from "./logger.js";

const PORT = parseInt(process.env.MORT_WS_PORT ?? "9600", 10);

const app = express();
const server = createServer(app);
const state = createState();
const log = createLogger(state);

// ── CORS ────────────────────────────────────────────────────────────────

app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

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
  res.json({ status: "ok", port: PORT });
});

// ── WebSocket servers (noServer mode for correct path routing) ──────

const wss = new WebSocketServer({ noServer: true });
const wssAgent = new WebSocketServer({ noServer: true });

wss.on("connection", (socket) => handleConnection(socket, state));
wssAgent.on("connection", (socket) => state.agentHub.handleConnection(socket));

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

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

// ── Start ───────────────────────────────────────────────────────────────

server.listen(PORT, "127.0.0.1", () => {
  log.info(`listening on http://127.0.0.1:${PORT} (ws, ws/agent)`);
});

// Graceful shutdown
function shutdown(signal: string): void {
  log.info(`${signal} received, shutting down`);
  state.terminalManager.dispose();
  state.fileWatcherManager.dispose();
  wss.close();
  server.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
