# Quick Actions Gutter

Coordinated plan for the bottom status bar (VS Code-style gutter) and the quick actions auto-build infrastructure that feeds it.

## Context

Quick actions are user-defined scripts in `~/.anvil/quick-actions/`. They need two improvements:

1. **Auto-build** — Currently users must manually `pnpm build` + click "Reload Actions". We want the app to build on startup and the settings button to trigger a real build.
2. **Bottom gutter** — Quick actions are currently disabled in the UI (commented out in `ThreadInputSection`). We want them in a thin VS Code-style status bar at the bottom of the main window, alongside the status legend.

## Dependencies

```
auto-build-quick-actions.md (infrastructure)
        ↓
bottom-gutter.md (UI — displays the actions)
```

- **Auto-build** is independent — it adds build infrastructure and can be done first or in parallel with the gutter UI
- **Bottom gutter** consumes quick actions from the store. It doesn't depend on auto-build to function (the store already hydrates from `dist/manifest.json`), but auto-build makes the experience complete
- Both plans touch `QuickActionsPanel` — auto-build changes how actions get loaded, bottom-gutter simplifies the panel's rendering and styling

## Phases

- [ ] Auto-build quick actions infrastructure (see `auto-build-quick-actions.md`)
- [ ] Bottom gutter UI with simplified quick actions panel (see `bottom-gutter.md`)
- [ ] Integration verification — ensure auto-build feeds the gutter correctly

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Shared Touchpoints

These files are modified by both child plans — coordinate carefully:

| File | Auto-Build | Bottom Gutter |
|------|-----------|---------------|
| `QuickActionsPanel` | Indirectly (reload triggers re-render) | Strips arrow nav, restyled muted |
| `MainWindowLayout` | — | Adds `<BottomGutter />`, re-enables hotkeys |
| `quick-actions-settings.tsx` | "Rebuild" button wired to `buildQuickActions()` | — |
| `thread-input-section.tsx` | — | Removes old QuickActionsPanel import |

## Execution Order

1. **Auto-build** can be implemented first — it's self-contained service/startup work
2. **Bottom gutter** follows — it simplifies the QuickActionsPanel and moves it to the new location
3. **Integration check** — verify that a fresh start auto-builds, hydrates the store, and the gutter shows the actions
