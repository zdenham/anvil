# Approve Mode Improvements

Three issues with the current approve mode UX:

1. **Permission block is pinned above input**, not inline in the chat where the tool use happens
2. **No syntax highlighting** in the diff preview shown in the permission block
3. **Non-destructive tools prompt unnecessarily** — `TodoWrite`, `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`, `Skill`, `SendMessage`, and similar tools fall through to `defaultDecision: "ask"` because they don't match any explicit rule

## Phases

- [ ] Auto-allow non-destructive tools in approve mode rules
- [ ] Move permission request block inline into the chat stream
- [ ] Add syntax highlighting to the permission diff preview

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

## Phase 3: Syntax highlighting in diff preview

**Problem:** The diff preview in the permission block shows plain monochrome text. The rest of the app uses Shiki for syntax highlighting (code blocks, full diff viewer).

**Approach:** The `InlineDiffBlock` already supports `tokens` on `AnnotatedLine` objects (via `AnnotatedLineRow` → `TokenizedContent`). The issue is that `useToolDiff` doesn't run the lines through Shiki before returning them.

### Changes

**1. Highlight diff lines in `useToolDiff`**

`src/components/thread/use-tool-diff.ts` — After building `AnnotatedLine[]` from the tool input, run them through the existing `highlightDiff()` function from `src/lib/highlight-diff.ts`. This will populate the `tokens` field on each line.

The language can be inferred from the file extension (the file path is available in the tool input).

**2. Use `useCodeHighlight` pattern for async loading**

Since Shiki highlighting is async, follow the same pattern used in `code-block.tsx`:
- Return unhighlighted lines immediately (current behavior = no regression)
- Kick off async highlighting
- Update lines with tokens once available
- The `AnnotatedLineRow` component already handles both cases (renders `TokenizedContent` when tokens exist, falls back to plain text otherwise)

This means the diff preview will flash in plain text briefly then get syntax-colored — same as code blocks in the chat do during streaming.
