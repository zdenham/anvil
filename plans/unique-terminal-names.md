# Unique Terminal Names

Make terminal names unique and auto-name them after the first command run.

## Problem

All terminals for the same worktree display the same name (directory name fallback), making them indistinguishable. The `updateLastCommand()` method exists in the service but is never called from anywhere.

## Phases

- [ ] Add command tracking to detect commands from user input

- [ ] Wire command tracker into terminal content component

- [ ] Generate unique fallback names for terminals without commands

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Design

### Phase 1: Command tracker (`src/entities/terminal-sessions/command-tracker.ts`)

A lightweight class that tracks user keystrokes per terminal to detect command execution.

**How it works:**

- Accumulates characters typed by the user into a line buffer per terminal
- On Enter (`\r`), extracts the buffered text as the command, trims whitespace, and calls `terminalSessionService.updateLastCommand(id, command)` if non-empty
- Handles: backspace (`\x7f` → delete last char), Ctrl+C (`\x03` → clear buffer), Ctrl+U (`\x15` → clear buffer)
- Ignores escape sequences (anything starting with `\x1b`) — these are arrow keys, tab completion results, etc.
- Resets buffer after Enter

**API:**

```ts
class CommandTracker {
  /** Feed raw user input data for a terminal */
  handleInput(terminalId: string, data: string): void
  /** Clear tracking state for a terminal */
  clear(terminalId: string): void
}

export const commandTracker = new CommandTracker();
```

**Limitations accepted:** Tab completion and shell history navigation won't be captured accurately. This is fine — the common case (user types a command and presses Enter) will work. The name updates on every command via `lastCommand`, so stale names self-correct quickly.

### Phase 2: Wire into terminal content (`src/components/content-pane/terminal-content.tsx`)

In `handleInput`, add a call to `commandTracker.handleInput(terminalId, data)` alongside the existing PTY write. This is a one-line addition inside the existing callback.

Also call `commandTracker.clear(terminalId)` in the cleanup function.

### Phase 3: Unique fallback names and consistent display

When no `label` and no `lastCommand` exist, terminals currently all show the same directory name. Fix this with auto-generated labels and unified display priority.

**Auto-label format:** `worktree-name N` — e.g. `mortician 1`, `mortician 2`. Uses the worktree directory basename, matching the existing fallback but adding a disambiguating index.

**Service changes** (`src/entities/terminal-sessions/service.ts`):

- In `create()` and `createPlaceholder()`, auto-generate `label` as `"dirname N"` where `dirname = worktreePath.split("/").pop()` and `N = existingCountForWorktree + 1`. This persists to disk.

**Unified display priority** — all three locations should use the same logic:

```
label (user-set) → lastCommand → auto-label → "Terminal"
```

The key distinction: a **user-set label** (via `setLabel()`) takes priority over everything including `lastCommand`. The auto-generated label is a fallback that `lastCommand` *does* override. To implement this, add a boolean `isAutoLabel` field to the session. When `label` is set by `create()`/`createPlaceholder()`, set `isAutoLabel: true`. When set by `setLabel()` (user action), set `isAutoLabel: false`.

Display logic becomes:

```ts
const effectiveLabel = (session.label && !session.isAutoLabel) ? session.label : null;
return effectiveLabel ?? session.lastCommand ?? session.label ?? "Terminal";
```

- User-set label → always wins
- `lastCommand` → overrides auto-label
- Auto-label (`mortician [1]`) → fallback when no command yet
- `"Terminal"` → last resort

**All three display locations must use the same unified priority:**

- **Tabs** (`use-tab-label.ts`): Currently line 60 skips `label` entirely (`session.lastCommand ?? dirname`). Update to use the unified display priority above.
- **Sidebar** (`tree-node-builders.ts`): Already has `label ?? lastCommand ?? dirname` — update to use the `isAutoLabel`-aware logic.
- **Header** (`content-pane-header.tsx`): Same — update to use `isAutoLabel`-aware logic.

**Net result:** A brand new terminal shows `mortician 1` in the tab, sidebar, and header. After the first command (e.g., `npm run dev`), all three locations show `npm run dev`. If the user explicitly renames it to "My Server", that name sticks everywhere regardless of commands run.

## Files Changed

| File | Change |
| --- | --- |
| `src/entities/terminal-sessions/command-tracker.ts` | New — command detection from user input |
| `src/components/content-pane/terminal-content.tsx` | Wire `commandTracker.handleInput()` into `handleInput` callback |
| `src/entities/terminal-sessions/service.ts` | Auto-generate `label` with `isAutoLabel: true` in `create()` and `createPlaceholder()` |
| `src/components/split-layout/use-tab-label.ts` | Use unified display priority (currently skips `label`) |
| `src/components/content-pane/content-pane-header.tsx` | Use `isAutoLabel`-aware display priority |
| `src/entities/terminal-sessions/tree-node-builders.ts` | Use `isAutoLabel`-aware display priority |
