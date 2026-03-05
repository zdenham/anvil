# Streaming Architecture v2 — Sub-Plans

Parent plan: [streaming-architecture-v2.md](../streaming-architecture-v2.md)

## Problem

The streaming architecture has race conditions by design: two stores, two chain trackers, disk reads during streaming, and competing scroll effects create a combinatorial explosion of edge cases. This decomposition restructures the fix into independently-implementable phases.

## Dependency Graph

```
Phase 0 (agent cleanup) ──→ Phase 1 (shared reducer) ──→ Phase 2 (unified store) ──→ Phase 3 (no disk reads)
Phase 4 (trickle) — independent
Phase 5 (scroll) — independent
Phase 6 (tests) — can start immediately, full value after Phase 3
```

## Phases

- [ ] [Phase 0: Agent-Side Cleanup](./phase-0-agent-emission.md) — delete chain tracking, ReconnectQueue, add StoredMessage (agents/ only, prep for Phase 1)
- [ ] [Phase 1: Shared Thread Reducer](./phase-1-state-machine.md) — pure reducer in `core/`, action-based emission, refactor `output.ts`, client state machine
- [ ] [Phase 2: Unified Store](./phase-2-unified-store.md) — replace streaming-store + thread-store render state
- [ ] [Phase 3: No Disk Reads](./phase-3-no-disk-reads.md) — events-only while streaming, disk on cold start/completion
- [ ] [Phase 4: Trickle Audit](./phase-4-trickle-audit.md) — verify only final block re-renders during streaming
- [ ] [Phase 5: ScrollCoordinator](./phase-5-scroll-coordinator.md) — replace two-effect scroll system with single class
- [ ] [Phase 6: Event Replay Tests](./phase-6-event-replay.md) — event debugger export + Playwright replay tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Parallelism

**Wave 1** (no dependencies): Phase 0, Phase 4, Phase 5
**Wave 2** (after Phase 0): Phase 1
**Wave 3** (after Phase 1): Phase 2
**Wave 4** (after Phase 2): Phase 3
**Wave 5** (after Phase 3 for full value, but can start early): Phase 6

## Scope Per Sub-Plan

| Sub-plan | Codebase | Estimated Files | Risk |
|----------|----------|-----------------|------|
| Phase 0 | `agents/`, `core/types/` | 8-10 files | Low — deletions + type additions |
| Phase 1 | `core/lib/`, `agents/src/`, `src/lib/` | 7 files | Medium — shared reducer + emission model change |
| Phase 2 | `src/stores/`, `src/lib/` | 5-8 files | High — replaces core stores |
| Phase 3 | `src/lib/listeners.ts` | 2-3 files | Medium — depends on Phase 0+2 |
| Phase 4 | `src/components/` | 0-2 files (audit) | Low — verification pass |
| Phase 5 | `src/lib/`, `src/components/` | 3-4 files | Low — isolated extraction |
| Phase 6 | `src/stores/`, `e2e/` | 4-6 files | Low — additive only |
