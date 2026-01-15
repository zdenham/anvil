# Event System Overhaul - Sub-plans

**Parent Plan**: `../event-system-overhaul.md`

---

## Parallel Execution Overview

```
                    ┌─────────────────────┐
                    │  01-foundation.md   │
                    │     (Phase 1)       │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│   02-agent-events.md    │       │  03-frontend-parsing.md │
│   (Phases 2, 3, 4)      │       │   (Phases 5, 6, 7)      │
│                         │       │                         │
│   • Agent event emitter │       │   • Event parser        │
│   • CLI emissions       │       │   • Agent service       │
│   • Orchestration       │       │   • Loading state fix   │
└────────────┬────────────┘       └────────────┬────────────┘
             │         PARALLEL                │
             └────────────────┬────────────────┘
                              │
                              ▼
              ┌─────────────────────────┐
              │ 04-listeners-cleanup.md │
              │  (Phases 9, 10, 8, 11)  │
              │                         │
              │   • Entity listeners    │
              │   • Service cleanup     │
              │   • Event bridge        │
              │   • AppEvents type      │
              └─────────────────────────┘
```

---

## Execution Schedule

| Order | Sub-plan | Est. Files | Can Start After |
|-------|----------|------------|-----------------|
| 1 | `01-foundation.md` | 5 | Immediately |
| 2a | `02-agent-events.md` | 3 | Sub-plan 1 |
| 2b | `03-frontend-parsing.md` | 5 | Sub-plan 1 |
| 3 | `04-listeners-cleanup.md` | 8 | Sub-plans 2a & 2b |

**Key parallelization**: Sub-plans 2a and 2b can run simultaneously.

---

## Bug Resolution Map

| Bug | Description | Fixed In |
|-----|-------------|----------|
| Bug 1 | content.md not rendering live | 03-frontend-parsing (Phase 6) |
| Bug 2 | Task updates not rendering | 04-listeners-cleanup (Phase 9) |
| Bug 3 | Thread list not updating | 04-listeners-cleanup (Phase 9) |
| Bug 4 | Action panel no loading state | 03-frontend-parsing (Phase 7) |

---

## Quick Reference

### Sub-plan 1: Foundation
- Creates shared types in `core/types/events.ts`
- Single source of truth for event names and payloads
- Must complete before anything else

### Sub-plan 2: Agent Events
- Rewrites `agents/src/lib/events.ts` with typed emitter
- Adds event emissions to CLI commands
- Converts orchestration logs to events

### Sub-plan 3: Frontend Parsing
- Creates typed event parser
- Refactors agent-service to use parser
- Implements optimistic thread creation for loading state

### Sub-plan 4: Listeners & Cleanup
- Creates entity listener files
- Removes scattered handlers
- Updates event bridge and AppEvents type

---

## Files Changed Summary

| Sub-plan | Create | Modify | Delete From |
|----------|--------|--------|-------------|
| 1 | `core/types/events.ts`, `core/types/settings.ts` | `core/types/index.ts` | `agents/src/output.ts`, `src/lib/types/agent-messages.ts`, `agents/src/agent-types/merge-types.ts` |
| 2 | - | `agents/src/lib/events.ts`, `agents/src/cli/mort.ts`, `agents/src/orchestration.ts` | - |
| 3 | `src/lib/agent-output-parser.ts` | `src/lib/agent-service.ts`, `src/entities/threads/service.ts`, `src/entities/threads/store.ts`, `src/hooks/use-action-state.ts` | - |
| 4 | `src/entities/tasks/listeners.ts`, `src/entities/threads/listeners.ts`, `src/entities/repositories/listeners.ts` | `src/entities/index.ts`, `src/entities/events.ts`, `src/lib/event-bridge.ts`, `src/entities/threads/service.ts` | - |
