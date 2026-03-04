# Network Debugger — Chrome DevTools Style

Build a "Network" tab in the debug panel that shows all HTTP requests made by agent processes, with streaming body inspection and request/response detail.

## Sub-plans

| Sub-plan | Scope | Files | ~Lines |
|----------|-------|-------|--------|
| [agent.md](./agent.md) | Interceptor, hub transport, env var wiring | 2 new + 4 modified | ~195 |
| [frontend.md](./frontend.md) | Store, UI components, event bridge routing | 8 new + 3 modified | ~575 |
| [integration-test.md](./integration-test.md) | Live API test confirming interception works | 1 new + 0-2 modified | ~80 |

## Phases

- [x] Agent-side: network interceptor + hub transport + env var (agent.md)
- [x] Frontend: store + UI + streaming viewer + event bridge (frontend.md)
- [x] Integration test: live API verification of interceptor → hub pipeline (integration-test.md)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Dependency

Both sub-plans share `core/types/network-events.ts` (the `NetworkEvent` union type). The agent sub-plan creates this file. The frontend sub-plan includes the type definition inline so it can proceed in parallel — the actual import will resolve once the agent sub-plan writes the file.

## Architecture

```
Agent Process (Node.js)              Tauri                    Frontend
┌──────────────────────┐
│  NetworkInterceptor  │
│  • wraps fetch()     │──hub socket──▶ agent_hub.rs ──tauri event──▶ event-bridge
│  • emits via hub     │               (no changes)                  │
└──────────────────────┘                                    ┌────────▼────────┐
                                                            │ network store   │
                                                            │ NetworkDebugger │
                                                            │ List + Detail   │
                                                            └─────────────────┘
```
