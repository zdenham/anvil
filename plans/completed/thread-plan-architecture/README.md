# Thread + Plan Architecture Implementation

Parent plan: [thread-plan-architecture.md](../thread-plan-architecture.md)

## Sub-Plans (Parallel Execution)

These plans can be executed largely in parallel, with dependencies noted.

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [01-core-types.md](./01-core-types.md) | New type definitions | None |
| [02-storage-layer.md](./02-storage-layer.md) | File system services | 01 |
| [03-delete-tasks.md](./03-delete-tasks.md) | Remove all task code | None |
| [04-thread-refactor.md](./04-thread-refactor.md) | Update thread entity | 01, 02 |
| [05-plan-entity.md](./05-plan-entity.md) | New plan entity layer | 01, 02 |
| [06-relations.md](./06-relations.md) | Thread-plan relations | 04, 05 |
| [07-ui-inbox.md](./07-ui-inbox.md) | Inbox UI updates | 04, 05, 06 |
| [08-control-panel.md](./08-control-panel.md) | Rename simple-task → control-panel | 03 |
| [09-tauri-backend.md](./09-tauri-backend.md) | Rust backend changes | 03, 08 |

**Note:** Per decision #8, there is no migration plan (10-migration.md). This is greenfield implementation - no existing data to migrate.

## Parallel Execution Groups

**Group A (No dependencies - start immediately):**
- 01-core-types.md
- 03-delete-tasks.md

**Group B (After Group A):**
- 02-storage-layer.md (needs 01)
- 08-control-panel.md (needs 03)

**Group C (After Group B):**
- 04-thread-refactor.md (needs 01, 02)
- 05-plan-entity.md (needs 01, 02)
- 09-tauri-backend.md (needs 03, 08)

**Group D (After Group C):**
- 06-relations.md (needs 04, 05)

**Group E (After Group D):**
- 07-ui-inbox.md (needs 04, 05, 06)

**Note:** No migration plan needed (decision #8) - this is greenfield implementation.

---

## Agent Implementation Strategy

This section describes how to partition the plans for parallel agent execution, ensuring each agent can complete their task independently.

### Execution Phases (5 Phases, 10 Agents)

```
Phase 1 - No Dependencies (3 agents in parallel)
├── Agent A: 01-core-types.md
├── Agent B: 03-delete-tasks.md
└── Agent C: 08-control-panel.md (tasks 1-17 only: rename work)

Phase 2 - After Phase 1 (2 agents in parallel)
├── Agent D: 02-storage-layer.md (needs 01)
└── Agent E: 09-tauri-backend.md (needs 03, 08-rename)

Phase 3 - After Phase 2 (3 agents in parallel)
├── Agent F: 04-thread-refactor.md (needs 01, 02)
├── Agent G: 05-plan-entity.md (needs 01, 02)
└── Agent H: 08-control-panel.md (tasks 18-22: plan view, needs 05)

Phase 4 - After Phase 3 (1 agent)
└── Agent I: 06-relations.md (needs 04, 05)

Phase 5 - After Phase 4 (1 agent)
└── Agent J: 07-ui-inbox.md (needs 04, 05, 06)
```

### Plan Splitting

**08-control-panel.md is split into two parts:**
- **Part A (Phase 1, Agent C):** Tasks 1-17 - Renaming `simple-task` to `control-panel`. No dependencies, can run immediately.
- **Part B (Phase 3, Agent H):** Tasks 18-22 - Plan view implementation. Depends on 05-plan-entity for `usePlanContent`, `useRelatedThreads`, etc.

### Agent Scoping

| Agent | Plan | Scope | Completion Criteria |
|-------|------|-------|---------------------|
| A | 01-core-types | Core TypeScript types only | All schema tests pass, TS compiles |
| B | 03-delete-tasks | Delete all task code | Verification greps return empty, TS compiles |
| C | 08-control-panel (1-17) | Rename only, no plan view | No "simple-task" references remain, builds pass |
| D | 02-storage-layer | Thread storage paths | All 29 storage tests pass |
| E | 09-tauri-backend | Rust task removal only | `cargo build` succeeds, verification greps empty |
| F | 04-thread-refactor | Thread entity refactor | All thread tests pass, TS compiles |
| G | 05-plan-entity | Plan entity layer | All plan entity tests pass |
| H | 08-control-panel (18-22) | Plan view components | Plan view tests pass, can open plans in control panel |
| I | 06-relations | Relations entity | All relation tests pass |
| J | 07-ui-inbox | Inbox UI | All inbox tests pass, UI renders correctly |

### Handling Intermediate Failures

**Intermediate compilation failures are expected.** After Phase 1:
- Agent A (01-core-types) will cause TS errors in code that references old types
- Agent B (03-delete-tasks) will cause TS errors from missing task imports
- Agent C (08-control-panel rename) will cause TS errors from renamed imports

These errors are resolved as subsequent phases complete. Each agent should verify their specific tests pass, not that the entire codebase compiles.

### Agent Completion Checklist

Each agent's work is complete when:
1. All tests in the plan's "Programmatic Testing Plan" section pass
2. The plan's "Acceptance Criteria" checkboxes can be marked complete
3. The plan's "Verification" commands (if any) return expected results

### Merge Strategy

1. **Each phase completes before next begins** - All agents in a phase must finish before any agent in the next phase starts
2. **Merge order within phase doesn't matter** - Agents in the same phase touch different files
3. **Run full test suite after Phase 5** - Integration verification after all plans complete
