# Multi-Window Per-Project Architecture

## Summary

Replace the current single-window, all-repos-in-sidebar model with a multi-window architecture where each window is scoped to exactly one project (repository). On launch, Anvil restores all previously-open project windows, similar to VS Code's workspace restore behavior. A lightweight "project picker" window allows opening recent projects or adding new ones.

## Phases

- [ ] Phase 1: Window context & project-scoped stores
- [ ] Phase 2: Rust-side multi-window lifecycle
- [ ] Phase 3: Project picker window
- [ ] Phase 4: Event routing scoped to project windows
- [ ] Phase 5: Session persistence & restore-on-launch
- [ ] Phase 6: Sidecar & agent event scoping
- [ ] Phase 7: Clean up single-window remnants

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Current Architecture (Key Facts)

- **Single main window** defined in `tauri.conf.json` with label `"main"`
- Sidebar (`tree-menu/`) shows **all repos** with worktrees nested underneath
- Stores are global Zustand singletons — `useThreadStore`, `useRepoStore`, `usePlanStore` etc. load ALL entities across all repos
- Events broadcast globally via `EventBroadcaster` in sidecar → all WebSocket clients → all windows' `eventBus`
- Echo prevention uses `_source` window label, but there's no concept of routing events to specific windows by project
- `hydrateEntities()` loads everything; `setupEntityListeners()` listens to everything
- Control panel windows already demonstrate a working multi-window pattern: separate HTML entry, `instanceId` in URL params, `isMainWindow` flag to skip duplicate gateway/listener setup
- UI state persisted globally in `~/.anvil/ui/` (tree-menu.json, content-panes.json, pane-layout.json)

## Design

### Core Concept: Window = Project Context

Each project window carries a `projectContext` identifying the repo it is bound to:

```typescript
interface ProjectWindowContext {
  repoId: string;        // UUID from repository settings
  windowLabel: string;   // Tauri window label, e.g. "project-{repoId}"
}
```

This context is passed via URL params when creating the window (same pattern as control panel windows), and stored in a window-level React context + Zustand store.

### Window Types After Migration

| Window | Label Pattern | Purpose |
|--------|--------------|---------|
| Project window | `project-{repoId}` | Main workspace for one repo. Has sidebar, panes, terminals |
| Project picker | `project-picker` | Lightweight list of recent projects. Opens/creates project windows |
| Control panel | `control-panel-window-{id}` | Unchanged — standalone thread/plan viewer |
| Spotlight | `spotlight` | Unchanged — global search |
| NSPanels | various | Unchanged |

### What Gets Scoped vs. What Stays Global

**Scoped to project window:**
- Tree menu (sidebar) — shows only this repo's worktrees, threads, plans, terminals
- Content panes and pane layout — tabs only for this repo's entities
- Thread/plan entity listeners — only process events for threads matching this repo
- Terminal sessions — only this repo's worktrees
- Gateway channel — owned by one window per repo (already has `isMainWindow` concept)

**Stays global (shared across windows):**
- Sidecar process — single Node.js server, all windows connect to the same WebSocket
- Settings store — user-level settings
- Spotlight — searches across all projects (can scope results by project)
- Agent process manager — agents are per-thread, not per-window

---

## Phase Details

### Phase 1: Window Context & Project-Scoped Stores

**Goal**: Introduce a `ProjectContext` that each project window carries, and make stores filter by `repoId`.

**Changes:**

1. **New: `src/lib/project-context.ts`**
   - `ProjectContext` type: `{ repoId: string; windowLabel: string }`
   - `getProjectContext()`: reads from URL params (set at window creation time)
   - `ProjectContextProvider` React context so components can `useProjectContext()`

2. **Modify: `src/hooks/use-tree-data.ts`**
   - Accept `repoId` filter param
   - `buildUnifiedTree()` only includes worktrees/threads/plans belonging to `repoId`
   - Remove multi-repo grouping logic (no repo-level nodes needed when window = single repo)

