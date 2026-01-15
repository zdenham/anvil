# Disk-First Event Architecture - Execution Overview

## Dependency Graph

```
┌─────────────────────┐     ┌─────────────────────┐
│  01-agent-output    │     │  02-service-refresh │
│     (async)         │     │     (method)        │
└─────────┬───────────┘     └──────────┬──────────┘
          │                            │
          │   ┌────────────────────────┘
          │   │
          │   ▼
          │  ┌─────────────────────┐
          │  │  03-event-listeners │
          │  └──────────┬──────────┘
          │             │
          └──────┬──────┘
                 │
                 ▼
        ┌─────────────────────┐
        │ 04-component-migrate│
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │   05-hook-cleanup   │
        └─────────────────────┘
```

## Parallel Execution Waves

| Wave | Plans | Can Run In Parallel |
|------|-------|---------------------|
| 1 | `01-agent-output`, `02-service-refresh` | Yes |
| 2 | `03-event-listeners` | Solo (needs 02) |
| 3 | `04-component-migrate` | Solo (needs 01, 03) |
| 4 | `05-hook-cleanup` | Solo (needs 04) |

## Plan Files

1. `01-agent-output-async.md` - Make agent output disk-first
2. `02-service-refresh-method.md` - Add refreshThreadState to service
3. `03-event-listeners.md` - Wire up AGENT_STATE/COMPLETED listeners
4. `04-component-migration.md` - Update components to use store
5. `05-hook-cleanup.md` - Delete useStreamingThread

## Validation

Run validation checklist after all plans complete (see original plan).
