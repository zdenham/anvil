# Thread-Plan Architecture: Implementation Readiness Report

Generated: 2026-01-22

## Summary Table

| Plan | Status | Confidence | Ready? |
|------|--------|------------|--------|
| 01-core-types.md | Ready | High | Yes |
| 02-storage-layer.md | Ready | High | Yes |
| 03-delete-tasks.md | Ready | High | Yes |
| 04-thread-refactor.md | Ready | High | Yes |
| 05-plan-entity.md | Ready | High | Yes |
| 06-relations.md | Ready | High | Yes |
| 07-ui-inbox.md | Ready | High | Yes |
| 08-control-panel.md | Ready | High | Yes |
| 09-tauri-backend.md | Ready | High | Yes |

**Overall: 9/9 plans ready for implementation**

---

## Gaps by Plan

### 01-core-types.md

**Status: Ready | Confidence: High**

All gaps resolved:
- ✅ No migration needed - fresh start by deleting `.anvil` directory (Q1)
- ✅ Thread folder names use just the thread ID (Q2)
- ✅ Relation precedence uses automatic resolution (Q10)

---

### 02-storage-layer.md

**Status: Ready | Confidence: High**

No significant gaps. Plan provides:
- Clear code examples following existing patterns
- Comprehensive 29-test programmatic testing plan
- Proper dependency documentation

---

### 03-delete-tasks.md

**Status: Ready | Confidence: High**

| Gap | Severity | Description |
|-----|----------|-------------|
| agent-service.ts complexity | Low | Could be more specific about all task references to remove |
| Implicit file list | Low | `src/components/tasks/` uses "All other files" instead of explicit listing |

---

### 04-thread-refactor.md

**Status: Ready | Confidence: High**

| Gap | Severity | Description |
|-----|----------|-------------|
| Worktree ID lookup | Low | `deriveWorkingDirectory` should use `wt.id === thread.worktreeId` since 01-core-types adds `id` field |
| Import file list | Low | Could explicitly list files that import renamed components |

---

### 05-plan-entity.md

**Status: Ready | Confidence: High**

No significant gaps. Plan provides:
- Complete Zod schema code
- Comprehensive test specifications
- Clear dependency documentation

---

### 06-relations.md

**Status: Ready | Confidence: High**

All gaps resolved:
- ✅ Add `findByRelativePath(repoPath, relativePath)` to planService (Q3)
- ✅ Add `markUnread(planId)` to planService in 05-plan-entity (Q4)
- ✅ 06-relations owns all hooks, 07-ui-inbox imports them (Q6)

---

### 07-ui-inbox.md

**Status: Ready | Confidence: High**

All gaps resolved:
- ✅ Use `turns` array on thread metadata to get last user message via a helper function (Q5)
- ✅ Import hooks from 06-relations, remove duplicate definitions (Q6)

---

### 08-control-panel.md

**Status: Ready | Confidence: High**

All gaps resolved:
- ✅ Define `PlanViewHeader`, `useControlPanelStore`, `usePlanContent` inline in the plan (Q7)
- ✅ Minimal error handling - just show "Plan not found" for missing plans (Q8)
- ✅ Sequential execution - complete rename tasks 1-17 before plan view tasks 18-22 (Q9)

---

### 09-tauri-backend.md

**Status: Ready | Confidence: High**

No significant gaps. Plan provides:
- Specific file paths and line number references
- All referenced items verified to exist in codebase
- Comprehensive verification commands and acceptance criteria

---

## Recommended Implementation Order

Based on dependencies and readiness:

