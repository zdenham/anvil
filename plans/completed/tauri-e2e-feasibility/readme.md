# WebSocket Transport Layer & Browser-Based Development

Parent plan for decoupling the Tauri IPC transport layer so the frontend can run in any browser and be tested with Playwright against the real Rust backend.

See [../tauri-e2e-feasibility.md](../tauri-e2e-feasibility.md) for architecture, command classification, and IPC audit.

## Sub-Plans (Sequential)

1. **[ws-server.md](./ws-server.md)** — Rust WebSocket server + HTTP file serving
2. **[frontend-transport.md](./frontend-transport.md)** — Frontend transport wrappers + import migration
3. **[full-coverage-e2e.md](./full-coverage-e2e.md)** — Full command routing + Playwright + cleanup

## Phases

- [x] Rust WS server with proof-of-concept commands + file serving ([ws-server.md](./ws-server.md))
- [x] Frontend transport wrappers + import migration ([frontend-transport.md](./frontend-transport.md))
- [x] Full command coverage + Playwright E2E + mort-test cleanup ([full-coverage-e2e.md](./full-coverage-e2e.md))

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Key Metrics (from audit)

| Surface | Count | Notes |
|---------|-------|-------|
| Rust commands total | 93 | 13 modules |
| Stateless commands | ~38 | Easiest to route — no shared state |
| State<T> commands | 15 | Need Arc<T> shared with WS server |
| AppHandle commands | ~40 | Native-only (mock in browser) |
| Frontend files using `invoke` | ~25 | Was estimated at 55, actual is lower |
| Frontend files using events | ~7 | event-bridge.ts is the hub |
| Frontend files using window APIs | 6 | getCurrentWindow, LogicalSize, etc. |
| Existing command abstraction | `tauri-commands.ts` | Already centralizes with Zod validation |

## Dependencies Between Sub-Plans

```
ws-server.md ──→ frontend-transport.md ──→ full-coverage-e2e.md
     │                    │
     │  WS server on      │  invoke.ts wrapper
     │  :9600 must be      │  must exist before
     │  running before     │  full command routing
     │  transport layer    │  and Playwright can
     │  can connect        │  exercise real backend
     v                    v
```
