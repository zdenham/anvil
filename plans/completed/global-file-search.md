# Global File Content Search (Cmd+Shift+F)

VS Code-style content search across all files in the active worktree. Replaces the file browser panel on the right side. Searches git-tracked files using `git grep` on the Rust side for speed and automatic .gitignore/binary exclusion. Also searches thread conversation content via a separate Rust command that greps `~/.anvil/threads/`. File results are displayed VS Code-style: grouped by file with collapsible match lines underneath. Thread content matches appear first, followed by file results in git grep order.

## Context

- **Trigger:** Cmd+Shift+F opens the search panel (replaces file browser if open)
- **Scope:** Searches file contents via `git grep` and thread conversation content via filesystem grep of `~/.anvil/threads/`. File search is on by default. Supports include/exclude glob patterns (VS Code-style).
- **Backend:** `git grep` via a new Tauri command (fast, respects .gitignore, only tracked files)
- **Display:** Right-side panel (same slot as file browser), VS Code-style tree with file headers and collapsible match lines. Thread content matches at top, then file results in git grep order.
- **Navigation:** Click a match → opens file in content pane, scrolled to the matching line. If match is in `plans/` and plan is non-archived, opens plan view instead of raw markdown.

## Search Scope Rules

**Result display:** Thread content matches appear first (high-signal, grouped by thread). File content results follow in git grep order (alphabetical by path). File results are displayed VS Code-style: file header rows with collapsible match lines underneath. Files with >10 matches auto-collapse.

**File content search** is **on by default** and scoped to a single worktree:

- A checkbox labeled **"Include files"** controls whether `git grep` file results are included (defaults to **checked**)
- Next to the checkbox, a **dropdown** lets the user pick which repo/worktree to search (defaults to MRU worktree)
- Dropdown only shown if >1 worktree exists; otherwise shows worktree name as a label
- Changing the dropdown or checkbox immediately re-triggers the search with the current query
- When unchecked, no `git grep` is run — only thread content matches are shown

**Include/exclude patterns** (VS Code-style):

- A toggle button (filter icon) next to the search input shows/hides the pattern fields (hidden by default)
- When visible: "files to include" and "files to exclude" text input fields
- Accepts comma-separated glob patterns (e.g., `*.ts, src/**` or `node_modules, *.lock`)
- These are passed to `git grep` as pathspec patterns
- Default exclude patterns: `archive`, `*.lock`, `dist`, `build`
- Changes to patterns immediately re-trigger the search (debounced)
- Pattern state persists for the session

**Threads** are always searched by content across all worktrees:

- Thread content lives at `~/.anvil/threads/{threadId}/state.json` (JSON, up to ~9MB each)
- `~/.anvil/` is **not** a git repo, so `git grep` cannot be used — need a separate Rust command
- New Tauri command `search_threads` greps `~/.anvil/threads/*/state.json` for the query
- Searches user prompts, assistant text, and tool results within the state.json files
- Results are matched to thread metadata (name, worktreeId) from the in-memory store
- Thread results are displayed grouped by thread (thread name header → indented match lines)
- Minimum 2-character query before thread search fires (short queries would be too noisy on large JSON)
- AbortController pattern: new searches cancel stale in-flight requests (track request counter, discard stale responses)

**Plans** are not searched separately — they are regular files on disk and will appear in git grep results naturally. When a match is in `plans/**/*.md` and the plan is not archived, clicking it navigates to the plan view (via `navigateToPlan`) instead of opening raw markdown.

## Why `git grep` (not ripgrep)

- Already respects `.gitignore` and only searches tracked files — no manual exclusion logic
- Fast — operates on git's internal index, no filesystem traversal
- Handles binary file exclusion automatically
- We exclude `archive/` and other noisy dirs via pathspec negation (`:!archive`)
- Available everywhere git is — no extra dependency
- The Claude Agent SDK bundles a ripgrep binary in `vendor/`, but it lives inside the Node.js agent process — reusing it from the Tauri/Rust side would require cross-process path resolution and would break if the SDK changes its internal layout. `git grep` has zero coupling to the agent process.

## Design

### Search flow

