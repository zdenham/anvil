# Refactor Plans Review - Consolidated Gap Analysis

**Generated:** 2026-01-27
**Reviewed by:** 7 parallel Opus agents
**Scope:** All plans in `/plans/refactor/`

---

## Executive Summary

The refactor plans are comprehensive but contain **systemic pattern violations** that appear across multiple phases. The most critical issues are:

1. **Entity Store Pattern violations** - Stores directly persist to disk instead of delegating to services
2. **Missing Zod schemas** - Disk persistence lacks runtime validation
3. **Type duplication** - `ContentPaneView` defined in multiple places
4. **Cross-phase API mismatches** - Function signatures don't align between phases

---

## Critical Gaps by Pattern

### 1. Entity Stores Pattern Violations

| Phase | Issue | Impact |
|-------|-------|--------|
| 01 | Components may write directly to stores | Breaks single-writer contract |
| 02 | `tree-menu-store.ts` calls `persistState()` directly in actions | No service layer |
| 04 | `content-panes-store.ts` mutates state then persists | Inverts disk-as-truth flow |
| 07 | Same pattern repeated for multi-pane store | Inconsistent architecture |

**Pattern Requirement:** Only services write to stores. Stores expose `_apply*` methods, services call them after disk writes.

**Fix:** Create `*-service.ts` files for tree-menu and content-panes that handle disk I/O.

---

### 2. Missing Zod Schemas (Zod at Boundaries)

| Phase | File | Missing Schema |
|-------|------|----------------|
| 01 | `resizable-panel.tsx` | `LayoutStateSchema` for `~/.anvil/ui/layout.json` |
| 02 | `tree-menu-store.ts` | `TreeMenuPersistedStateSchema` for `~/.anvil/ui/tree-menu.json` |
| 04 | `content-panes-store.ts` | `ContentPanesPersistedStateSchema` |
| 04 | `layout-store.ts` | `LayoutPersistedStateSchema` |

**Pattern Requirement:** All disk reads must use Zod `.parse()` or `.safeParse()`.

**Fix:** Add schemas to each store's types file. Example:
```typescript
const TreeMenuPersistedStateSchema = z.object({
  expandedSections: z.record(z.string(), z.boolean()),
  selectedItemId: z.string().nullable(),
});
```

---

### 3. Missing listeners.ts Files

| Phase | Store | Missing Listeners |
|-------|-------|-------------------|
| 02 | tree-menu-store | `THREAD_CREATED`, `THREAD_UPDATED`, `PLAN_UPDATED` |
| 04 | content-panes-store | `THREAD_ARCHIVED`, `PLAN_ARCHIVED` |
| 07 | content-panes-store | Cross-window `PANE_VIEW_CHANGED` |

**Pattern Requirement:** Entity stores have listeners that refresh from disk on events.

**Note:** For UI-only state like tree menu, listeners may subscribe to underlying entity events rather than defining new events.

---

### 4. Type Duplication and Conflicts

| Type | Location 1 | Location 2 | Issue |
|------|------------|------------|-------|
| `ContentPaneView` | Phase 1 `types.ts` | Phase 4 store | Duplicate definition |
| `ContentPaneView` | Phase 4 store | Phase 7 store | Another duplicate |
| `ControlPanelViewType` | `src/entities/events.ts` | `ContentPaneView` | Overlapping purpose |

**Fix:** Define `ContentPaneView` once in `src/components/content-pane/types.ts` (Phase 1). All other phases import from there.

---

## Cross-Phase Wiring Issues

### API Signature Mismatches

| Phase 3 | Phase 4 | Issue |
|---------|---------|-------|
| `onItemSelect(itemType, itemId)` | `handleTreeItemSelect(itemId, itemType)` | Parameter order swapped |

| Phase 1 | Phase 4 | Issue |
|---------|---------|-------|
| `ResizablePanel` uses `persistKey`, `onClose` | `MainWindowLayout` uses `onResize` | Different persistence approach |

**Fix:** Align signatures. Recommend Phase 4 adopt Phase 1's persistence approach (store handles its own persistence).

---

### Component Sharing Unclear

**Question:** Do NSPanel and main window use the SAME `ThreadContent`/`PlanContent` components?

| Plan says... | But... |
|--------------|--------|
| Phase 1 extracts components "for both contexts" | Phase 7 doesn't clarify if NSPanel is updated to use them |
| Phase 5 deletes control-panel components | But `control-panel-window.tsx` still needed for NSPanel? |

**Fix:** Add explicit component lineage diagram showing what renders where.

---

### Dependency Order Issues

```
Phase 4 depends on: Phase 1, 2, 3
Phase 5 depends on: Phase 4, Phase 6
Phase 6 depends on: Phase 4
Phase 7 depends on: Phase 5
```

