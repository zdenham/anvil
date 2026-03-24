# Proxy-Based Network Interceptor

Replace the current `diagnostics_channel` interceptor (which only captures in-process HTTP) with a local MITM proxy that captures all traffic from the SDK subprocess.

## Problem

The Claude Agent SDK spawns a **separate subprocess** for API calls (`shared.ts:1202` passes `env: { ...process.env }` to `query()`). The current `NetworkInterceptor` hooks `undici:request:create` etc. via `diagnostics_channel` — but those hooks only fire in the **runner process**, not the SDK's child process. So the actual Anthropic API calls are invisible.

## Approach: Local HTTPS CONNECT Proxy

HTTP Toolkit's key insight: **environment variables are inherited by child processes**. We don't need to modify the SDK — we just need to:

1. Start a local proxy server in the runner process
2. Set `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS` in the env before `query()` is called
3. The SDK subprocess inherits these, routes all HTTPS through our proxy
4. Proxy observes traffic, emits `NetworkEvent`s through the existing hub pipeline

## Architecture

```
Frontend clicks "Record"
    ↓
toggleCapture → store.isCapturing = true
(no backend change needed — proxy is always-on, store already gates on isCapturing)

Agent spawned (spawnSimpleAgent)
    ↓
agent-service.ts sets ANVIL_NETWORK_DEBUG=1 (already done)
    ↓
runner.ts starts ProxyServer on random loopback port
runner.ts sets process.env.HTTPS_PROXY + NODE_EXTRA_CA_CERTS
    ↓
shared.ts query() call passes { ...process.env } to SDK
SDK subprocess inherits HTTPS_PROXY → routes through proxy
    ↓
ProxyServer intercepts CONNECT, performs MITM
ProxyServer emits NetworkEvents via callback
    ↓
hub.send({ type: "network", ... }) — existing pipeline
    ↓
Frontend store receives events (already working)
```

## Phases

- [x] Phase 1: CA certificate generation + trust
- [x] Phase 2: HTTPS CONNECT proxy server
- [x] Phase 3: Integrate proxy into runner + env var injection
- [x] Phase 4: Wire response body streaming
- [x] Phase 5: Clean up old diagnostics_channel interceptor, test end-to-end

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: CA Certificate Generation + Trust

**Files:**
- `agents/src/lib/proxy/cert-manager.ts` (~100 lines)
- `agents/src/lib/proxy/der.ts` (~150 lines) — minimal DER/ASN.1 encoder

Generate a self-signed CA cert on first run, cache it to `$ANVIL_DATA_DIR/proxy-ca/`. Reuse across sessions. **Zero external dependencies** — uses Node built-in `crypto` module with a small DER encoder for X.509 certificate construction.

```typescript
class CertManager {
  private caKeyPath: string;
  private caCertPath: string;

  constructor(anvilDir: string) { /* paths under anvilDir/proxy-ca/ */ }

  /** Generate CA key + cert if not already on disk. Idempotent. */
  async ensureCA(): Promise<{ certPath: string; keyPath: string }>;

  /** Generate a TLS cert for a given hostname, signed by our CA. */
  async certForHost(hostname: string): Promise<tls.SecureContext>;
}
```

**Certificate generation approach (zero-dep):**

Node has no built-in X.509 certificate *creation* API — `crypto.X509Certificate` is read-only. Instead we construct DER-encoded certificates manually:

1. `crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'der' } })` — generates key pair, SPKI output slots directly into the TBSCertificate structure
2. `agents/src/lib/proxy/der.ts` — a small DER encoder (~150 lines) providing: `derSequence`, `derInteger`, `derOid`, `derBitString`, `derUtcTime`, `derPrintableString`, `derExplicitTag`, `derSet`, `derOctetString`
3. Build TBSCertificate DER from these primitives (version, serial, issuer/subject DN, validity, SPKI, extensions like BasicConstraints + SubjectAltName + KeyUsage)
4. Sign TBSCertificate bytes with `crypto.createSign('SHA256')`
5. Wrap in outer Certificate SEQUENCE, base64 + PEM headers

This is a well-established pattern (see `@root/asn1`, `indutny/self-signed`). The DER encoder is straightforward — ASN.1 *generation* is simpler than *parsing*.

**Hardcoded OIDs:** `sha256WithRSAEncryption` (1.2.840.113549.1.1.11), `rsaEncryption` (1.2.840.113549.1.1.1), `commonName` (2.5.4.3), `basicConstraints` (2.5.29.19), `subjectAltName` (2.5.29.17), `keyUsage` (2.5.29.15)

- CA validity: 1 year, auto-regenerate if expired
- Host certs: generated on-the-fly, cached in-memory (LRU, ~100 entries)
- Validate generated certs with `new crypto.X509Certificate(pem)` in tests
- The CA cert file path is what we pass to `NODE_EXTRA_CA_CERTS`

## Phase 2: HTTPS CONNECT Proxy Server

**File: `agents/src/lib/proxy/proxy-server.ts`** (~150 lines)

A minimal CONNECT proxy that performs MITM on HTTPS connections:

