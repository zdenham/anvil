# Lost Changes Inventory & Recovery

## Problem Statement

A large batch of work was committed in v0.0.59 (`6ae9366`) — 55 files, 3866 lines added. The commit included **new component files** and **plan files moved to** `plans/completed/`, but **did not include integration edits to existing files**. The result: building blocks exist in the codebase but aren't wired into their parent components, and plans are marked "completed" despite missing integration steps.

### Most Likely Root Cause

The v0.0.59 commit was assembled by staging new/untracked files (which show up clearly in `git status`) while **modifications to existing tracked files were not staged**. The unstaged modifications were then lost — most likely by a `git checkout --force` operation.

Two Tauri commands use `--force`:

- `git_checkout_branch` (`src-tauri/src/git_commands.rs:310`): `git checkout --force <branch>`
- `git_checkout_commit` (`src-tauri/src/git_commands.rs:330`): `git checkout --force --detach <commit>`

Both are callable from agent processes via WebSocket dispatch (`ws_server/dispatch_git.rs:49-59`). If an agent called either with the **main repo path** as `worktreePath` (instead of an actual worktree path), it would:

1. Silently discard all uncommitted modifications to tracked files (the integration edits)
2. Leave untracked files untouched (the new component files)

This exactly matches the pattern: new files survived, edits to existing files did not.

### Evidence

- `file-content.tsx` **never** contained CM6, Tiptap, or file-drop imports in any commit
- `main-window-layout.tsx` still has `StatusLegend` in the sidebar (line 779) despite `BottomGutter` component existing
- `thread-input-section.tsx` has no `useFileDrop` or `AttachmentPreviewStrip` imports despite both components existing
- Plans moved to `completed/` have all phases checked `[x]` but integration phases clearly never took effect
- No branch (local or remote) contains the missing integration work
- Git reflog shows no evidence of the work existing in any commit

## Phases

- [x] Audit all v0.0.59 completed plans for missing integrations

- [x] Catalog every missing integration with specific file + change needed

- [ ] Create individual recovery plans for each missing integration

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Plans Completed in Last 48 Hours

### `e1f4061` — "going to fix the virtualizer" (\~Mar 7 afternoon)

| Plan | Summary | Integration |
| --- | --- | --- |
| `fix-streaming-cursor-inline.md` | Fix streaming cursor rendering as block element instead of inline | OK |
| `fix-terminal-resize-artifacts.md` | Fix terminal flicker during resize (WebGL addon root cause) | OK |
| `fix-terminal-tui-rendering.md` | Fix garbled UTF-8 chars, cursor misalignment, resize flicker in terminals | OK |
| `fix-thread-item-indicator.md` | Fix thread item left sidebar indicator (StatusDot vs chevron logic) | OK |
| `new-tab-inherits-terminal-type.md` | New "+" tab inherits terminal type from active tab in same panel group | OK |

### `4681798` — v0.0.57 (\~Mar 7 evening)

| Plan | Summary | Integration |
| --- | --- | --- |
| `fix-scroll-up-jitter-v2.md` | Replace absolute-positioned virtualizer with flow-based layout to fix scroll jitter | OK |
| `scroll-to-bottom-on-load.md` | Fix thread not scrolling to bottom on open (estimated vs actual heights) | OK |

### `6ae9366` — v0.0.59 (\~Mar 8 midnight) — **bulk commit, lost integrations**

