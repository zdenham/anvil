import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CertManager } from "../cert-manager.js";
import crypto from "crypto";
import tls from "tls";
import fs from "fs";
import os from "os";
import path from "path";

describe("CertManager", () => {
  let tmpDir: string;
  let manager: CertManager;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-cert-test-"));
    manager = new CertManager(tmpDir);
    await manager.ensureCA();
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates a valid CA certificate", () => {
    const certPath = manager.certPath;
    expect(fs.existsSync(certPath)).toBe(true);

    const pem = fs.readFileSync(certPath, "utf-8");
    const x509 = new crypto.X509Certificate(pem);

    expect(x509.issuer).toContain("Anvil Debug Proxy CA");
    expect(x509.subject).toContain("Anvil Debug Proxy CA");
    expect(x509.ca).toBe(true);
  });

  it("ensureCA is idempotent (reuses existing cert)", async () => {
    const certBefore = fs.readFileSync(manager.certPath, "utf-8");
    await manager.ensureCA();
    const certAfter = fs.readFileSync(manager.certPath, "utf-8");
    expect(certAfter).toBe(certBefore);
  });

  it("generates a valid host certificate", () => {
    const ctx = manager.certForHost("api.anthropic.com");
    expect(ctx).toBeDefined();
    // SecureContext is opaque but non-null means it was created successfully
  });

  it("caches host certificates", () => {
    const ctx1 = manager.certForHost("example.com");
    const ctx2 = manager.certForHost("example.com");
    expect(ctx1).toBe(ctx2); // same reference
  });

  it("host cert passes TLS handshake against CA", async () => {
    const caCert = fs.readFileSync(manager.certPath, "utf-8");
    const hostCtx = manager.certForHost("localhost");

    // Start a TLS server using SNICallback (the proper way to use SecureContext)
    const server = tls.createServer(
      { SNICallback: (_servername, cb) => cb(null, hostCtx) },
      (socket) => { socket.end("ok"); },
    );

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    // Connect as a client trusting our CA
    const result = await new Promise<string>((resolve, reject) => {
      const client = tls.connect(
        { host: "127.0.0.1", port: addr.port, ca: caCert, servername: "localhost" },
        () => {
          let data = "";
          client.on("data", (chunk) => (data += chunk));
          client.on("end", () => resolve(data));
        },
      );
      client.on("error", reject);
    });

    expect(result).toBe("ok");
    server.close();
  });
});