```
[User types query / changes worktree / toggles checkbox / edits patterns / toggles case]
    → debounce 300ms, bump request counter, discard any stale responses
    ├── Always (if query.length >= 2):
    │       → invoke("search_threads", { anvilDir, query, maxResults: 100, caseSensitive })
    │               ↓
    │       Rust: grep ~/.anvil/threads/*/state.json (fixed-string, ±case-insensitive)
    │               ↓
    │       Parse matches → Vec<ThreadContentMatch>
    │               ↓
    │       TS: match threadId to metadata (name, worktreeId), render at top
    │
    └── If "Include files" checked (and query.length >= 2):
            → invoke("git_grep", {
                repoPath: selectedWorktreePath,
                query,
                maxResults: 500,
                includePatterns,
                excludePatterns,
                caseSensitive,
              })
                    ↓
            Rust: spawn `git grep` with pathspec patterns
                    ↓
            Parse output → Vec<GrepMatch>
                    ↓
            TS: group matches by filePath, detect plan paths,
                render file groups below thread results
```

Both searches run in parallel. Results render as they arrive (thread matches may appear before file matches or vice versa). Stale responses are discarded by comparing request counter.

**Panel close behavior:** Fire and forget — closing the panel unmounts the component. Stale responses are ignored naturally because the request counter state is gone. Rust-side grep processes finish on their own (fast enough that orphaned processes are harmless).

### Data shape

```typescript
// File content results from git grep
interface GrepMatch {
  filePath: string;   // relative to worktree root
  lineNumber: number;
  lineContent: string; // the matched line text (trimmed)
}

interface GrepResponse {
  matches: GrepMatch[];
  truncated: boolean;  // true if maxResults was hit
}

// Thread content results from search_threads
interface ThreadContentMatch {
  threadId: string;     // extracted from directory name
  lineContent: string;  // the matched text snippet (trimmed, max ~200 chars)
  matchIndex: number;   // match ordinal within this thread (for deduplication)
}

interface ThreadSearchResponse {
  matches: ThreadContentMatch[];
  truncated: boolean;
}

// File results grouped by path (VS Code-style tree)
interface FileResultGroup {
  filePath: string;        // relative to worktree root
  matches: GrepMatch[];    // all matches in this file
  isPlan: boolean;         // true if path matches plans/**/*.md and not in plans/completed/
  isCollapsed: boolean;    // auto-collapse if matches.length > 10
}

// Thread results grouped by thread (shown above file results)
interface ThreadResultGroup {
  threadId: string;
  name: string;            // from thread metadata store
  worktreeId: string;      // from thread metadata store
  matches: ThreadContentMatch[];
  isCollapsed: boolean;    // auto-collapse if matches.length > 10
}
```

### Right-panel slot sharing

The file browser and search panel share the same right-panel slot. Only one is visible at a time:

- Cmd+Shift+F → closes file browser, opens search panel (or focuses search input if already open)
- File browser toggle → closes search panel, opens file browser
- Escape in search panel → closes it

We lift both contexts into `MainWindowLayout` and use a discriminated union:

```typescript
type RightPanelState =
  | { type: "none" }
  | { type: "file-browser"; context: FileBrowserContext }
  | { type: "search" };
```

This replaces the current `useFileBrowserPanel` hook with a `useRightPanel` hook.

### Default excluded paths

Default exclusions pre-filled in the "files to exclude" field:
- `archive` — archived worktree data
- `*.lock` — lock files (Cargo.lock, pnpm-lock.yaml)
- `dist` — build outputs
- `build` — build outputs

Users can edit these directly in the exclude field. The field is always editable.

## Phases

- [x] Phase 1: Rust `git_grep` + `search_threads` Tauri commands + TS bindings
- [x] Phase 2: Right-panel state refactor (`useRightPanel` hook)
- [x] Phase 3: Search panel UI component (thread + file results, checkbox/dropdown, filter patterns)
- [x] Phase 4: Keybinding (Cmd+Shift+F) + integration
- [x] Phase 5: Result navigation (click → open thread, plan view, or file with line scroll)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Orchestration

A single lead agent manages the full plan. It delegates work to sub-agents via the Task tool, parallelizing where dependencies allow.

### Dependency graph

```
Phase 1 (Rust commands + TS bindings)  ──┐
                                          ├──→ Phase 3 (Search panel UI) ──→ Phase 4 (Keybinding) ──→ Phase 5 (Navigation)
Phase 2 (Right-panel refactor)  ──────────┘
```

Phases 1 and 2 have **no dependencies on each other** — they can run in parallel.
Phases 3–5 are **sequential** and depend on both Phase 1 and Phase 2 being complete.

### Execution strategy

