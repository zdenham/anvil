# Pending Reviews Array - Parallelized Sub-Plans

## Execution Order

```
Phase 1 (Sequential):
  00-types.md              ← Must complete first

Phase 2 (Parallel - run all 5 simultaneously):
  ├── 01a-validation-context.md
  ├── 01b-persistence.md
  ├── 01c-cli.md
  ├── 01d-action-panel.md
  └── 01e-task-service.md

Phase 3 (Sequential - after Phase 2):
  02-human-review-validator.md  ← Depends on 01a
```

## Dependency Graph

```
                    ┌──────────────┐
                    │  00-types    │
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ 01a-validation│  │ 01b-persist   │  │ 01c-cli       │
│ -context      │  │ -ence         │  │               │
└───────┬───────┘  └───────────────┘  └───────────────┘
        │
        │          ┌───────────────┐  ┌───────────────┐
        │          │ 01d-action    │  │ 01e-task      │
        │          │ -panel        │  │ -service      │
        │          └───────────────┘  └───────────────┘
        │
        ▼
┌───────────────┐
│ 02-human      │
│ -review       │
│ -validator    │
└───────────────┘
```

## Summary

| Phase | Plan | Files Modified | Dependencies |
|-------|------|----------------|--------------|
| 1 | 00-types | `core/types/tasks.ts` | None |
| 2 | 01a-validation-context | `agents/src/validators/types.ts` | 00 |
| 2 | 01b-persistence | `agents/src/core/persistence.ts` | 00 |
| 2 | 01c-cli | `agents/src/cli/anvil.ts` | 00 |
| 2 | 01d-action-panel | `src/components/workspace/action-panel.tsx` | 00 |
| 2 | 01e-task-service | `src/entities/tasks/service.ts` | 00 |
| 3 | 02-human-review-validator | `agents/src/validators/human-review.ts` | 00, 01a |
