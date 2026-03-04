import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CertManager } from "../cert-manager.js";
import { ProxyServer } from "../proxy-server.js";
import type { NetworkEvent } from "@core/types/network-events.js";
import http from "http";
import https from "https";
import net from "net";
import tls from "tls";
import fs from "fs";
import os from "os";
import path from "path";

describe("ProxyServer integration", () => {
  let tmpDir: string;
  let certManager: CertManager;
  let events: NetworkEvent[];
  let proxy: ProxyServer;
  let proxyPort: number;
  let caCertPem: string;

  let targetServer: https.Server;
  let targetPort: number;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mort-proxy-test-"));
    certManager = new CertManager(tmpDir);
    await certManager.ensureCA();
    caCertPem = fs.readFileSync(certManager.certPath, "utf-8");

    const targetCtx = certManager.certForHost("localhost");
    targetServer = https.createServer(
      { SNICallback: (_sn, cb) => cb(null, targetCtx) },
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "hello" }));
      },
    );
    await new Promise<void>((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
    targetPort = (targetServer.address() as net.AddressInfo).port;

    events = [];
    proxy = new ProxyServer(certManager, (e) => events.push(e), {
      targetTlsOptions: { ca: caCertPem },
    });
    proxyPort = (await proxy.start()).port;
  });

  afterAll(async () => {
    await proxy.stop();
    targetServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Establish a CONNECT tunnel through the proxy, then return a TLS socket
   * connected to the tunnel (MITM'd by the proxy).
   */
  function connectTunnel(host: string, port: number): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(proxyPort, "127.0.0.1", () => {
        sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
      });

      let buf = "";
      let upgraded = false;

      sock.on("data", (data) => {
        if (upgraded) return;
        buf += data.toString();
        if (!buf.includes("\r\n\r\n")) return;
        if (!buf.startsWith("HTTP/1.1 200")) {
          reject(new Error(`CONNECT failed: ${buf.split("\r\n")[0]}`));
          sock.destroy();
          return;
        }
        upgraded = true;

        const tlsSock = tls.connect({ socket: sock, ca: caCertPem, servername: host }, () => {
          resolve(tlsSock);
        });
        tlsSock.on("error", reject);
      });
      sock.on("error", reject);
    });
  }

  /** Make an HTTP request over a TLS socket and return status + body. */
  function httpOverTls(
    tlsSock: tls.TLSSocket,
    reqPath: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          path: reqPath,
          method: "GET",
          headers: { ...headers, connection: "close" },
          createConnection: () => tlsSock as unknown as net.Socket,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk.toString()));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("intercepts HTTPS request and emits all event types", async () => {
    events.length = 0;

    const tlsSock = await connectTunnel("localhost", targetPort);
    const { status, body } = await httpOverTls(tlsSock, "/v1/test");

    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ message: "hello" });

    const start = events.find((e) => e.type === "request-start");
    expect(start).toBeDefined();
    if (start?.type === "request-start") {
      expect(start.method).toBe("GET");
      expect(start.url).toContain("/v1/test");
    }

    const responseHeaders = events.find((e) => e.type === "response-headers");
    expect(responseHeaders).toBeDefined();
    if (responseHeaders?.type === "response-headers") {
      expect(responseHeaders.status).toBe(200);
    }

    const chunks = events.filter((e) => e.type === "response-chunk");
    expect(chunks.length).toBeGreaterThan(0);

    const end = events.find((e) => e.type === "response-end");
    expect(end).toBeDefined();
  });

  it("redacts authorization headers", async () => {
    events.length = 0;

    const tlsSock = await connectTunnel("localhost", targetPort);
    await httpOverTls(tlsSock, "/v1/auth", { authorization: "Bearer sk-secret" });

    const start = events.find((e) => e.type === "request-start");
    expect(start).toBeDefined();
    if (start?.type === "request-start") {
      expect(start.headers["authorization"]).toBe("[REDACTED]");
    }
  });

  it("emits request-error for unreachable targets", async () => {
    events.length = 0;

    try {
      const tlsSock = await connectTunnel("localhost", 1);
      await httpOverTls(tlsSock, "/unreachable");
    } catch {
      // Expected — upstream connection refused
    }

    await new Promise((r) => setTimeout(r, 200));
    const err = events.find((e) => e.type === "request-error");
    expect(err).toBeDefined();
  });
});