```typescript
class ProxyServer {
  private server: net.Server;
  private certManager: CertManager;
  private emitFn: (event: NetworkEvent) => void;

  constructor(certManager: CertManager, emitFn: (event: NetworkEvent) => void);

  /** Start listening on a random loopback port. Idempotent. */
  async start(): Promise<{ port: number; certPath: string }>;

  /** Graceful shutdown. */
  async stop(): Promise<void>;
}
```

**CONNECT flow:**
1. Client (SDK subprocess) sends `CONNECT api.anthropic.com:443`
2. Proxy responds `200 Connection Established`
3. Proxy creates a TLS server socket using a cert for `api.anthropic.com` (from CertManager)
4. Proxy creates a TLS client socket to the real `api.anthropic.com:443`
5. Proxy pipes decrypted data between client↔server, observing in transit
6. On request: emit `request-start` with URL, method, headers, body
7. On response headers: emit `response-headers` with status, headers, timing
8. On response chunks: emit `response-chunk` with content
9. On response end: emit `response-end`

**HTTP parsing:** Use Node's built-in `http.createServer` in the decrypted stream rather than manual parsing. Specifically:
- After TLS handshake, pipe the decrypted client stream into `http.createServer`
- For each request, forward via `http.request` to the real server over the outbound TLS connection
- This gives us clean request/response objects with parsed headers

**Scope:** Only proxy HTTPS CONNECT requests. Plain HTTP requests can pass through or be rejected (the Anthropic API is HTTPS-only).

## Phase 3: Runner Integration + Env Injection

**Modified file: `agents/src/runner.ts`** (~20 lines changed)

Replace the `diagnostics_channel` interceptor setup (lines 365-379) with proxy startup:

```typescript
if (process.env.ANVIL_NETWORK_DEBUG === "1") {
  const { CertManager } = await import("./lib/proxy/cert-manager.js");
  const { ProxyServer } = await import("./lib/proxy/proxy-server.js");

  const certManager = new CertManager(config.anvilDir);
  await certManager.ensureCA();

  const proxy = new ProxyServer(certManager, (event) => {
    const { type: networkType, ...rest } = event;
    hub?.send({ type: "network", networkType, ...rest });
  });

  const { port, certPath } = await proxy.start();

  // Inject into process.env so SDK subprocess inherits
  process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`;
  process.env.HTTP_PROXY = `http://127.0.0.1:${port}`;
  process.env.NODE_EXTRA_CA_CERTS = certPath;

  // Clean up on exit
  abortController.signal.addEventListener("abort", () => proxy.stop());
}
```

**Key detail:** `shared.ts:1202` already does `env: { ...process.env }`, so the proxy env vars propagate to the SDK subprocess automatically. No changes needed in `shared.ts`.

**Frontend changes: None.** The `agent-service.ts` already sets `ANVIL_NETWORK_DEBUG=1`. The store already gates on `isCapturing`. The Record button already toggles `isCapturing`. Everything just works — the proxy runs, events flow, and the UI shows/hides based on the existing toggle.

## Phase 4: Response Body Streaming

The current `NetworkEvent` type already defines `response-chunk`:
```typescript
{ type: "response-chunk"; requestId: string; content: string; chunkSize: number; totalSize: number }
```

And the store already handles it in `handleResponseChunk`. So we just need the proxy to emit these events as it observes response data flowing through.

**Streaming approach:**
- The Anthropic API uses SSE (`text/event-stream`). Each SSE event is a line of JSON.
- Proxy reads response body in chunks as they arrive, emits `response-chunk` for each
- Keep total byte count for `totalSize`
- Emit `response-end` when response completes

**Body size guard:** Cap captured body at ~1MB per request to avoid memory issues. After that, still track size but stop accumulating content.

## Phase 5: Cleanup + Testing

1. **Delete** `agents/src/lib/network-interceptor.ts` and its tests (the diagnostics_channel approach)
2. **Add unit tests** for `CertManager` (cert generation, caching, expiry)
3. **Add unit tests** for `ProxyServer` (CONNECT handling, event emission, cleanup)
4. **Add integration test** that starts a proxy, makes an HTTPS request through it, verifies events are emitted

## Dependencies

**None.** All built on Node builtins:
- `crypto` — key generation (`generateKeyPairSync`), signing (`createSign`), cert validation (`X509Certificate`)
- `net`, `tls`, `http` — proxy server, TLS termination, HTTP parsing
- `fs`, `path` — cert caching to disk

The DER encoder (`agents/src/lib/proxy/der.ts`) is ~150 lines of our own code, not a dependency.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SDK subprocess doesn't respect `HTTPS_PROXY` | Node.js undici respects it since v18.7. The SDK runs on the user's local Node — verify once in Phase 3 integration test |
| DER encoder produces invalid certs | Validate with `new crypto.X509Certificate(pem)` + TLS handshake test in Phase 1 |
| Cert generation is slow | Generate once, cache to disk. Host certs cached in-memory LRU |
| Proxy adds latency | Loopback only, no DNS. Expect <1ms added per request |
| Large response bodies blow memory | 1MB cap per request body capture |
| Port conflicts | Use port 0 (OS assigns random available port) |
| Agent exits before proxy cleanup | Proxy binds to loopback only, OS reclaims on process exit |
