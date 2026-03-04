import net from "net";
import tls from "tls";
import http from "http";
import type { CertManager } from "./cert-manager.js";
import type { NetworkEvent } from "@core/types/network-events.js";
import { logger } from "../logger.js";

const REDACTED_HEADERS = new Set(["authorization", "x-api-key", "cookie"]);
const MAX_BODY_SIZE = 1_048_576; // 1MB cap per request

/** Sanitize headers: lowercase keys, redact sensitive values. */
function sanitizeHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    const val = Array.isArray(value) ? value.join(", ") : (value ?? "");
    result[lower] = REDACTED_HEADERS.has(lower) ? "[REDACTED]" : val;
  }
  return result;
}

export interface ProxyServerOptions {
  /** Extra TLS options for outbound connections (e.g. ca, rejectUnauthorized for tests). */
  targetTlsOptions?: tls.ConnectionOptions;
}

/**
 * Local HTTPS CONNECT proxy that performs MITM to observe API traffic.
 *
 * Binds to 127.0.0.1 only. The SDK subprocess inherits HTTPS_PROXY env var
 * and routes all HTTPS traffic through this proxy, making API calls visible.
 */
export class ProxyServer {
  private server: net.Server | null = null;
  private certManager: CertManager;
  private emitFn: (event: NetworkEvent) => void;
  private requestCounter = 0;
  private options: ProxyServerOptions;

  constructor(
    certManager: CertManager,
    emitFn: (event: NetworkEvent) => void,
    options: ProxyServerOptions = {},
  ) {
    this.certManager = certManager;
    this.emitFn = emitFn;
    this.options = options;
  }

  /** Start listening on a random loopback port. */
  async start(): Promise<{ port: number }> {
    if (this.server) throw new Error("ProxyServer already started");

    this.server = net.createServer((clientSocket) => {
      this.handleConnection(clientSocket);
    });

    this.server.on("error", (err) => {
      logger.error(`[proxy-server] Server error: ${err.message}`);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address() as net.AddressInfo;
        logger.info(`[proxy-server] Listening on 127.0.0.1:${addr.port}`);
        resolve({ port: addr.port });
      });
      this.server!.once("error", reject);
    });
  }

  /** Graceful shutdown. */
  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        logger.info("[proxy-server] Stopped");
        this.server = null;
        resolve();
      });
    });
  }

  private handleConnection(clientSocket: net.Socket): void {
    clientSocket.once("data", (data) => {
      const line = data.toString("utf-8").split("\r\n")[0];
      const match = line.match(/^CONNECT\s+([^:]+):(\d+)\s+HTTP\//);
      if (!match) {
        clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }

      const hostname = match[1];
      const port = parseInt(match[2], 10);

      // Respond with 200 to establish tunnel
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

      this.performMitm(clientSocket, hostname, port);
    });

    clientSocket.on("error", (err) => {
      logger.debug(`[proxy-server] Client socket error: ${err.message}`);
    });
  }

  private performMitm(clientSocket: net.Socket, hostname: string, port: number): void {
    // Get a cert for this hostname signed by our CA
    const secureContext = this.certManager.certForHost(hostname);

    // TLS-wrap the client side (we pretend to be the target server)
    const tlsClient = new tls.TLSSocket(clientSocket, {
      isServer: true,
      secureContext,
    });

    tlsClient.on("error", (err) => {
      logger.debug(`[proxy-server] TLS client error (${hostname}): ${err.message}`);
    });

    // Create an HTTP server over the decrypted client stream
    const innerServer = http.createServer((req, res) => {
      this.handleRequest(req, res, hostname, port);
    });

    // Feed the TLS-decrypted stream into the HTTP server
    innerServer.emit("connection", tlsClient);
  }

  private handleRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
    hostname: string,
    port: number,
  ): void {
    const requestId = `req-${++this.requestCounter}`;
    const startTime = Date.now();
    const url = `https://${hostname}${clientReq.url ?? "/"}`;

    // Emit request-start
    this.emitFn({
      type: "request-start",
      requestId,
      url,
      method: (clientReq.method ?? "GET").toUpperCase(),
      headers: sanitizeHeaders(clientReq.headers),
      body: null,
      bodySize: 0,
      timestamp: startTime,
    });

    // Connect to the real server over TLS
    const proxyReq = http.request(
      {
        hostname,
        port,
        path: clientReq.url,
        method: clientReq.method,
        headers: clientReq.headers,
        createConnection: () => {
          return tls.connect({
            host: hostname,
            port,
            servername: hostname,
            ...this.options.targetTlsOptions,
          });
        },
      },
      (proxyRes) => {
        const duration = Date.now() - startTime;

        // Emit response-headers
        this.emitFn({
          type: "response-headers",
          requestId,
          status: proxyRes.statusCode ?? 0,
          statusText: proxyRes.statusMessage ?? "",
          headers: sanitizeHeaders(proxyRes.headers),
          duration,
        });

        // Forward status + headers to client
        clientRes.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);

        // Stream response body through, emitting chunks
        let totalSize = 0;
        proxyRes.on("data", (chunk: Buffer) => {
          clientRes.write(chunk);

          totalSize += chunk.length;
          if (totalSize <= MAX_BODY_SIZE) {
            this.emitFn({
              type: "response-chunk",
              requestId,
              content: chunk.toString("utf-8"),
              chunkSize: chunk.length,
              totalSize,
            });
          }
        });

        proxyRes.on("end", () => {
          clientRes.end();
          this.emitFn({
            type: "response-end",
            requestId,
            bodySize: totalSize,
          });
        });

        proxyRes.on("error", (err) => {
          logger.debug(`[proxy-server] Upstream response error: ${err.message}`);
          clientRes.end();
        });
      },
    );

    proxyReq.on("error", (err) => {
      const duration = Date.now() - startTime;
      this.emitFn({
        type: "request-error",
        requestId,
        error: err.message,
        duration,
      });
      clientRes.writeHead(502);
      clientRes.end("Bad Gateway");
    });

    // Pipe client request body to upstream
    clientReq.pipe(proxyReq);
  }
}
