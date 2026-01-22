# Control Panel View Mode Refactor - Sub-Plans

## Parallel Execution Strategy

This refactor is decomposed into sub-plans optimized for **maximum parallel execution**.

```
                    ┌─────────────────┐
                    │  00-type-fixes  │  (foundation - run first)
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ 01-control-panel│ │  02-quick-acts  │ │   03-inbox      │
│    window       │ │                 │ │   wiring        │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ 04-integration  │  (final - run last)
                    └─────────────────┘
```

## Sub-Plans

| Sub-Plan | Parallelizable With | Files | Agent Type |
|----------|---------------------|-------|------------|
| `00-type-fixes.md` | None (must run first) | `events.ts` | Simple |
| `01-control-panel-window.md` | 02, 03 | `control-panel-window.tsx`, `use-control-panel-params.ts`, `store.ts`, `control-panel-header.tsx` | Simple |
| `02-quick-actions.md` | 01, 03 | `quick-actions-store.ts`, `suggested-actions-panel.tsx` | Simple |
| `03-inbox-wiring.md` | 01, 02 | `main-window-layout.tsx`, `hotkey-service.ts`, `panels.rs` | Simple |
| `04-integration.md` | None (must run last) | All - verification & cleanup | Simple |

## Execution Instructions

### Phase 1: Foundation (Sequential)
```bash
# Run first - establishes type foundation
mort run 00-type-fixes.md
```

### Phase 2: Parallel Implementation
```bash
# Run these three in parallel
mort run 01-control-panel-window.md &
mort run 02-quick-actions.md &
mort run 03-inbox-wiring.md &
wait
```

### Phase 3: Integration (Sequential)
```bash
# Run last - ties everything together
mort run 04-integration.md
```

## Why This Decomposition?

1. **Type Foundation First** - The discriminated union simplification in `events.ts` must be done first as all other work depends on it

2. **Three Independent Streams** - After types are settled:
   - Control panel window changes are self-contained (rendering logic)
   - Quick actions are self-contained (different store, different component)
   - Inbox wiring is self-contained (different files, different layer - Rust/TS bridge)

3. **Integration Last** - Final verification, wiring loose ends, ensuring all pieces work together

## File Ownership (No Conflicts)

Each parallel sub-plan owns distinct files:

| Sub-Plan 01 | Sub-Plan 02 | Sub-Plan 03 |
|-------------|-------------|-------------|
| `control-panel-window.tsx` | `quick-actions-store.ts` | `main-window-layout.tsx` |
| `use-control-panel-params.ts` | `suggested-actions-panel.tsx` | `hotkey-service.ts` |
| `store.ts` | | `tauri-commands.ts` |
| `control-panel-header.tsx` | | `panels.rs` (Rust) |
| `plan-view.tsx` | | `unified-inbox.tsx` |

## Success Criteria

From parent plan - all must pass after `04-integration.md`:

- [ ] Opening a plan shows plan-only view (single view, no tabs)
- [ ] Opening a thread shows thread view with conversation/changes tabs
- [ ] Quick actions are appropriate for the current view mode
- [ ] Thread tab toggle cycles between two tabs (not three)
- [ ] Header displays mode-appropriate content
- [ ] Clicking thread in inbox opens control panel with thread view
- [ ] Clicking plan in inbox opens control panel with plan view
- [ ] Client-side switching works without focus flicker
- [ ] Keyboard navigation (Shift+Up/Down) highlights items
- [ ] All existing tests pass
- [ ] No TypeScript errors
