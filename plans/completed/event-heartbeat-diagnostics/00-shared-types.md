# 00: Shared Types & Diagnostic Config

**Depends on**: Nothing (execute first)
**Blocks**: 01-agent-side, 02-rust-hub, 03-frontend (all three)

## Overview

Create the shared type definitions that all three layers (agent, Rust hub, frontend) depend on. This is a small, focused sub-plan that unblocks everything else.

## Phases

- [x] Create `core/types/pipeline.ts` with PipelineStage and PipelineStamp types
- [x] Create `core/types/diagnostic-logging.ts` with DiagnosticLoggingConfig and helpers
- [x] Export new types from `core/types/index.ts` (or verify barrel export pattern)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### `core/types/pipeline.ts`

```typescript
export type PipelineStage =
  | "agent:sent"        // Agent wrote message to socket
  | "hub:received"      // Rust hub parsed the message from socket
  | "hub:emitted"       // Rust hub called app_handle.emit()
  | "frontend:received" // Frontend agent:message listener fired

export interface PipelineStamp {
  stage: PipelineStage;
  seq: number;          // Monotonic per-agent sequence number
  ts: number;           // Timestamp at this stage (ms since epoch)
}
```

### `core/types/diagnostic-logging.ts`

```typescript
export interface DiagnosticLoggingConfig {
  pipeline: boolean;      // Per-message pipeline stage stamps at every hop
  heartbeat: boolean;     // Heartbeat timing details: jitter, latency
  sequenceGaps: boolean;  // Detailed sequence gap context
  socketHealth: boolean;  // Write failures, backpressure stats, connection state
}

export const DEFAULT_DIAGNOSTIC_LOGGING: DiagnosticLoggingConfig = {
  pipeline: false,
  heartbeat: false,
  sequenceGaps: false,
  socketHealth: false,
};

/** Helper: true if any module is enabled */
export function isDiagnosticEnabled(config: DiagnosticLoggingConfig): boolean {
  return Object.values(config).some(Boolean);
}
```

### Key Decisions

- **Zod schemas at boundaries**: Add Zod schemas for both types since they cross trust boundaries (disk settings file, env var parsing, IPC messages). The Zod schema for `DiagnosticLoggingConfig` is used when parsing `ANVIL_DIAGNOSTIC_LOGGING` env var and when reading from `SettingsStoreClient`.
- **PipelineStamp Zod schema**: Used in `agent-service.ts` when validating incoming messages from the socket (trust boundary).
- **Type layering**: These live in `core/types/` so both `agents/` and `src/` can import them without violating the import direction rule (`src/ → agents/ → core/`).

## Files

| Action | File | Description |
|--------|------|-------------|
| Create | `core/types/pipeline.ts` | PipelineStage type, PipelineStamp interface + Zod schema |
| Create | `core/types/diagnostic-logging.ts` | DiagnosticLoggingConfig interface, defaults, helpers + Zod schema |
| Modify | `core/types/index.ts` | Re-export new modules (if barrel export pattern exists) |
