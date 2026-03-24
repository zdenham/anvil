# Debug Panel

Slide-in bottom panel toggled via `Cmd+Shift+D`. Wraps the existing `LogsPage` and `DiagnosticPanel` as-is — no re-organizing, no extracting sections, no new tab types.

## Phases

- [x] Create debug panel store + persistence service
- [x] Build debug panel shell with tab bar
- [x] Add vertical resizable panel primitive
- [x] Wire into MainWindowLayout with keyboard shortcut

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### Interaction

- `Cmd+Shift+D` toggles open/closed
- Panel slides up from the bottom, resizable via drag handle
- Panel height persisted to `~/.anvil/ui/debug-panel.json`
- Not mounted when closed (zero cost)
- Escape closes when panel has focus
- Two tabs: **Logs** and **Diagnostics** — rendering the existing components directly

### Layout

```
┌─────────────────────────────────────────┐
│  flex-col h-full                        │
│  ┌───────────────────────────────────┐  │
│  │ flex-1 min-h-0 (existing layout)  │  │
│  │  [Left] [Center] [Right?]         │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │ debug-panel (when open)           │  │
│  │  drag handle · tab bar · content  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

---

## Phase details

### Phase 1: Store + persistence

**Create** `src/stores/debug-panel/store.ts`

```ts
interface DebugPanelState {
  isOpen: boolean;
  activeTab: "logs" | "diagnostics";
  panelHeight: number; // px
}
```

Actions: `toggle()`, `open(tab?)`, `close()`, `setActiveTab(tab)`, `setPanelHeight(h)`

**Create** `src/stores/debug-panel/service.ts`
- `hydrate()` — read from `~/.anvil/ui/debug-panel.json`, validate with Zod
- `persist()` — debounced write (same pattern as layout service)

### Phase 2: Shell component with tabs

**Create** `src/components/debug-panel/debug-panel.tsx`

- Tab bar at top: Logs | Diagnostics, plus close (X) button
- Active tab content below — conditional mount (`{activeTab === "logs" && <LogsPage />}`)
- Renders `LogsPage` and `DiagnosticPanel` directly, no wrapper components

### Phase 3: Vertical resizable panel

**Create** `src/components/ui/resizable-panel-vertical.tsx`

Same pattern as existing `ResizablePanel` but for height. Drag handle on top edge, `cursor-ns-resize`, snap-to-close behavior, persists height.

### Phase 4: Wire into MainWindowLayout

**Modify** `src/components/main-window/main-window-layout.tsx`

1. Register `Cmd+Shift+D` shortcut (same pattern as existing hotkeys)
2. Add `debugPanelService.hydrate()` to `initStores`
3. When `isOpen`: wrap existing layout in `flex-col`, render `DebugPanel` inside `ResizablePanelVertical` below the existing flex row
4. When closed: no DOM impact

---

## Files to create

| File | Purpose |
|---|---|
| `src/stores/debug-panel/store.ts` | Zustand store (state + actions) |
| `src/stores/debug-panel/service.ts` | Hydrate/persist to disk |
| `src/stores/debug-panel/index.ts` | Barrel |
| `src/components/debug-panel/debug-panel.tsx` | Shell with tab bar + content |
| `src/components/debug-panel/index.ts` | Barrel |
| `src/components/ui/resizable-panel-vertical.tsx` | Vertical resize primitive |

## Files to modify

| File | Change |
|---|---|
| `src/components/main-window/main-window-layout.tsx` | Shortcut, store hydration, render debug panel |
