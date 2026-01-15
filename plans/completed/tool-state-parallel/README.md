# Tool State Types and Tests - Parallel Execution Plans

These plans break down the main `tool-state-types-and-tests.md` into parallelizable work streams.

## Execution Order

```
Stream 1 (Foundation)
    │
    ├──► Stream 2A (output.ts) ──► Stream 3A (MessageHandler) ──┐
    │                                                           │
    ├──► Stream 2B (assertions) ────────────────────────────────┼──► Stream 4 (Integration)
    │                                                           │
    └──► Stream 2C (mock types) ──► Stream 3B (mock emission) ──┘
```

## Plans

| Stream | File | Dependencies | Can Parallel With |
|--------|------|--------------|-------------------|
| 1 | `1-schema.md` | None | - |
| 2A | `2a-output.md` | Stream 1 | 2B, 2C |
| 2B | `2b-assertions.md` | Stream 1 | 2A, 2C |
| 2C | `2c-mock-types.md` | Stream 1 | 2A, 2B |
| 3A | `3a-message-handler.md` | Stream 2A | 3B |
| 3B | `3b-mock-emission.md` | Stream 2C | 3A |
| 4 | `4-integration.md` | Streams 3A, 3B, 2B | - |

## Verification

After all streams complete:
```bash
pnpm typecheck
pnpm test:agents
```