**Step 1 — Parallel:** Launch two sub-agents simultaneously via the Task tool:

| Sub-agent | Phase | Type | Scope |
|-----------|-------|------|-------|
| `rust-commands` | Phase 1 | `general-purpose` | Rust commands in `src-tauri/`, TS bindings in `src/lib/tauri-commands.ts`, register in `lib.rs` |
| `panel-refactor` | Phase 2 | `general-purpose` | New `useRightPanel` hook, update `MainWindowLayout`, remove old `useFileBrowserPanel` |

Each sub-agent prompt must include:
- The path to this plan file (`plans/global-file-search.md`)
- Which phase section to read for detailed spec
- Explicit instruction: "After completing your phase, update `plans/global-file-search.md` to mark your phase complete with `[x]`"

**Step 2 — Sequential:** After both sub-agents complete, the lead agent handles Phases 3–5 itself (or delegates to one sub-agent sequentially). These phases share heavy context — the search panel UI (Phase 3) defines the component tree that Phase 4 wires up and Phase 5 adds navigation to. Keeping them in one agent avoids redundant file reads and context loss.

Phases 3–5 can each be a separate sub-agent if desired, but must run **sequentially** (each depends on the prior phase's output).

### Sub-agent prompts (templates)

**Phase 1 prompt:**
> Read the Phase 1 section of `plans/global-file-search.md`. Implement `git_grep` in `src-tauri/src/git_commands.rs`, `search_threads` in a new `src-tauri/src/search.rs`, register both commands in `src-tauri/src/lib.rs`, and add TS bindings in `src/lib/tauri-commands.ts`. Follow the data shapes and implementation notes exactly. After completing, mark Phase 1 complete with `[x]` in the plan file.

**Phase 2 prompt:**
> Read the Phase 2 section of `plans/global-file-search.md`. Create `src/hooks/use-right-panel.ts` with the `RightPanelState` union type. Refactor `MainWindowLayout` to replace `useFileBrowserPanel` with the new hook. Ensure file browser still works as before. After completing, mark Phase 2 complete with `[x]` in the plan file.

**Phases 3–5 prompt:**
> Read Phases 3, 4, and 5 of `plans/global-file-search.md`. Implement them sequentially: build the search panel components (Phase 3), wire up Cmd+Shift+F keybinding (Phase 4), then add result navigation (Phase 5). Mark each phase complete with `[x]` in the plan file immediately after finishing it.

### Build verification

After all phases complete, the lead agent should run `pnpm build` (or the Tauri build command) to verify the full build compiles. Fix any type errors or integration issues before marking the plan done.

---

## Phase 1: Rust `git_grep` + `search_threads` Tauri commands + TS bindings

### 1A: `git_grep` — file content search (`src-tauri/src/git_commands.rs`)

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    pub file_path: String,
    pub line_number: u32,
    pub line_content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResponse {
    pub matches: Vec<GrepMatch>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn git_grep(
    repo_path: String,
    query: String,
    max_results: Option<u32>,
    include_patterns: Option<Vec<String>>,  // e.g. ["*.ts", "src/**"]
    exclude_patterns: Option<Vec<String>>,  // e.g. ["node_modules", "*.lock"]
    case_sensitive: Option<bool>,           // default: false (case-insensitive)
) -> Result<GrepResponse, String>
```

Implementation:
- Run `git grep -n --no-color -I -F [-i] <query> -- <pathspecs>`
  - `-n` for line numbers
  - `--no-color` for clean parsing
  - `-I` to skip binary files
  - `-F` for fixed-string matching (literal, not regex) — safer default for user input
  - `-i` for case-insensitive (added when `case_sensitive` is false/None — the default)
- Build pathspec arguments from include/exclude patterns:
  - If `include_patterns` provided: add each as a positional pathspec (e.g., `*.ts`, `src/**`)
  - If `include_patterns` empty/None: use `.` (all files)
  - Always append `exclude_patterns` as negated pathspecs (e.g., `:!archive`, `:!*.lock`)
  - Default excludes (always applied): `archive`, `*.lock`, `dist`, `build`
- Parse each output line: `<file>:<line>:<content>`
- Cap at `max_results` (default 500), set `truncated = true` if exceeded
- Handle empty results (exit code 1 from git grep = no matches, not an error)
- Register in `lib.rs` invoke handler list

### 1B: `search_threads` — thread content search (`src-tauri/src/search.rs`, new file)

Thread content lives at `~/.anvil/threads/{threadId}/state.json`. These are large JSON files (up to ~9MB) containing conversation messages, tool results, etc. `~/.anvil/` is **not** a git repository, so `git grep` cannot be used.

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadContentMatch {
    pub thread_id: String,
    pub line_content: String,  // matched text snippet, trimmed to ~200 chars
    pub match_index: u32,      // ordinal within this thread
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSearchResponse {
    pub matches: Vec<ThreadContentMatch>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn search_threads(
    anvil_dir: String,        // ~/.anvil path, passed explicitly from TS
    query: String,
    max_results: Option<u32>,
    case_sensitive: Option<bool>,  // default: false (case-insensitive)
) -> Result<ThreadSearchResponse, String>
```

Implementation:
- Shell out to `grep -r -F [-i] -l --include="state.json" <query> <anvil_dir>/threads/`
  - `-r` recursive
  - `-F` fixed-string (literal match)
  - `-i` case-insensitive (added when `case_sensitive` is false/None — the default)
  - `-l` list matching files only (first pass — identify which threads match)
  - `--include="state.json"` only search state files, skip metadata.json
- Then for each matching file, re-run `grep -F [-i] -n <query>` to get line matches with context
- Search scope: `<anvil_dir>/threads/` only — do NOT search `<anvil_dir>/archive/`
- Searches entire state.json content (user prompts, assistant text, tool inputs/results, etc.)
- Extract `threadId` from the directory path (`threads/{threadId}/state.json`)
- **Snippet extraction:** strip JSON syntax from matched lines (remove leading `"key": "` prefixes, trailing `"` and commas), then trim to ~200 chars centered on the match, add `...` ellipsis at boundaries
- Cap at `max_results` (default 100), set `truncated = true` if exceeded
- Register in `lib.rs` invoke handler list

**Performance considerations:**
- ~53 threads, ~22MB total — grep scanning is fast (sub-second on SSD)
- state.json is pretty-printed JSON, so line-by-line grep works for extracting context
- Consider: caching thread content index if performance becomes an issue at scale

### TS bindings (`src/lib/tauri-commands.ts`)

Add to `gitCommands` (or a new `searchCommands` namespace):

```typescript
grep: (repoPath: string, query: string, opts?: {
  maxResults?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  caseSensitive?: boolean;
}) =>
  invoke<GrepResponse>("git_grep", {
    repoPath,
    query,
    maxResults: opts?.maxResults,
    includePatterns: opts?.includePatterns,
    excludePatterns: opts?.excludePatterns,
    caseSensitive: opts?.caseSensitive,
  }),

searchThreads: (anvilDir: string, query: string, opts?: {
  maxResults?: number;
  caseSensitive?: boolean;
}) =>
  invoke<ThreadSearchResponse>("search_threads", {
    anvilDir,
    query,
    maxResults: opts?.maxResults,
    caseSensitive: opts?.caseSensitive,
  }),
```

### Tests

- Unit test the Rust output parsing for both commands if extracted to helpers
- Integration-level: both Tauri commands can be tested via the agent harness or manually

---

## Phase 2: Right-panel state refactor

### Replace `useFileBrowserPanel` with `useRightPanel`

New hook: `src/hooks/use-right-panel.ts`

```typescript
type RightPanelState =
  | { type: "none" }
  | { type: "file-browser"; rootPath: string; repoId: string; worktreeId: string }
  | { type: "search" };

interface UseRightPanelReturn {
  state: RightPanelState;
  openFileBrowser: (repoId: string, worktreeId: string, worktreePath: string) => void;
  openSearch: () => void;
  close: () => void;
  /** For tree menu highlight */
  fileBrowserWorktreeId: string | null;
}
```

- `openFileBrowser` toggles if already showing file browser for same worktree, otherwise switches
- `openSearch` toggles the search panel (no worktree context needed — the panel manages its own file scope internally via the checkbox + dropdown, defaulting to MRU worktree)
- `close` sets state to `{ type: "none" }`

### Update `MainWindowLayout`

- Replace `useFileBrowserPanel()` with `useRightPanel()`
- Right panel render logic: switch on `state.type` to render `FileBrowserPanel` or `SearchPanel`
- Pass `openFileBrowser` to TreeMenu's `onOpenFiles`
- Pass `openSearch` to the Cmd+Shift+F handler
- Both panels share the same `ResizablePanel` wrapper with `persistKey="right-panel-width"`

---

## Phase 3: Search panel UI component

### New component: `src/components/search-panel/search-panel.tsx`

Structure:
```
┌──────────────────────────────┐
│ ✕  Search                    │  ← header with close button
├──────────────────────────────┤
│ [🔍 Search...    ] [Aa][⋯]  │  ← input + case toggle + filter toggle
│ ☑ Include files  [repo/wt ▾] │  ← checkbox + worktree dropdown
│ (if filters visible:)        │
│   include: [*.ts, src/**   ] │
│   exclude: [archive, *.lock] │
├──────────────────────────────┤
│ 3 threads, 42 results in 8   │  ← summary bar + [collapse all] [expand all]
│ files                    ⊟ ⊞ │
├──────────────────────────────┤
│ ▼ 💬 "Fix login bug"     (3) │  ← thread content match (shown first)
│     "...validate auth tok..."│    ← indented match snippet
│     "...token refresh log..."│
│ ▼ 💬 "Auth token refresh"(1) │
│ ▼ 📄 src/lib/auth.ts    (2) │  ← file header: icon, path, match count
│     12: const auth = bar     │    ← indented match line, query highlighted
│     45: auth.validate()      │
│ ▼ 📋 plans/fix-auth.md  (1) │  ← plan file: plan icon, navigates to plan view
│     3: validate auth tokens  │
│ ▶ 📄 src/types.ts      (15) │  ← auto-collapsed (>10 matches)
│              (500+ results)  │  ← truncation warning if applicable
└──────────────────────────────┘
```

**Empty state:** When no query is entered, show placeholder text: "Type to search files and threads" centered in the results area.

**Case sensitivity toggle** (VS Code-style `Aa` button):
- Small icon button next to the search input (like VS Code)
- Defaults to **off** (case-insensitive search)
- When on: passes case-sensitive flag to both `git_grep` (removes `-i`) and `search_threads`
- Toggling re-triggers the search immediately
- Keyboard shortcut: Cmd+Option+C (matches VS Code)

**Note:** Whole Word and Regex toggles are non-goals for v1 — only case sensitivity is implemented.

**Result layout (VS Code-style tree):**
- **Thread content matches** appear at the top, grouped by thread:
  - **Thread header row:** collapse toggle (▼/▶) + `folder-messages.svg` icon + thread name + match count badge
  - **Match rows (indented):** matched text snippet (~200 chars, query highlighted)
  - Threads with >10 matches auto-collapse
- **File results** follow in git grep order, grouped by file path:
  - **File header row:** collapse toggle (▼/▶) + file icon + relative path + match count badge
  - **Match rows (indented):** line number + matched line content with query highlighted
  - Files with >10 matches auto-collapse (user can expand manually)
- **Plan file detection:** if `filePath` matches `plans/**/*.md` and is not in `plans/completed/`, use `todo.svg` icon and navigate to plan view on click
- **Results summary bar** between controls and results: "X threads, Y results in Z files" with Collapse All / Expand All icon buttons on the right

**"Include files" checkbox** and **worktree dropdown**:
- Checkbox defaults to **checked** (file search runs immediately)
- Dropdown lists all repos/worktrees, defaults to MRU worktree
- Dropdown only visible if >1 worktree exists; otherwise shows worktree name as a static label
- Dropdown disabled when checkbox is unchecked
- Changing either immediately re-triggers the search

**Filter toggle button** (VS Code-style `⋯` or filter icon):
- Sits next to the search input, toggles visibility of include/exclude fields
- Hidden by default — keeps the UI minimal for simple searches
- When visible:
  - "files to include" — comma-separated globs (e.g., `*.ts, src/**`)
  - "files to exclude" — comma-separated globs, pre-filled with defaults: `archive, *.lock, dist, build`
  - Patterns are parsed and passed to `git_grep` as pathspec arguments
  - Changes to patterns re-trigger the search (debounced)

Props:
```typescript
interface SearchPanelProps {
  onClose: () => void;
  onNavigateToFile: (filePath: string, lineNumber: number, worktreePath: string, isPlan: boolean) => void;
  onNavigateToThread: (threadId: string, searchQuery: string) => void;
}
```

Behavior:
- Auto-focus input on mount
- Minimum 2-character query before any search fires
- **Always (query >= 2 chars):** invoke `search_threads(...)`, group results by thread, show at top
- **If "Include files" checked (query >= 2 chars):** invoke `gitCommands.grep(...)` in parallel, group results by file
- Both searches run in parallel; results render as they arrive
- Stale responses discarded via request counter (bump on each new search, ignore responses from old counters)
- Highlight the query substring in each match's context line (simple `<mark>` or themed highlight)
- Show "Searching..." spinner while either search is in flight
- Show "No results" when nothing matches
- Show truncation warning if `response.truncated`
- Escape key: if input is empty, close panel; if input has text, clear it first
- Keyboard: arrow keys to navigate results (skip collapsed match lines), Enter to open

### Supporting files

- `src/components/search-panel/index.ts` — re-export
- `src/components/search-panel/file-result-group.tsx` — file header row + collapsible match lines
- `src/components/search-panel/thread-result-group.tsx` — thread header row + collapsible match snippets
- `src/components/search-panel/match-line.tsx` — single match line with highlighted query text

---

## Phase 4: Keybinding + integration

### Register Cmd+Shift+F in `MainWindowLayout`

New `useEffect` handler:

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
      e.preventDefault();
      openSearch();
    }
  };
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [openSearch]);
```

No worktree resolution needed at open time — the search panel manages its own file scope internally via the checkbox + dropdown.

### Render in layout

```tsx
{rightPanel.state.type === "search" && (
  <ResizablePanel position="right" ...>
    <SearchPanel
      onClose={rightPanel.close}
      onNavigateToFile={handleFileNavigate}
      onNavigateToThread={handleThreadNavigate}
    />
  </ResizablePanel>
)}
```

---

## Phase 5: Result navigation

### Click → navigate to result

**Thread results:** Navigate to thread + auto-open find bar with search query pre-populated.

The thread view already has a find-in-page system (`useThreadSearch` in `src/components/thread/use-thread-search.ts`) that supports:
- `setQuery(query)` — programmatically set search query, triggers data-layer search + CSS Highlight API highlighting
- `scrollToIndex(turnIndex)` via message list ref — scrolls to specific message
- `scrollToCurrentMatch()` — fine-tune scroll to exact match position in DOM

**Implementation approach:**
- Extend `navigationService.navigateToThread` to accept an optional `searchQuery` parameter
- Add `searchQuery` to the thread content pane view type
- When `ThreadContent` mounts with a `searchQuery`, auto-open the find bar and call `threadSearch.setQuery(searchQuery)`
- The existing find bar logic handles highlighting, match counting, and scrolling to the first match

```typescript
// Extended navigation
await navigationService.navigateToThread(threadId, { searchQuery: query });

// In ThreadContent, on mount:
useEffect(() => {
  if (view.searchQuery) {
    threadSearch.setQuery(view.searchQuery);
    setFindBarOpen(true);
  }
}, [view.searchQuery]);
```

**File results (including plan files):**
```typescript
const handleFileNavigate = useCallback(
  async (filePath: string, lineNumber: number, worktreePath: string, isPlan: boolean) => {
    if (isPlan) {
      const planId = lookupPlanIdByPath(filePath);
      if (planId) {
        await navigationService.navigateToPlan(planId);
        return;
      }
    }
    const absolutePath = `${worktreePath}/${filePath}`;
    await navigationService.navigateToFile(absolutePath, { lineNumber });
  },
  []
);
```

**Plan detection logic:**
- If `filePath` starts with `plans/` and ends with `.md`
- And is NOT in `plans/completed/` (the specific completed plans directory)
- Look up the plan ID from the plan store by matching the relative path
- If found, navigate to plan view; if not found (e.g., unregistered plan file), fall back to raw file view

**Line-number scrolling for files:**
- `navigationService.navigateToFile` does not currently support `lineNumber`
- Extend the file content pane view type to include optional `lineNumber`
- The file viewer component scrolls to the given line on mount (or highlights it)
- If line scrolling proves complex, v1 can just open the file without scrolling

---

## Non-goals (explicitly out of scope)

- Regex toggle (start with fixed-string only; add regex `.*` toggle later if needed)
- Whole word toggle (VS Code's `Ab` button — add later if needed)
- Cross-worktree file search (file search targets one worktree at a time via dropdown)
- Search-and-replace
- Thread content indexing (search is brute-force grep over state.json files; indexing could come later if perf degrades)
- Separate plan search (plans are files on disk — git grep finds them naturally)
- Searching archived threads (only `~/.anvil/threads/` is searched, not `~/.anvil/archive/`)
