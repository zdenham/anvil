# Sub-Plan 03: Frontend Permission UI

**Depends on:** `00-shared-contract.md`
**Parallel with:** `01-permission-evaluator.md`, `02-permission-hook.md` (no shared files)

All frontend work: pinned permission block, status dot variant, below-input status bar, mode cycling.

## Phases

- [x] Add "needs-input" StatusDot variant
- [x] Create `PermissionRequestBlock` component
- [x] Create `ThreadInputStatusBar` component (mode selector + context meter)
- [x] Wire into `ThreadInputSection` and add `Shift+Tab` cycling
- [x] Add mode change event emission + thread metadata update

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: "needs-input" StatusDot variant

### `src/components/ui/status-dot.tsx`

Add `"needs-input"` to `StatusDotVariant`:

```typescript
export type StatusDotVariant = "running" | "unread" | "read" | "stale" | "needs-input";
```

The `"needs-input"` variant uses amber with pulse animation — similar to `"running"` but amber instead of green. Add a CSS class `status-dot-needs-input` alongside the existing `status-dot-running` in the stylesheet.

```typescript
variant === "needs-input" && "status-dot-needs-input",
```

### `src/components/ui/status-legend.tsx`

Add "Needs Input" entry (amber dot) to the legend.

### `src/components/tree-menu/thread-item.tsx`

In `getTextColorClass()`, treat `"needs-input"` with amber shimmer to draw attention.

### Derivation logic

In the hook/component that computes thread status for the tree menu:

```
1. If thread has pending permission request OR pending AskUserQuestion → "needs-input"
2. If thread status is "running" → "running"
3. If unread → "unread"
4. Otherwise → "read"
```

`"needs-input"` takes priority over `"running"` because "blocked waiting for user" is more important.

### CSS

Add to the relevant CSS file (find where `status-dot-running` is defined):

```css
.status-dot-needs-input {
  @apply bg-amber-400;
  animation: status-dot-needs-input-pulse 2s ease-in-out infinite;
}

@keyframes status-dot-needs-input-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgb(251 191 36 / 0.6); }
  50% { opacity: 0.7; box-shadow: 0 0 4px 2px rgb(251 191 36 / 0); }
}
```

## Phase 2: `PermissionRequestBlock` component

Create `src/components/permission/permission-request-block.tsx` (~100 lines).

### Props

```typescript
interface PermissionRequestBlockProps {
  request: PermissionRequest & { status: PermissionStatus };
  onRespond: (requestId: string, decision: "approve" | "deny") => void;
}
```

### Behavior

- Renders pinned above the chat input (positioned by parent, not self-positioned)
- Shows: tool name, file path (if applicable), reason
- For Write/Edit in Supervise mode: shows a diff preview panel (future enhancement — for now show file path + tool input summary)
- Keyboard: `Enter` → approve, `Esc` → deny
- Auto-focuses when mounted
- Visual states:
  - Pending: accent border (blue/amber)
  - After response: disappears (parent removes it from DOM)
- Dangerous tools (`isDangerousTool()`) get amber warning icon

### Layout

```
┌─────────────────────────────────────────┐
│ ⚠ Allow Edit?                           │
│                                         │
│  src/components/app.tsx                  │
│  Reason: Supervise mode                 │
│                                         │
│           [Deny (Esc)]  [Approve (⏎)]   │
└─────────────────────────────────────────┘
```

## Phase 3: `ThreadInputStatusBar` component

Create `src/components/reusable/thread-input-status-bar.tsx` (~50 lines).

### Props

```typescript
interface ThreadInputStatusBarProps {
  threadId: string;
  permissionMode: PermissionModeId;
  onCycleMode: () => void;
}
```

### Layout

Below the chat input, full width of input container:

```
│  Plan                              ████░░ 42.3%  │
```

**Left:** Mode label with color coding. Clickable — calls `onCycleMode`.

| Mode | Color |
|------|-------|
| Plan | `text-blue-400` |
| Implement | `text-green-400` |
| Supervise | `text-yellow-400` |

**Right:** `<ContextMeter threadId={threadId} />` (relocated from content-pane-header).

### Context meter relocation

Remove `ContextMeter` rendering from `src/components/content-pane/content-pane-header.tsx`. The `ContextMeter` component itself (`src/components/content-pane/context-meter.tsx`) stays unchanged — just move where it's rendered.

## Phase 4: Wire into `ThreadInputSection`

### `src/components/reusable/thread-input-section.tsx`

Add new props:

```typescript
interface ThreadInputSectionProps {
  // ...existing props...
  threadId?: string;
  permissionMode?: PermissionModeId;
  onCycleMode?: () => void;
}
```

New render order:

1. `QuickActionsPanel`
2. `PermissionRequestBlock` (conditionally — when there's a pending request for this thread)
3. `ThreadInput`
4. `ThreadInputStatusBar` (conditionally — when `threadId` is provided)

### Permission request wiring

```typescript
const pendingRequest = usePermissionStore(
  (s) => threadId ? s.getNextRequestForThread(threadId) : undefined
);
```

When `pendingRequest` exists, render `PermissionRequestBlock` with:
```typescript
onRespond={(requestId, decision) => permissionService.respond(requestId, threadId, decision)}
```

### `Shift+Tab` handler

In `src/components/reusable/thread-input.tsx`, add to `onKeyDown`:

```typescript
if (e.shiftKey && e.key === "Tab") {
  e.preventDefault();
  onCycleMode?.();
}
```

Add `onCycleMode?: () => void` to `ThreadInput` props.

## Phase 5: Mode change event emission

When `onCycleMode` fires (from `Shift+Tab` or clicking the mode label):

1. Compute next mode: `PERMISSION_MODE_CYCLE[(currentIndex + 1) % 3]`
2. Update thread metadata on disk: `threadService.updateMetadata(threadId, { permissionMode: nextMode })`
3. Emit `PERMISSION_MODE_CHANGED` event to the agent process via hub socket
4. The local UI updates immediately (optimistic — the mode label color changes)

The agent-side handling of this event is in `02-permission-hook.md` — this plan only needs to emit it.

## Files

| File | Changes |
|------|---------|
| `src/components/ui/status-dot.tsx` | Add `"needs-input"` variant |
| `src/components/ui/status-legend.tsx` | Add "Needs Input" legend entry |
| `src/components/tree-menu/thread-item.tsx` | Handle `"needs-input"` in `getTextColorClass()` |
| `src/styles/` (CSS) | Add `status-dot-needs-input` animation |
| `src/components/permission/permission-request-block.tsx` | **New** — pinned permission block |
| `src/components/reusable/thread-input-status-bar.tsx` | **New** — below-input bar |
| `src/components/reusable/thread-input-section.tsx` | Add status bar + permission block + new props |
| `src/components/reusable/thread-input.tsx` | Add `Shift+Tab` + `onCycleMode` prop |
| `src/components/content-pane/content-pane-header.tsx` | Remove `ContextMeter` rendering |

## Integration boundary

This plan:
- **Reads** from permission store (existing `usePermissionStore`)
- **Sends** `PERMISSION_RESPONSE` via existing `permissionService.respond()`
- **Emits** `PERMISSION_MODE_CHANGED` via hub socket
- **Never imports** from `agents/src/` (type layering preserved)

The agent-side plans (01, 02) handle the other side of the event bridge.
