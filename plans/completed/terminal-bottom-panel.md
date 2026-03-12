# Terminal Bottom Panel (VS Code-style)

## Problem

Terminals currently live as regular tabs inside the split layout system alongside threads, plans, files, etc. This leads to confusing behavior — terminals can end up replacing content tabs, content can replace terminal tabs, and there's no clear spatial separation between "work content" and "terminal sessions."

The user expects VS Code-like behavior: a dedicated bottom panel exclusively for terminals, with its own tab bar, resizable divider, and the ability to maximize the terminal to full screen.

## Current Architecture

- `SplitLayoutContainer` renders a recursive `SplitNode` tree where each leaf is a `PaneGroup` (tab bar + content pane)
- Terminals are just another `ContentPaneView` type (`{ type: "terminal", terminalId }`) rendered inside `ContentPane`
- `openInBottomPane()` creates/reuses a vertical split to put terminals at the bottom, but they're still regular pane group tabs
- Category-aware tab placement (`lastActiveGroupByCategory`) tries to keep terminals and content separate, but it's a heuristic, not a hard boundary
- `DebugPanel` already demonstrates the pattern of a dedicated bottom panel with `ResizablePanelVertical`
- The existing `PaneGroup` composes `TabBar` + `ContentPane` — both already handle terminal views

## Design

### Core Principle: Reuse, Don't Rebuild

Instead of creating a parallel store and component system, the terminal panel is a **dedicated pane group** — a regular group in the pane layout store (`groups`), rendered outside the split tree with its own resize handle. This reuses:

- **Tab management**: All existing store actions (`_applyOpenTab`, `_applyCloseTab`, `_applySetActiveTab`, `_applyReorderTabs`) work on the terminal group like any other group
- **Content rendering**: `ContentPane` already renders `TerminalContent` for `view.type === "terminal"`
- **Tab bar**: The existing `TabBar` component (or a thin variant) renders the terminal tabs
- **Persistence**: Extends the existing `pane-layout.json` state rather than a separate file

### Two-Zone Layout

```
┌─────────────────────────────────┐
│  SplitLayoutContainer           │  ← Content zone (threads, plans, files, etc.)
│  (existing split tree system)   │
│                                 │
├─ ─ ─ ─ drag handle ─ ─ ─ ─ ─ ─ ┤
│  Terminal PaneGroup             │  ← Dedicated terminal group (reuses PaneGroup)
│  [tab1] [tab2] [+]             │
│  $ _                            │
└─────────────────────────────────┘
```

- **Content zone** (top): The existing `SplitLayoutContainer` — unchanged. No terminals here.
- **Terminal zone** (bottom): A dedicated `PaneGroup` from the pane layout store, rendered outside the split tree with a `ResizablePanelVertical`-style resize handle.

### State Changes: Extend `PaneLayoutPersistedState`

**No new store.** Add terminal panel metadata to the existing pane layout persisted state:

```typescript
// In types.ts — extend PaneLayoutPersistedStateSchema
export const PaneLayoutPersistedStateSchema = z.object({
  root: SplitNodeSchema,
  groups: z.record(z.string(), PaneGroupSchema),
  activeGroupId: z.string(),
  // NEW: terminal panel metadata
  terminalPanel: z.object({
    groupId: z.string(),        // references a group in `groups`
    height: z.number(),         // pixel height (persisted)
    isOpen: z.boolean(),        // whether panel is visible
    isMaximized: z.boolean(),   // content zone collapsed
  }).optional(),                // optional for backward compat
});
```

The terminal panel's group lives in `groups` alongside all other groups but is **not referenced in** `root` (it's outside the split tree). The existing `_applyOpenTab`, `_applyCloseTab`, etc. all work on it because it's a regular group.

**New store actions** (added to existing `usePaneLayoutStore`):

- `_applySetTerminalPanelOpen(isOpen: boolean)` — show/hide panel
- `_applySetTerminalPanelHeight(height: number)` — resize
- `_applySetTerminalPanelMaximized(isMaximized: boolean)` — maximize/restore
- `_applySetTerminalPanelGroupId(groupId: string)` — set the dedicated group reference

**New service methods** (added to existing `paneLayoutService`):

- `openTerminal(terminalId: string)` — Opens terminal in the dedicated group. Creates the group if needed, adds tab (reusing `_applyOpenTab`), sets panel open.
- `closeTerminalTab(tabId: string)` — Closes tab in terminal group. If last tab, hides panel.
- `toggleTerminalPanel()` — Toggle open/closed. If no terminals, creates one.
- `maximizeTerminalPanel()` / `restoreTerminalPanel()` — Maximize/restore.
- `getTerminalPanelGroup()` — Helper to get the dedicated group.

These service methods are thin wrappers around the existing tab management actions, just targeting the terminal panel's `groupId`.

### New Component: `TerminalPanelLayout`

```
src/components/terminal-panel/
  terminal-panel-layout.tsx  — Wraps content zone + terminal zone with resize handle
```

One component. `TerminalPanelLayout` replaces the raw `<SplitLayoutContainer />` in `MainWindowLayout`:

```tsx
<TerminalPanelLayout>
  <SplitLayoutContainer />  {/* content zone */}
</TerminalPanelLayout>
```

It renders:

1. Content zone (children) — flex-grows to fill available space, `display: none` when maximized
2. Resize handle — reuses the drag pattern from `ResizablePanelVertical`
3. Terminal `PaneGroup` — renders the dedicated group using the existing `PaneGroup` component (or `TabBar` + `ContentPane` directly), fixed pixel height from store, hidden when panel is closed

