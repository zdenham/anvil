# Agents Logger Refactoring - Parallel Execution Overview

## Execution Graph

```
┌─────────────────────────────────────────────────────────┐
│                    PARALLEL GROUP A                      │
│                    (No dependencies)                     │
│                                                         │
│  ┌─────────────────────┐    ┌─────────────────────────┐ │
│  │   Subplan 1         │    │   Subplan 2             │ │
│  │   Logger            │    │   Agent-Service         │ │
│  │   Infrastructure    │    │   Protocol Handler      │ │
│  │   (agents package)  │    │   (frontend)            │ │
│  └──────────┬──────────┘    └─────────────────────────┘ │
│             │                                           │
└─────────────┼───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│                    PARALLEL GROUP B                      │
│              (Depends on Subplan 1)                      │
│                                                         │
│  ┌─────────────────────┐    ┌─────────────────────────┐ │
│  │   Subplan 3         │    │   Subplan 4             │ │
│  │   Console Migration │    │   Console Migration     │ │
│  │   (agents package)  │    │   (core package)        │ │
│  └─────────────────────┘    └─────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Subplan Summary

| # | Name | Group | Dependencies | Files |
|---|------|-------|--------------|-------|
| 1 | Logger Infrastructure | A | None | `agents/src/lib/logger.ts`, `events.ts`, `output.ts`, `index.ts` |
| 2 | Agent-Service Protocol | A | None | `src/lib/agent-service.ts` |
| 3 | Console Migration (agents) | B | Subplan 1 | `agents/src/**/*.ts` |
| 4 | Console Migration (core) | B | Subplan 1 | `core/**/*.ts` |

## Execution Strategy

### Phase 1: Infrastructure (Parallel Group A)
Start both subplans simultaneously:
- **Subplan 1**: Create logger + events infrastructure in agents package
- **Subplan 2**: Update agent-service.ts protocol handlers

These have no dependencies and can be developed in parallel.

### Phase 2: Migration (Parallel Group B)
After Subplan 1 completes, start both migration tasks:
- **Subplan 3**: Migrate agents package console calls
- **Subplan 4**: Migrate core package console calls

These can run in parallel since they touch different packages.

## Verification

After all subplans complete:
1. `pnpm typecheck` - all packages pass
2. `pnpm build` - builds successfully
3. Manual test: run an agent task and verify:
   - Logs appear with correct levels
   - Events reach the frontend eventBus
   - State updates display correctly
   - No false ERROR logs for normal messages

## Files Index

- `01-logger-infrastructure.md` - Subplan 1 details
- `02-agent-service-protocol.md` - Subplan 2 details
- `03-console-migration-agents.md` - Subplan 3 details
- `04-console-migration-core.md` - Subplan 4 details
