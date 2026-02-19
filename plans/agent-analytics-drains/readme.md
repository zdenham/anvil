# Agent Analytics Drains — Parent Plan

## Summary

Decomposition of `plans/agent-analytics-drains.md` into four parallel-executable sub-plans. The original plan defines the full system; this directory breaks it into independent work units that converge on a shared protocol contract.

## Phases

- [x] Core types (drain-events.ts) — no dependencies, unblocks everything
- [x] Rust SQLite layer + worker + hub routing — depends on protocol contract below
- [x] TS DrainManager + hub client extension — depends on core types
- [x] Hook instrumentation (shared.ts + message-handler.ts) — depends on DrainManager

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Execution Graph

```
                 ┌──────────────────┐
                 │  01-core-types   │  (no deps — start first)
                 └────────┬─────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
   ┌────────────────────┐  ┌─────────────────────┐
   │  02-rust-sqlite    │  │  03-drain-manager    │
   │  (Rust side)       │  │  (TS side)           │
   └────────────────────┘  └──────────┬───────────┘
                                      │
                                      ▼
                           ┌─────────────────────┐
                           │ 04-instrumentation   │
                           │ (hooks + handler)    │
                           └─────────────────────┘
```

**Parallelism:** `02-rust-sqlite` and `03-drain-manager` can run concurrently once `01-core-types` is done. They share no files. `04-instrumentation` depends on `03-drain-manager` because it imports and calls `DrainManager`.

## Shared Protocol Contract

All sub-plans must agree on this wire format over the hub socket.

### Hub Socket Message: `"drain"` type

```typescript
// Added to agents/src/lib/hub/types.ts
export interface DrainMessage extends SocketMessage {
  type: "drain";
  event: string;                              // e.g. "tool:started"
  properties: Record<string, string | number | boolean>;
}
```

### Rust-side: `agent_hub.rs` receives this and emits tracing

```rust
// In handle_connection(), after relay handling:
if msg.msg_type == "drain" {
    if let (Some(event), Some(props)) = (
        msg.rest.get("event").and_then(|v| v.as_str()),
        msg.rest.get("properties"),
    ) {
        let props_str = props.to_string();
        tracing::info!(
            target: "drain",
            thread_id = %msg.thread_id,
            event = %event,
            properties = %props_str,
        );
    }
    continue;
}
```

### SQLite Layer: filters on `target == "drain"`

The `SQLiteLayer` only captures events with `target: "drain"`. It decomposes the structured fields into EAV rows per the schema in the original plan.

### Event catalog

The full event catalog (names, properties) is defined in the original plan (`plans/agent-analytics-drains.md` § Event Catalog). All sub-plans reference it as the source of truth.

## Sub-Plans

| File | Scope | Est. LOC | Depends On |
|------|-------|----------|------------|
| `01-core-types.md` | Zod schemas in `core/types/drain-events.ts` | ~120 | nothing |
| `02-rust-sqlite.md` | `SQLiteLayer` + worker + hub routing + subscriber registration | ~450 | protocol contract |
| `03-drain-manager.md` | `DrainManager` class + `HubClient.sendDrain()` + hub types | ~100 | `01-core-types` |
| `04-instrumentation.md` | Hook emit points in `shared.ts` + `message-handler.ts` | ~200 | `03-drain-manager` |