```
Phase 1 (Can start now):
├── 01-core-types.md (after addressing gaps)
├── 03-delete-tasks.md ✓
└── 09-tauri-backend.md ✓ (after 03, 08)

Phase 2 (After Phase 1):
├── 02-storage-layer.md ✓ (after 01)
├── 04-thread-refactor.md ✓ (after 01, 02)
└── 05-plan-entity.md ✓ (after 01, 02)

Phase 3 (After Phase 2):
├── 06-relations.md (after 04, 05; needs gap fixes)
└── 08-control-panel.md (after addressing gaps)

Phase 4 (After Phase 3):
└── 07-ui-inbox.md (after 04, 05, 06; needs gap fixes)
```

---

## Action Items to Make All Plans Ready

All critical and important gaps have been resolved through the decisions above. The following minor items can be addressed during implementation:

### Minor (Can address during implementation)

1. **03-delete-tasks.md**: Explicitly list all files in `src/components/tasks/`
2. **04-thread-refactor.md**: Update `deriveWorkingDirectory` to use worktree `id`
3. **08-control-panel.md**: Fill in empty test bodies

---

## Decisions Required Before Implementation

The following questions have been answered to resolve the gaps above.

### Q1: Migration Strategy for Existing Settings (01-core-types.md)

**Question:** How should we handle existing `RepositorySettings` and `WorktreeState` entries that lack the new required `id` fields?

**Decision:** No migration needed. All users will have a fresh start by deleting their `.anvil` directory.

---

### Q2: Thread Folder Naming Without agentType (01-core-types.md)

**Question:** What should replace `agentType` in thread folder names since it's being removed?

**Decision:** Use just the thread ID as the folder name. No timestamp or convention needed - the folder name is simply `{threadId}`.

---

### Q3: Plan Detection Without absolutePath (06-relations.md)

**Question:** With `absolutePath` removed from `PlanMetadata`, how should the relation detection code find plans by file path?

**Decision:** Option B - Add a `findByRelativePath(repoPath, relativePath)` method to planService. This keeps the clean separation (no redundant absolute paths stored) while providing a clear API for lookups. The service can compute the absolute path internally when needed.

---

### Q4: planService.markUnread Method (06-relations.md)

**Question:** Should `markUnread` be added to planService, or should the relation code use a different approach?

**Decision:** Option A - Add `markUnread(planId)` to planService in 05-plan-entity. This maintains consistency with the existing `markRead` method and keeps the API symmetric.

---

### Q5: Thread Message Loading for Inbox (07-ui-inbox.md)

**Question:** How should `useThreadLastMessages` load the last message for each thread in the inbox?

**Decision:** Use the existing `turns` array on the thread metadata which includes user messages. Create a helper function to extract the last user message from the turns array.

---

### Q6: Duplicate Hooks Between 06-relations and 07-ui-inbox

**Question:** Both plans define similar hooks. Which plan should own them?

**Decision:** Option A - 06-relations owns all hooks, 07-ui-inbox imports them. The relation service is the source of truth for thread-plan relationships. Remove duplicate definitions from 07-ui-inbox.

---

### Q7: Missing Control Panel Components (08-control-panel.md)

**Question:** Where should `PlanViewHeader`, `useControlPanelStore`, and `usePlanContent` be defined?

**Decision:** Option A - Define inline in 08-control-panel.md. These are straightforward components that don't warrant a separate plan.

---

### Q8: Error Handling in Plan View (08-control-panel.md)

**Question:** What error states should the plan view handle?

**Decision:** Option A - Minimal error handling. Just show "Plan not found" for missing plans. Keep it simple.

---

### Q9: Task Parallelization in 08-control-panel.md

**Question:** Can the rename tasks (1-17) run in parallel with plan view tasks (18-22)?

**Decision:** Option B - No, sequential execution. The plan view tasks (18-22) will import renamed components from tasks 1-17. Complete the rename first, then build plan view.

---

### Q10: Relation Precedence Enforcement (01-core-types.md)

**Question:** How should the precedence rules for relations be enforced?

**Decision:** Option C - Automatic resolution. When displaying or querying relations, sort by precedence and use the highest. Higher precedence silently wins. No errors needed since having multiple relation types is valid.
