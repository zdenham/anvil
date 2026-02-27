# Approve Mode Improvements

Three issues with the current approve mode UX:

1. **Permission block is pinned above input**, not inline in the chat where the tool use happens
2. **Non-destructive tools prompt unnecessarily** — `TodoWrite`, `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`, `Skill`, `SendMessage`, and similar tools fall through to `defaultDecision: "ask"` because they don't match any explicit rule
3. **Large diffs overwhelm the approval UI** — a big edit shows the entire diff expanded, pushing the approve/deny controls far off-screen

## Phases

- [x] Auto-allow non-destructive tools in approve mode rules
- [x] Move permission request block inline into the chat stream
- [x] Auto-collapse large diffs in the approval preview

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Auto-allow non-destructive tools

**Problem:** The approve mode rules only explicitly allow `Read|Glob|Grep|WebFetch|WebSearch`, `Bash`, and `Task`. Everything else falls through to `defaultDecision: "ask"`. This means `TodoWrite`, `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`, `Skill`, `SendMessage`, `TeamCreate`, `TeamDelete`, `TaskOutput`, `TaskStop` all trigger a permission prompt even though they're non-destructive.

**Fix:** Add an explicit allow rule for non-destructive tools before the write-tools ask rule.

**File:** `core/types/permissions.ts` lines 115-126

Change the `APPROVE_MODE` rules to:

```typescript
export const APPROVE_MODE: PermissionModeDefinition = {
  id: "approve",
  name: "Approve",
  description: "Read/Bash auto-approved, file edits require approval with diff preview",
  rules: [
    { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
    { toolPattern: "^Bash$", decision: "allow" },
    { toolPattern: "^Task$", decision: "allow" },
    { toolPattern: "^(TodoWrite|AskUserQuestion|EnterPlanMode|ExitPlanMode|Skill|SendMessage|TeamCreate|TeamDelete|TaskOutput|TaskStop)$", decision: "allow" },
    { toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "ask" },
  ],
  defaultDecision: "ask",
};
```

This keeps the `defaultDecision: "ask"` as a safe fallback for any unknown future tools, but explicitly whitelists the known non-destructive SDK tools.

---

## Phase 2: Inline permission block in the chat stream

**Problem:** The permission request currently renders pinned above the input area (`thread-input-section.tsx:73-78`). This is disorienting — the user sees a tool use in the chat stream, then has to look down at the bottom to approve it. The approval UI should appear right where the tool use block is, as part of the assistant message.

**Approach:** Render the permission request as a state of the tool-use block in the chat, not as a separate pinned component. When a tool has `status: "pending_approval"`, the tool block itself shows the diff/input preview with approve/deny controls.

### Changes

**1. Add permission state to tool execution states**

`src/lib/types/agent-messages.ts` — The `ToolExecutionState` type needs a `"pending_approval"` variant, or the tool block can check the permission store directly.

Simpler approach: the existing `ToolUseBlock` component (rendered inside `AssistantMessage`) should check if the tool has a pending permission request and render the approval UI inline.

**2. Remove pinned permission block from `thread-input-section.tsx`**

Remove the `PermissionRequestBlock` rendering from `thread-input-section.tsx` (lines 73-78) and the related imports/state.

**3. Add inline approval UI to `ToolUseBlock`**

In the tool-use block component (wherever it renders tool name + spinner/result), add a check:
- Look up pending permission requests for the current thread + tool use
- If a pending request exists for this tool invocation, render the `PermissionRequestBlock` (or a variant of it) inline within the tool block
- The `requestId` from the permission request needs to match the tool use — currently the permission request includes `toolName` and `toolInput` but we also need to correlate with the streaming tool-use ID

**4. Correlation between tool use and permission request**

Current flow: the permission request includes `requestId`, `threadId`, `toolName`, `toolInput`, `timestamp`. The streaming tool-use block has a `tool_use_id`. These aren't directly linked.

Option A: Add `toolUseId` to the permission request event so the UI can match them.
Option B: Match by `toolName` + `toolInput` + timing (fragile).

**Recommended: Option A.** In `agents/src/runners/shared.ts` (line 495-507), the PreToolUse hook receives `_toolUseId` as the second parameter — pass this into `permissionGate.waitForResponse()` and include it in the `PERMISSION_REQUEST` event. Then the tool block can match on `toolUseId`.

Changes needed:
- `agents/src/lib/permission-gate.ts`: Add `toolUseId` to the emitted event payload
- `core/types/events.ts`: Add `toolUseId` to `PERMISSION_REQUEST` event type
- `core/types/permissions.ts`: Add `toolUseId` to `PermissionRequestSchema`
- `src/entities/permissions/store.ts`: Index by `toolUseId` for fast lookup
- The tool-use block component: Check store for pending request matching `toolUseId`, render approval UI if found

**5. Keyboard handling**

Currently the pinned block auto-focuses and captures arrow keys. For inline rendering, we need focus management that works within the scrollable message list. The approval controls should auto-scroll into view and capture keyboard focus.

**6. Auto-scroll**

When a permission request appears inline in the chat, the message list should auto-scroll to show it (same as it does for new streaming content).

---

## Phase 3: Auto-collapse large diffs in the approval preview

**Problem:** When an Edit or Write tool produces a large diff (e.g. 200+ changed lines), the entire diff renders expanded in the permission approval block. This pushes the approve/deny controls far below the viewport, requiring the user to scroll past a wall of code just to respond. It should behave like tool-use blocks do — default collapsed past a threshold, with a click to expand.

**Approach:** Wrap the `InlineDiffBlock` inside the permission/tool-use approval UI with the existing `CollapsibleOutputBlock` pattern when the diff exceeds a line threshold. Small diffs remain fully visible; large diffs show a preview with a gradient fade and "Show full diff" expand button.

### Changes

**1. Add a `defaultCollapsed` prop to `InlineDiffBlock`**

`src/components/thread/inline-diff-block.tsx` — Add an optional `defaultCollapsed?: boolean` prop. When true, the diff content area renders inside a `CollapsibleOutputBlock` (from `src/components/ui/collapsible-output-block.tsx`) with `maxCollapsedHeight` set to something reasonable like `200px` (roughly 10-12 lines of code). The user can click "Expand" to see the full diff.

This reuses the exact same collapse/expand UX that bash output and tool results already use — gradient overlay at the bottom with an expand button.

**2. Determine the threshold**

The caller decides whether to pass `defaultCollapsed`. The logic lives where `InlineDiffBlock` is instantiated for approval:

- In `PermissionRequestBlock` (`src/components/permission/permission-request-block.tsx`): compute total line count from the diff data. If it exceeds a threshold (e.g. **40 lines**), pass `defaultCollapsed={true}`.
- After Phase 2, the same logic applies wherever the inline approval UI renders inside `ToolUseBlock`.

**Why 40 lines:** Small enough that a ~10-line edit stays fully visible (no UX regression), large enough that a full-file rewrite or multi-hunk edit collapses to a manageable preview. The collapsed height of `200px` shows roughly the first 10 lines — enough context to verify the file and nature of the change before expanding.

**3. Preserve expand/collapse state**

Use local component state (not the Zustand `toolExpandStore`) since the permission block is ephemeral — it disappears after approval. No need to persist collapse state across re-renders.

**4. Keep approve/deny controls always visible**

The approve/deny controls (`InlineDiffActions` or the `PermissionRequestBlock` buttons) must render **below** the collapsible area so they're always visible regardless of collapse state. This is already the natural layout — the actions render after the diff block. The key constraint is that collapsing the diff must not also hide the action buttons.