The `PaneGroup` component already composes `TabBar` + `ContentPane` and handles active tab rendering. We can either:

- Reuse `PaneGroup` directly (simplest — disable DnD overlay via a prop or context)
- Compose `TabBar` + `ContentPane` inline (slightly more control over the "+" button behavior)

The "+" button in `TabBar` already creates terminals when the active tab is a terminal (see `tab-bar.tsx:37-55`). Since the terminal panel group only has terminal tabs, this works out of the box.

### Navigation Changes

`src/stores/navigation-service.ts`:

- `navigateToTerminal()` → calls `paneLayoutService.openTerminal()` instead of `openOrFind()`
- Remove `bottomPane` option from `NavigateOptions`

`src/components/main-window/main-window-layout.tsx`:

- `handleNewTerminal` → calls `paneLayoutService.openTerminal()`
- `handleItemSelect` for terminals → calls `paneLayoutService.openTerminal()`
- Cmd+T handler → creates terminal, opens via `paneLayoutService.openTerminal()`
- Replace `<SplitLayoutContainer />` with `<TerminalPanelLayout><SplitLayoutContainer /></TerminalPanelLayout>`

`src/stores/pane-layout/service.ts`:

- Remove `openInBottomPane()` method
- Remove terminal-related logic from `findOrOpenTab()` category handling

### Content Pane Cleanup

- `ContentPane` (`content-pane.tsx`): Keep the `view.type === "terminal"` rendering branch — it's still used by the terminal panel's `PaneGroup`
- Terminal tabs in the existing split tree: Add a one-time migration in `paneLayoutService.hydrate()` that strips terminal tabs from non-dedicated groups

### Maximize/Restore Behavior

When maximized:

- Content zone gets `display: none`
- Terminal panel fills available height
- Store sets `isMaximized: true`

Auto-restore triggers:

- Any navigation to a content view (`navigateToThread`, `navigateToPlan`, etc.) checks `isMaximized` and calls `restoreTerminalPanel()` first

Manual restore:

- Double-click the resize handle
- Drag the handle back down
- A small restore icon in the terminal tab bar area

### Key Behaviors

1. **Resizable divider**: Drag to resize. Persisted pixel height. Reuses `ResizablePanelVertical` drag pattern.
2. **Maximize terminal**: Drag divider all the way up (or double-click) → content collapses. Restore button or double-click to restore.
3. **Auto-restore content**: When maximized and user opens non-terminal content, content zone restores automatically.
4. **Close/hide panel**: Drag divider below threshold → panel hides. Ctrl+\` or terminal click reopens.
5. **Toggle shortcut (Ctrl+\`)**: Toggles panel open/closed. If no terminals exist, creates one.
6. **Terminal-only tabs**: The dedicated group only gets terminal views. The "+" button always creates terminals (already the TabBar behavior when active tab is terminal).
7. **Tab operations**: Close, reorder, activate — all use existing pane layout store actions on the terminal group.

## Summary of Changes

| Area | Change |
| --- | --- |
| `stores/pane-layout/types.ts` | Add `terminalPanel` to persisted state schema |
| `stores/pane-layout/store.ts` | Add 4 terminal panel actions, guard `_applySetActiveGroup` to track terminal group |
| `stores/pane-layout/service.ts` | Add `openTerminal`, `closeTerminalTab`, `toggleTerminalPanel`, `maximize/restore`. Remove `openInBottomPane`. Migration in `hydrate()` |
| `stores/navigation-service.ts` | Route `navigateToTerminal` → `openTerminal`. Remove `bottomPane` option |
| `components/terminal-panel/terminal-panel-layout.tsx` | **New file**: resize wrapper, renders children + `PaneGroup` for terminal group |
| `components/main-window/main-window-layout.tsx` | Wrap `SplitLayoutContainer` with `TerminalPanelLayout`. Update terminal handlers. Add Ctrl+\` |
| `components/content-pane/types.ts` | No change — terminal view type stays |
| `components/split-layout/tab-bar.tsx` | No change — "+" already creates terminals when active tab is terminal |

## Phases

- [x] Extend pane layout types and store: add `terminalPanel` to persisted state, add terminal panel actions to store

- [x] Extend pane layout service: add `openTerminal`, `closeTerminalTab`, `toggleTerminalPanel`, `maximize/restore`. Add migration to strip terminal tabs from split tree groups on hydrate

- [x] Build `TerminalPanelLayout` component with resize handle and maximize/restore logic, rendering the dedicated `PaneGroup`

- [x] Rewire navigation: `navigateToTerminal` → `openTerminal`, remove `openInBottomPane` and `bottomPane` option

- [x] Wire Ctrl+\`, Cmd+T, sidebar terminal click, and new-worktree auto-terminal to terminal panel

- [x] Add auto-restore behavior when navigating to content while terminal is maximized

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Edge Cases

- **No terminals open**: Terminal panel is hidden. Ctrl+\`, Cmd+T, or sidebar click opens it.
- **All terminals closed**: Panel auto-hides when last tab is closed.
- **Terminal session dies**: Keep the tab (shows "\[Process exited\]"), user can close it manually or revive it.
- **Existing layouts with terminal tabs in split tree**: Migration on hydrate strips them. Terminals reappear in the terminal panel when user opens them.
- **Window resize**: Terminal panel height is pixel-based and clamped to min/max (like `ResizablePanelVertical`).
- **Multiple worktrees**: "+" button in terminal panel uses the same worktree resolution logic as current Cmd+T.
- **Backward compatibility**: `terminalPanel` is optional in the schema — old persisted state loads fine, terminal panel starts hidden until first terminal is opened.