# Control Panel Navigation - Sub-Plans

## Execution Order

```
┌─────────────────────────────────────────────────────────────┐
│                     PARALLEL GROUP 1                         │
├────────────────────────┬────────────────────────────────────┤
│                        │                                    │
│  01-rust-navigation    │  02-frontend-inbox-view            │
│  (Rust backend)        │  (TypeScript frontend)             │
│                        │                                    │
│  - Restore module      │  - Add inbox view type             │
│  - Shift→Alt changes   │  - InboxView component             │
│  - Register hotkeys    │  - control-panel-window.tsx        │
│  - Register commands   │  - use-control-panel-params.ts     │
│                        │                                    │
└────────────────────────┴────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     SEQUENTIAL STEP                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  03-integration-verification                                │
│  (Verify wiring, manual testing)                            │
│                                                             │
│  - Verify useNavigationMode hook                            │
│  - Verify event-bridge.ts                                   │
│  - Verify UnifiedInbox integration                          │
│  - Manual testing checklist                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Dependencies

| Sub-plan | Depends On | Can Parallel With |
|----------|------------|-------------------|
| 01-rust-navigation | None | 02-frontend-inbox-view |
| 02-frontend-inbox-view | None | 01-rust-navigation |
| 03-integration-verification | 01, 02 | None |

## Agent Assignment

- **Agent A**: `01-rust-navigation.md` (Rust expertise)
- **Agent B**: `02-frontend-inbox-view.md` (React/TypeScript expertise)
- **Agent C** (after A & B complete): `03-integration-verification.md`

## Success Criteria

All items from the parent plan:
- [ ] Alt+Down shows control panel with inbox view
- [ ] Alt+Up shows control panel with inbox view
- [ ] Repeated Alt+Down/Up navigates through items
- [ ] Selection highlights correctly during navigation
- [ ] Releasing Alt opens the selected thread/plan
- [ ] Escape cancels navigation
- [ ] Panel blur cancels navigation
- [ ] Navigation works with mixed threads and plans
- [ ] Navigation wraps at list boundaries