| Plan | Summary | Integration |
| --- | --- | --- |
| `archive-pagination.md` | Paginate archive loading (3,387 threads were loading all at once) | OK — self-contained |
| `cm6-file-editor.md` | Replace read-only Shiki file view with editable CodeMirror 6 editor | **RECOVERED** in v0.0.60 |
| `tiptap-markdown-editor.md` | Replace read-only markdown renderer with editable Tiptap WYSIWYG editor | **RECOVERED** in v0.0.60 |
| `file-attachments.md` | Drag-and-drop file attachments into thread input with image previews | **MISSING** — not wired into thread-input-section.tsx |
| `fix-file-drop.md` | Fix macOS Tauri v2 not forwarding file drag events to webview | OK — self-contained hook rewrite |
| `quick-actions-gutter.md` | VS Code-style bottom gutter for quick actions + auto-build infrastructure | **MISSING** — BottomGutter not in main-window-layout.tsx |
| `reliable-cancellation.md` | Fix cancellation: visual feedback, preserve streamed content, handle disconnected socket | **MISSING** — see audit below |
| `fix-child-thread-messages.md` | Fix child threads bypassing parent dispatch/reducer pipeline | **PARTIAL** — see audit below |
| `fix-archive-view-invisible-threads.md` | Fix archive showing count but rendering zero rows (early return bug) | **MISSING** — early return bug still present |
| `fix-plan-expansion.md` | Fix plans with sub-plans requiring 3 clicks to expand instead of 2 | **MISSING** — `?? true` default still in service.ts |
| `fix-quick-actions-context-filtering.md` | Quick actions showing in gutter regardless of content pane context | OK — `getForContext()` wired in |
| `tiptap-parity-with-markdown-renderer.md` | Match Tiptap visual output to MarkdownRenderer (Shiki, inline code, chrome) | **PARTIAL** — toggle removal lost, Shiki + CSS OK |
| `trim-default-quick-actions.md` | Remove 3 of 4 default quick actions, add "Mark Unread" to context menus | OK — actions deleted, context menus added |

### Uncommitted (working tree)

| Plan | Summary | Integration |
| --- | --- | --- |
| `fix-file-creation-triggers.md` | Wire up "New File/Folder" context menu items and Cmd+Shift+N shortcut | In progress |

---

## Audit Results (detailed)

### [reliable-cancellation.md](http://reliable-cancellation.md) — **MISSING**

All 5 phases unchecked `[ ]` in the plan. Only a new component file survived; all integration edits lost.

| Phase | Status | Evidence |
| --- | --- | --- |
| 1\. CancelledBanner | **PARTIAL** | `cancelled-banner.tsx` exists (new file survived), but NOT imported or rendered in `thread-view.tsx` |
| 2\. Preserve streaming content | **MISSING** | `applyCancelled()` in `thread-reducer.ts:360` still returns `{ ...state, toolStates, status: "cancelled" }` — does NOT clear `wipMap` |
| 3\. kill_process_tree | **MISSING** | No `kill_process_tree` command in `src-tauri/` |
| 4\. Staged cancel protocol | **MISSING** | No `waitForAgentExit`, `forceKillAgent`, or timeout logic in `agent-service.ts` |
| 5\. Optimistic feedback | **MISSING** | No `isCancelling` state in content-pane components |

**Recovery needed**: Wire `CancelledBanner` into `thread-view.tsx`, clear wipMap in `applyCancelled`, add process tree kill, add staged cancellation, add optimistic UI.

### [fix-child-thread-messages.md](http://fix-child-thread-messages.md) — **PARTIAL**

Most phases implemented, but Phase 2 (append user messages) is missing.

| Phase | Status | Evidence |
| --- | --- | --- |
| 1\. IDs + wipMap/blockIdMap | **OK** | `nanoid()`/`anthropicId` at `message-handler.ts:624-625`; `wipMap: {}`/`blockIdMap: {}` at `shared.ts:811-812` |
| 2\. Append user messages | **MISSING** | `case "user"` in `handleForChildThread` (line 645) updates `toolStates` + sends `MARK_TOOL_COMPLETE`, but does NOT push to `state.messages` or send `APPEND_USER_MESSAGE` |
| 3\. Streaming support | **OK** | `getParentToolUseId` handles `stream_event` (line 517); per-child `StreamAccumulator` via `childAccumulators` map (lines 51, 682-685); `stream_event` case at line 677 |
| 4\. Terminal state actions | **OK** | `COMPLETE` action + `AGENT_COMPLETED` event at `shared.ts:1180-1194`; `ERROR` + `AGENT_COMPLETED` at lines 1249-1262 |
| 5\. INIT on creation | **OK** | INIT sent at `shared.ts:823` |
| 6\. Tests | Unknown | Did not audit test files |

**Recovery needed**: In `handleForChildThread` `case "user"` (\~line 645), append the user message to `state.messages` with `id: nanoid()` and send `APPEND_USER_MESSAGE` via `hub.sendActionForThread`. Without this, child thread conversation structure is `[user, assistant, assistant, ...]` instead of `[user, assistant, user, assistant, ...]`.

### [fix-archive-view-invisible-threads.md](http://fix-archive-view-invisible-threads.md) — **MISSING**

Plan phase shows `[x]` but the fix was never applied.