3. **Modify: Entity hydration (`src/entities/index.ts`)**
   - `hydrateEntities()` accepts optional `repoId` to scope what gets loaded
   - When `repoId` is set, only load threads/plans/terminals for that repo's worktrees
   - Lookup store still hydrates fully (it's lightweight and needed for cross-references)

4. **Modify: UI state persistence**
   - Tree menu state: `~/.anvil/ui/tree-menu-{repoId}.json` (per-project)
   - Pane layout state: `~/.anvil/ui/pane-layout-{repoId}.json` (per-project)
   - Content panes state: `~/.anvil/ui/content-panes-{repoId}.json` (per-project)

**Key decisions:**
- Stores remain global singletons (Zustand) but expose filtered selectors that accept `repoId`
- We do NOT create separate store instances per window — that would be a massive refactor for minimal benefit. Instead, selectors like `useThreadStore.getState().getThreadsForRepo(repoId)` provide the scoping.
- The tree-menu store is the exception: its persisted state (expanded nodes, selection) is inherently per-window, so we split its persistence file by `repoId`.

### Phase 2: Rust-Side Multi-Window Lifecycle

**Goal**: Support creating, showing, and managing multiple project windows from Rust.

**Changes:**

1. **Modify: `src-tauri/src/lib.rs`**
   - New command: `create_project_window(repo_id: String, repo_name: String)` — creates a `WebviewWindow` with label `project-{repoId}`, loading `index.html?repoId={repoId}&repoName={repoName}`
   - New command: `close_project_window(repo_id: String)` — closes the window
   - New command: `list_project_windows()` — returns list of open project window labels
   - New command: `focus_project_window(repo_id: String)` — brings window to front
   - Modify `show_main_window()` → becomes `show_project_picker()` (or keep main as picker)
   - Window close behavior: closing last project window shows the project picker; closing the project picker hides to tray (current main window behavior)

2. **Modify: `src-tauri/tauri.conf.json`**
   - Change the initial window from `"main"` to `"project-picker"` (smaller, simpler)
   - Project windows created dynamically, not in config

3. **New: Project window registry**
   - `OPEN_PROJECT_WINDOWS: Mutex<HashMap<String, String>>` — maps repoId → window label
   - Used for focus-or-create logic: if window for repo already exists, focus it instead of creating a new one

4. **Modify: `index.html` (and `src/main.tsx`)**
   - Detect whether this is a project window (has `repoId` param) or the project picker
   - If project window: mount `App` with project context
   - If project picker: mount `ProjectPicker` component

**Key decisions:**
- Reuse `index.html` for both project picker and project windows (detect via URL params) to avoid adding another Vite entry point. Alternatively, create a separate `project-picker.html` entry — evaluate complexity tradeoff.
- Each project window gets its own WebSocket connection to the sidecar (the sidecar already handles multiple clients via its subscriber pattern in `push.ts`).

### Phase 3: Project Picker Window

**Goal**: Build the "landing" window that shows recent projects and lets you open/add them.

**Changes:**

1. **New: `src/components/project-picker/`**
   - `ProjectPickerLayout` — minimal window with:
     - List of known repositories (from `~/.anvil/repositories/`)
     - Each row: repo name, source path, last accessed timestamp, "Open" button
     - "Add Project" button → opens folder picker → creates repo via existing `repoService.create()`
     - "Remove" option (removes from Anvil, doesn't delete files)
   - Sorted by last accessed (most recent first)
   - Double-click or Enter opens the project window

2. **Modify: `src/App.tsx`**
   - Branch on whether `repoId` is in URL params
   - If yes: current behavior (bootstrap + MainWindowLayout) scoped to that repo
   - If no: render `ProjectPickerLayout` (lightweight, minimal hydration)

3. **New: `~/.anvil/ui/recent-projects.json`**
   - Tracks: `{ repoId, lastOpenedAt }[]`
   - Updated when a project window opens
   - Used to sort the project picker list and for session restore

**Key decisions:**
- The project picker is intentionally simple — a flat list, not a tree. No sidebar, no panes. Just open/add/remove projects.
- The picker window stays small (e.g., 500x400) while project windows open at 900x600.
- Closing all project windows shows the picker. Opening a project from the picker creates/focuses its window.

### Phase 4: Event Routing Scoped to Project Windows

**Goal**: Stop broadcasting every event to every window. Route events to the window that cares.

**Changes:**

1. **Modify: `src/lib/event-bridge.ts`**
   - `setupIncomingBridge()` accepts `repoId` filter
   - For BROADCAST_EVENTS that carry `threadId` or `planId`: look up the entity's `repoId` and skip if it doesn't match this window's `repoId`
   - For repo-level events (REPOSITORY_UPDATED, etc.): filter by `repoId` in payload
   - Events without repo context (SETTINGS_UPDATED, API_DEGRADED): pass through to all windows (these are truly global)

2. **Modify: Entity listeners**
   - `setupEntityListeners()` accepts `repoId`
   - Thread listeners: only process THREAD_STATUS_CHANGED etc. when `threadId` belongs to this window's repo
   - Plan listeners: same filtering by repo
   - Worktree listeners: only process events for worktrees in this repo

3. **Lightweight lookup for filtering:**
   - Maintain a `Set<threadId>` and `Set<planId>` for the current repo in the project context
   - Update these sets when threads/plans are created or discovered
   - This avoids hitting the full store on every event just to check repo membership

**Key decisions:**
- Filtering happens at the **incoming bridge** level, not in the sidecar. The sidecar continues to broadcast to all WebSocket clients. This keeps the sidecar simple and avoids introducing window-awareness into the Node layer.
- The reason: the sidecar doesn't know about windows. It knows about WebSocket connections. We could add connection-level filtering in the sidecar, but that couples the sidecar to UI concerns. Better to filter on the frontend where we already have the project context.
- Exception: If performance becomes an issue (hundreds of threads, many windows), we can add optional `repoId` subscription at the WebSocket level. But start simple.

### Phase 5: Session Persistence & Restore-on-Launch

**Goal**: Remember which project windows were open and restore them on app restart (VS Code-style).

**Changes:**

1. **New: `~/.anvil/ui/window-session.json`**
   ```json
   {
     "openWindows": [
       { "repoId": "uuid-1", "bounds": { "x": 100, "y": 200, "width": 900, "height": 600 } },
       { "repoId": "uuid-2", "bounds": { "x": 1050, "y": 200, "width": 900, "height": 600 } }
     ],
     "showPickerOnLaunch": false
   }
   ```

2. **Modify: App startup (`src-tauri/src/lib.rs` `run()` function)**
   - Read `window-session.json`
   - If `openWindows` is non-empty: create a project window for each entry, restore position/size
   - If `openWindows` is empty or file doesn't exist: show project picker
   - If `showPickerOnLaunch` is true: also show project picker alongside restored windows

3. **Persist on changes:**
   - When a project window opens: add entry to session file
   - When a project window closes: remove entry from session file
   - When a project window moves/resizes: debounce-update its bounds
   - On app quit: save final state

4. **Edge cases:**
   - If a saved repo no longer exists in `~/.anvil/repositories/`: skip it, log a warning
   - If restore fails for one window: continue restoring others, show error toast

**Key decisions:**
- Session file written from Rust (it runs the window lifecycle). Frontend can read it but Rust owns writes.
- Window bounds are physical pixel positions. Handle multi-monitor changes gracefully: if saved position is off-screen, reset to center of primary monitor.

### Phase 6: Sidecar & Agent Event Scoping

**Goal**: Ensure agents and sidecar communication work correctly with multiple project windows.

**Changes:**

1. **Modify: `src/lib/agent-service.ts` — `initAgentMessageListener()`**
   - Accept `repoId` context
   - When processing `agent:message` events, check if the thread belongs to this window's repo
   - Skip processing for threads not in scope (another window will handle them)

2. **Modify: WebSocket connection in `src/lib/invoke.ts`**
   - Each project window establishes its own WebSocket to the sidecar (already supported — sidecar's `EventBroadcaster` handles multiple subscribers)
   - Optionally send a `subscribe` message on connect: `{ type: "subscribe", repoId: "..." }` for future server-side filtering

3. **Gateway channels (already mostly correct):**
   - `ensureGatewayChannelForRepo()` already creates per-repo SSE channels
   - The `isMainWindow` flag needs to evolve: instead of one main window, each project window is the "main" for its repo
   - Modify: each project window calls `ensureGatewayChannelForRepo()` for its own repo only (not all repos)
   - The project picker window sets `isMainWindow: false` and skips gateway setup entirely

4. **Heartbeat store:**
   - Already keyed by `threadId` — works correctly across windows
   - Each window only renders heartbeat UI for its own threads

**Key decisions:**
- The sidecar remains window-unaware. It broadcasts to all subscribers. Filtering stays client-side.
- Each project window manages gateway for its own repo. This naturally distributes the `isMainWindow` responsibility.

### Phase 7: Clean Up Single-Window Remnants

**Goal**: Remove code that assumes a single main window or all-repos-in-one-sidebar.

**Changes:**

1. Remove repo-level nodes from tree menu (sidebar shows worktrees directly since there's only one repo)
2. Remove `hiddenRepoIds` from tree menu persisted state (no need to hide repos when each window is one repo)
3. Remove `pinnedWorktreeId` concept if it was only used as a workaround for the all-repos problem
4. Update `show_main_window()` / `hide_main_window()` naming to reflect new model
5. Update tray menu: list open project windows, option to open project picker
6. Update dock behavior: clicking dock icon when no windows are visible shows project picker
7. Migrate existing users: on first launch after update, read current repos and create a session file from them

---

## Migration Strategy

For existing users who upgrade:

1. On first launch, detect that `window-session.json` doesn't exist
2. Read all repos from `~/.anvil/repositories/`
3. If exactly one repo: open its project window directly (seamless experience)
4. If multiple repos: show project picker with all repos listed
5. Migrate `~/.anvil/ui/tree-menu.json` → split into per-repo files based on which worktrees belong to which repo

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Performance: hydrating stores per-window duplicates memory | Stores are shared singletons; only selectors are scoped. Minimal overhead. |
| Event storms from many windows | Client-side filtering drops irrelevant events early. Sidecar doesn't change. |
| Control panel windows break | They already use `isMainWindow: false` and URL params. Minimal change needed. |
| Spotlight search across projects | Spotlight continues to hydrate all repos. It's a global tool, not project-scoped. |
| Two windows open same repo | Registry prevents duplicate windows for the same `repoId`. Focus existing instead. |
| Data races on shared files | Zustand stores are in-process. Disk writes already use the service layer with proper sequencing. |

## Files Most Affected

**New files:**
- `src/lib/project-context.ts`
- `src/components/project-picker/project-picker-layout.tsx`

**Heavy modifications:**
- `src-tauri/src/lib.rs` — window creation/lifecycle
- `src/App.tsx` — branch on window type
- `src/entities/index.ts` — scoped hydration
- `src/lib/event-bridge.ts` — filtered incoming events
- `src/lib/agent-service.ts` — scoped message listener
- `src/hooks/use-tree-data.ts` — single-repo tree
- `src/stores/tree-menu/service.ts` — per-repo persistence
- `src/stores/pane-layout/service.ts` — per-repo persistence

**Light modifications:**
- `src-tauri/tauri.conf.json` — initial window config
- `src/main.tsx` — URL param detection
- `src/stores/content-panes/service.ts` — per-repo persistence
- `src/entities/threads/listeners.ts` — repo filtering
- `src/entities/plans/listeners.ts` — repo filtering
