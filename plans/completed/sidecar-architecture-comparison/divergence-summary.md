# Divergence Summary

## Where implementations diverge most

| Area | Range of approaches | Most divergent |
| --- | --- | --- |
| **Dispatch pattern** | Map registry vs prefix switch vs if-chain | baseline (Map) vs breadcrumb-loop (if-chain) |
| **Manager style** | Global Maps vs singleton classes vs state container | baseline (Maps) vs breadcrumb-loop (StateImpl) |
| **I/O model** | All async vs all sync vs mixed | decompose (all sync) vs baseline/breadcrumb-loop (async) |
| **Rust cleanup** | Minimal vs aggressive | cc-teams (removed 6+ crates) vs vanilla-orchestrate (kept everything) |
| **Dialog shims** | No-op vs throw vs browser file picker | decompose (file picker) vs cc-teams (throw) |
| **Lock strategy** | In-memory counter vs UUID vs file-based | vanilla-orchestrate (file-based) vs baseline (counter) |
| **Build tool** | tsc vs tsup | decompose/breadcrumb-loop (tsup) vs others (tsc) |
| **Readiness check** | None vs port file polling | decompose (15s poll, broken) vs all others (none) |
| **Test coverage** | None vs 630+ lines | cc-teams (tests) vs all others (none) |
| **Sidecar output path** | `sidecar/dist/` vs `dist-sidecar/` | cc-teams (dist-sidecar/) vs others (sidecar/dist/) |

## Where all implementations agree

Every implementation made these same choices:

 1. Express (or raw http) + `ws` library with `noServer` mode
 2. Two WS endpoints: `/ws` (frontend) + `/ws/agent` (agents)
 3. Port 9600 default with `ANVIL_WS_PORT` env override
 4. Port file at `~/.anvil/sidecar-{hash}.port`
 5. Same wire protocol: `{ id, cmd, args }` → `{ id, result/error }`
 6. Same push event protocol: `{ event, payload }`
 7. Relay events via `{ relay: true, event, payload }`
 8. `/files?path=...` HTTP endpoint for asset serving
 9. `convertFileSrc()` → HTTP file server URL in browser mode
10. `invoke()` transport wrapper with native command list
11. Exponential backoff reconnection (max 10s)
12. 30s request timeout
13. Agent hub with pipeline stamping and sequence gap detection
14. node-pty for PTY sessions, chokidar for file watching
15. No Zod validation at WebSocket boundary (all use unsafe casts)
16. No authentication on localhost WebSocket
17. No TLS (plain WebSocket on loopback)