**Problem:** Phase 5 references `useContentPanesStore` which is created in Phase 4. Phase 6 tests components from Phase 4. Phase 5's deletions may break Phase 6/7 if not sequenced correctly.

**Fix:** Add explicit pre-flight checks before each phase.

---

## Missing Details by Phase

### Phase 01 - Foundation Extraction
- `cancelAgent` import location unverified
- `usePlanContent` hook not defined
- `SuggestedActionsPanel` / `QueuedMessagesBanner` extraction unclear
- Terminal view type defined but no component (YAGNI violation)

### Phase 02 - Tree Data Store
- Repo/worktree name resolution is placeholder code (`"Unknown Repo"`)
- Plan status derivation incomplete (`hasRunningThread = false // TODO`)
- Async lookup in sync hook not resolved

### Phase 03 - Tree Menu UI
- CSS location unspecified (should be Tailwind)
- `onDoubleClick` prop defined but not wired (YAGNI)
- Keyboard scroll-into-view not implemented
- `updatedAt` type mismatch (number vs Date)

### Phase 04 - Layout Assembly
- Debouncing for panel resize not implemented
- Store initialization order/error handling unclear
- Entity deletion detection mechanism unspecified
- `_hydrated` flag usage inconsistent

### Phase 05 - Deprecation Cleanup
- `InboxItem` type relocation not addressed
- `closeAndShowInbox()` replacement unclear
- Menu item references wrong (`nav_tasks` vs `nav_inbox`)
- Import redirects for `getPlanDisplayName` not specified

### Phase 06 - Regression Testing
- Disk-as-truth pattern not explicitly tested
- Writer contract (disk before event) not tested
- `ThreadStatus` terminology inconsistent (`complete` vs `completed`)
- Hydration race conditions not covered

### Phase 07 - NSPanel & Multi-Pane
- Pop-out behavior decision deferred
- Bidirectional tree/pane sync not specified
- `set-content-pane-view` event not defined
- Rust command details vague

---

## Consolidated Recommendations

### Immediate Actions (Before Implementation)

1. **Consolidate `ContentPaneView` type** in Phase 1's `types.ts`. Update Phase 4 and 7 to import.

2. **Add Zod schemas** to all persistence interfaces before any phase begins.

3. **Fix `onItemSelect` signature** - pick one order and update both Phase 3 and 4.

4. **Reconcile `ResizablePanel` API** - either Phase 1 adds `onResize` callback or Phase 4 uses `persistKey`.

5. **Clarify NSPanel component sharing** - explicitly document that NSPanel will/won't be updated to use Phase 1 components.

### Structural Changes

6. **Create service layers** for tree-menu and content-panes stores following entity pattern:
   ```
   src/stores/tree-menu/
   ├── types.ts       # includes Zod schemas
   ├── store.ts       # _apply* methods only
   ├── service.ts     # disk I/O + store writes
   └── listeners.ts   # event subscriptions
   ```

7. **Add pre-flight verification** to each phase that checks:
   - Required files from prior phases exist
   - Required exports are available
   - `pnpm typecheck` passes

8. **Define navigation fallback** - what replaces `closeAndShowInbox()` in new architecture.

### Testing Additions

9. **Add Disk-as-Truth test suite** to Phase 6:
   - Manually edit disk files while app running
   - Verify UI updates after event
   - Test writer contract (disk write completes before event visible)

10. **Add component visual comparison** to Phase 6:
    - Screenshot NSPanel thread view
    - Screenshot main window thread view
    - Diff to verify identical rendering

---

## Risk Summary

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Type mismatches cause runtime errors | High | High | Consolidate types before starting |
| Stale UI due to missing listeners | Medium | High | Follow entity store pattern strictly |
| Corrupted persistence crashes app | Medium | Medium | Add Zod validation |
| Cross-phase integration fails | Medium | High | Pre-flight checks + integration tests |
| NSPanel breaks during refactor | Low | High | Don't delete control-panel until Phase 7 complete |

---

## Review Notes Location

Individual review notes have been appended to each plan file:
- `01-foundation-extraction.md` - Review Notes section at bottom
- `02-tree-data-store.md` - Review Notes section at bottom
- `03-tree-menu-ui.md` - Review Notes section at bottom
- `04-layout-assembly.md` - Review Notes section at bottom
- `05-deprecation-cleanup.md` - Review Notes section at bottom
- `06-regression-testing.md` - Review Notes section at bottom
- `07-nspanel-multipane.md` - Review Notes section at bottom

---

*This consolidated review was generated by analyzing all 7 refactor plans against the documented patterns in `/docs/patterns/`.*