| What | Status | Evidence |
| --- | --- | --- |
| Early return removed | **MISSING** | `archive-view.tsx` lines 120-133 still have early returns for `loading` and `threads.length === 0` BEFORE the `<div ref={scrollRef}>` at line 141 |

**Recovery needed**: Restructure `ArchiveView` so `<div ref={scrollRef}>` is always rendered, with loading/empty states rendered inside it. The plan has exact before/after code.

### [fix-plan-expansion.md](http://fix-plan-expansion.md) — **MISSING**

Plan phases show `[x]` but the fix was never applied.

| What | Status | Evidence |
| --- | --- | --- |
| `getDefaultExpanded` helper | **MISSING** | Function not found in `service.ts` |
| `toggleSection` default | **MISSING** | Line 57 still uses `?? true` |
| `expandSection` default | **MISSING** | Line 84 still uses raw `if (current === true) return` |
| `collapseSection` default | **MISSING** | Line 109 still uses raw `if (current === false) return` |

**Recovery needed**: Add `getDefaultExpanded(sectionId)` helper that returns `false` for `plan:`/`thread:`/`changes:` prefixes. Update all three methods. The plan has exact before/after code.

### [fix-quick-actions-context-filtering.md](http://fix-quick-actions-context-filtering.md) — **OK**

| What | Status | Evidence |
| --- | --- | --- |
| Panel filtering | **OK** | `quick-actions-panel.tsx:43` uses `s.getForContext(contextType)` |
| Hotkey guard | **OK** | `use-quick-action-hotkeys.ts` checks `isMainView()` (thread/plan/empty). Per-action context filtering not present, but moot since only `next-unread` (all 3 contexts) remains as default |

### [tiptap-parity-with-markdown-renderer.md](http://tiptap-parity-with-markdown-renderer.md) — **PARTIAL**

New files and CSS survived; toggle removal from existing file lost.

| Phase | Status | Evidence |
| --- | --- | --- |
| 1\. Remove toggle | **MISSING** | `file-content.tsx` still has `ViewModeToggle`, `viewMode` state, and source/rendered branching for markdown files (lines 44, 110-111, 122-125) |
| 2\. Shiki code blocks | **OK** | `tiptap-code-block.tsx` exists; `tiptap-editor.tsx` imports `ShikiCodeBlock` and configures `codeBlock: false` |
| 3\. Inline code styling | **OK** | `src/index.css:425` has `text-amber-400 bg-zinc-800/50 px-1 py-0.5 rounded` |

**Recovery needed**: Remove `viewMode` state and `ViewModeToggle` from the markdown path in `file-content.tsx`. TipTap should be the sole rendering mode for `.md`/`.mdx` files.

### [trim-default-quick-actions.md](http://trim-default-quick-actions.md) — **OK**

| What | Status | Evidence |
| --- | --- | --- |
| Actions deleted | **OK** | Only `next-unread.ts` in `core/sdk/template/src/actions/`; `mark-unread`, `close-panel`, `archive` gone |
| next-unread contexts | **OK** | `contexts: ['thread', 'plan', 'empty']` as specified |
| Thread context menu | **OK** | `thread-item.tsx:294` has "Mark Unread" with `markThreadAsUnread` call |
| Plan context menu | **OK** | `plan-item.tsx:361` has "Mark Unread" with `planService.markAsUnread` call |

---

## Summary: Items Needing Recovery

| \# | Plan | Missing Integration | File(s) to fix |
| --- | --- | --- | --- |
| 1 | reliable-cancellation | Wire CancelledBanner, clear wipMap, kill_process_tree, staged cancel, optimistic UI | thread-view.tsx, thread-reducer.ts, process_commands.rs, agent-service.ts, content-pane components |
| 2 | fix-child-thread-messages | Append user messages to child state + APPEND_USER_MESSAGE action | message-handler.ts (\~line 645) |
| 3 | fix-archive-view-invisible-threads | Always render scroll container | archive-view.tsx |
| 4 | fix-plan-expansion | Context-aware expansion defaults | tree-menu/service.ts |
| 5 | tiptap-parity | Remove ViewModeToggle for markdown | file-content.tsx |
| 6 | file-attachments | Wire into thread-input-section.tsx | thread-input-section.tsx |
| 7 | quick-actions-gutter | Wire BottomGutter into main-window-layout.tsx | main-window-layout.tsx |
