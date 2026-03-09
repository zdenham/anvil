# Recover Stash 1b7f837

Extract the dropped stash to a temporary directory for manual inspection and selective recovery.

## Phases

- [x] Extract stash contents to temp directory

- [x] Generate diff reports for triage

- [x] User reviews and selectively applies changes

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Context

Git object `1b7f837` is a dropped stash that captured the combined dirty state of all concurrent agents at the time of the v0.0.59 incident. It still exists (not yet GC'd). The stash contains 43 files. Some of those changes are already in HEAD or the current working tree.

### Recovery strategy: prefer stash over working tree

The current uncommitted working tree changes are **re-implementations** of the lost work, driven by `plans/lost-changes-inventory.md`. These re-implementations have **not been tested as thoroughly** as the original stashed changes, which were the product of full agent runs with iterative debugging.

**Default: stash wins.** For Category C overlap files, replace the working tree version with the stash version unless there is a clear reason not to (e.g., the working tree version fixes something the stash version didn't, or the stash version depends on code that has since changed). The burden of proof is on keeping the working tree version, not the stash version.

## Phase 1: Extract stash contents to temp directory

Create `/tmp/mort-stash-recovery/` with two subdirectories:

### `files/` — full file versions from the stash

```bash
git stash show 1b7f837 --name-only | while read f; do
  mkdir -p "/tmp/mort-stash-recovery/files/$(dirname "$f")"
  git show "1b7f837:$f" > "/tmp/mort-stash-recovery/files/$f" 2>/dev/null || echo "DELETED: $f"
done
```

### `diffs/` — per-file diffs (stash vs HEAD)

For each file, generate a diff showing what the stash version has that HEAD doesn't:

```bash
git stash show 1b7f837 --name-only | while read f; do
  mkdir -p "/tmp/mort-stash-recovery/diffs/$(dirname "$f")"
  git diff HEAD 1b7f837 -- "$f" > "/tmp/mort-stash-recovery/diffs/${f}.diff" 2>/dev/null
done
```

## Phase 2: Generate diff reports for triage

Create `/tmp/mort-stash-recovery/TRIAGE.md` summarizing each file's status to guide selective recovery.

### Category A: Already matching (4 files — no action needed)

| File | Note |
| --- | --- |
| `agents/src/runner.ts` | Stash = working tree |
| `src-tauri/Cargo.lock` | Stash = HEAD |
| `src/components/content-pane/plan-content.tsx` | Stash = HEAD |
| `src/index.css` | Stash = HEAD |

### Category B: Stash-only changes (15 files — no working tree conflict)

These files have stash changes NOT present in HEAD or the working tree.

| File | Diff lines |
| --- | --- |
| `package.json` | 73 |
| `plans/file-attachments.md` | 189 |
| `plans/free-form-sidebar-tree.md` | 361 |
| `plans/reliable-cancellation.md` | 224 |
| `pnpm-lock.yaml` | 1443 |
| `src-tauri/src/ws_server/dispatch_agent.rs` | 126 |
| `src-tauri/src/ws_server/mod.rs` | 29 |
| `src/components/content-pane/media-preview.tsx` | 58 |
| `src/components/file-browser/file-browser-panel.tsx` | 152 |
| `src/components/file-browser/file-tree-node.tsx` | 343 |
| `src/components/reusable/thread-input.tsx` | 37 |
| `src/components/split-layout/tab-item.tsx` | 49 |
| `src/components/thread/user-message.tsx` | 85 |
| `src/hooks/use-quick-action-hotkeys.ts` | 41 |
| `src/lib/browser-stubs.ts` | 26 |

### Category C: Overlap (19 files — stash differs from working tree)

Both the stash and the current working tree have changes to these files, with different content.

| File | Diff lines (stash vs HEAD) |
| --- | --- |
| `agents/src/hooks/__tests__/repl-hook.test.ts` | 69 |
| `agents/src/hooks/repl-hook.ts` | 18 |
| `plans/repl-tool-block-renderer.md` | 19 |
| `src-tauri/src/lib.rs` | 40 |
| `src-tauri/src/process_commands.rs` | 90 |
| `src/components/content-pane/archive-view.tsx` | 104 |
| `src/components/content-pane/content-pane-header.tsx` | 56 |
| `src/components/content-pane/file-content.tsx` | 274 |
| `src/components/file-browser/file-browser-panel.ui.test.tsx` | 218 |
| `src/components/main-window/main-window-layout.tsx` | 51 |
| `src/components/quick-actions/quick-actions-panel.tsx` | 262 |
| `src/components/reusable/thread-input-section.tsx` | 59 |
| `src/components/settings/quick-actions-settings.tsx` | 50 |
| `src/components/thread/thread-view.tsx` | 21 |
| `src/components/thread/tool-blocks/bash-tool-block.tsx` | 34 |
| `src/entities/index.ts` | 25 |
| `src/entities/threads/listeners.ts` | 27 |
| `src/lib/agent-service.ts` | 126 |
| `src/stores/tree-menu/service.ts` | 50 |

### Category D: Deleted plans (5 files — skip)

The stash deletes these files — intentional cleanup, not recovering.

- `plans/auto-build-quick-actions.md`
- `plans/bottom-gutter.md`
- `plans/cm6-file-editor.md`
- `plans/fix-child-thread-messages.md`
- `plans/tiptap-markdown-editor.md`

## Phase 3: Apply stash versions, discard re-implementations

Since stash versions are preferred over the untested re-implementations in the working tree:

### Step 1: Apply Category B (stash-only, no conflict)

These files have no working tree counterpart — apply directly from the extracted files:

```bash
# Copy stash versions over HEAD for stash-only files
for f in \
  src-tauri/src/ws_server/dispatch_agent.rs \
  src-tauri/src/ws_server/mod.rs \
  src/components/content-pane/media-preview.tsx \
  src/components/file-browser/file-browser-panel.tsx \
  src/components/file-browser/file-tree-node.tsx \
  src/components/reusable/thread-input.tsx \
  src/components/split-layout/tab-item.tsx \
  src/components/thread/user-message.tsx \
  src/hooks/use-quick-action-hotkeys.ts \
  src/lib/browser-stubs.ts; do
  cp "/tmp/mort-stash-recovery/files/$f" "$f"
done
```

`package.json`, `pnpm-lock.yaml`, and stash plan files (`plans/file-attachments.md`, `plans/free-form-sidebar-tree.md`, `plans/reliable-cancellation.md`) should be reviewed separately.

### Step 2: Apply Category C (overlap — stash replaces working tree)

For each overlap file, replace the current working tree version with the stash version. The working tree re-implementations are untested and the stash versions are the originals:

```bash
for f in \
  agents/src/hooks/__tests__/repl-hook.test.ts \
  agents/src/hooks/repl-hook.ts \
  plans/repl-tool-block-renderer.md \
  src-tauri/src/lib.rs \
  src-tauri/src/process_commands.rs \
  src/components/content-pane/archive-view.tsx \
  src/components/content-pane/content-pane-header.tsx \
  src/components/content-pane/file-content.tsx \
  src/components/file-browser/file-browser-panel.ui.test.tsx \
  src/components/main-window/main-window-layout.tsx \
  src/components/quick-actions/quick-actions-panel.tsx \
  src/components/reusable/thread-input-section.tsx \
  src/components/settings/quick-actions-settings.tsx \
  src/components/thread/thread-view.tsx \
  src/components/thread/tool-blocks/bash-tool-block.tsx \
  src/entities/index.ts \
  src/entities/threads/listeners.ts \
  src/lib/agent-service.ts \
  src/stores/tree-menu/service.ts; do
  cp "/tmp/mort-stash-recovery/files/$f" "$f"
done
```

### Step 3: Spot-check and build

After applying, verify:

1. `pnpm check` / `pnpm build` passes (TypeScript errors would indicate the stash depends on something not yet in HEAD)
2. Quick visual smoke test of the app
3. If a stash file fails to compile, compare `diff /tmp/mort-stash-recovery/files/<path> <path>` and decide whether to keep stash, keep working tree, or merge manually

### Skip

- **Category A** — already matching, nothing to do
- **Category D** — deleted plans, not recovering