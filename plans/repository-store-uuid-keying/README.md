# Repository Store: UUID Migration - Execution Plan

## Subplan Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 0: FOUNDATION                           │
│                    (Sequential - Blocking)                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  00-core-types-and-store.md                               │  │
│  │  - core/types/repositories.ts                             │  │
│  │  - src/entities/repositories/store.ts                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 1: PARALLEL STREAMS                     │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │ 01a-service-    │ │ 01b-hooks-and-  │ │ 01c-listeners-  │   │
│  │ layer.md        │ │ utils.md        │ │ and-events.md   │   │
│  │                 │ │                 │ │                 │   │
│  │ service.ts      │ │ plans/utils.ts  │ │ listeners.ts    │   │
│  │                 │ │ use-repo-names  │ │ event payloads  │   │
│  │                 │ │ use-working-dir │ │                 │   │
│  │                 │ │ detection.ts    │ │                 │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 2: UI COMPONENTS                        │
│                    (Can parallelize internally)                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  02-ui-components.md                                      │  │
│  │  - repository-settings.tsx (Stream D)                     │  │
│  │  - spotlight.tsx, OnboardingFlow.tsx (Stream E)           │  │
│  │  - worktrees-page.tsx (Stream F)                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 3: CLEANUP                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  03-cleanup-and-tests.md                                  │  │
│  │  - Remove workarounds                                     │  │
│  │  - Update test helpers                                    │  │
│  │  - Add verification tests                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Execution Order

| Phase | Subplans | Parallelizable | Developers |
|-------|----------|----------------|------------|
| 1 | `00-core-types-and-store` | No | 1 |
| 2 | `01a`, `01b`, `01c` | **Yes** | Up to 3 |
| 3 | `02-ui-components` | Internally yes | Up to 3 |
| 4 | `03-cleanup-and-tests` | No | 1 |

## Quick Reference

| Subplan | Files | Risk | Notes |
|---------|-------|------|-------|
| 00 | 2 | Medium | Breaks compilation until consumers update |
| 01a | 1 | Low | Straightforward method signature changes |
| 01b | 4 | Low | Mostly deletions and simplifications |
| 01c | 1-2 | **High** | Event system changes may break IPC |
| 02 | 4-5 | Low | Mechanical updates |
| 03 | 2-3 | Low | Testing and cleanup |

## Key Decisions Made

1. **Disk format unchanged**: Folders stay as `~/.mort/repositories/{slug}/`
2. **In-memory only**: UUID keying is purely for the runtime store
3. **No data migration**: `settings.json` already contains UUID
4. **Backwards compat**: `getRepositoryByName()` helper provided

## Risk Mitigation

- **Subplan 01c** should be tested thoroughly before merging
- Consider feature flag for gradual rollout
- Disk format unchanged = easy rollback

## Total Estimated Files

~14 files across all subplans (matching original plan estimate)
