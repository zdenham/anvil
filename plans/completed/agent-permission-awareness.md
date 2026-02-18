# Agent Permission Mode Awareness

Improve how the agent (LLM) understands and interacts with our custom permission modes. Three concerns:

1. **System prompt awareness** — Tell the agent what mode it's in at startup, what modes exist, and (in Plan mode) where to write plans
2. **UI filtering** — Hide injected system messages from the chat UI so mode-change notifications don't render as user bubbles
3. **Descriptive deny reasons** — Make tool deny messages actionable so the agent adapts quickly instead of guessing

## Phases

- [x] Add permission mode context to the appended system prompt
- [x] Filter system-injected messages from UI rendering
- [x] Improve deny reason messages to be descriptive and actionable
- [x] Use `<system-reminder>` tags for mid-run mode change notifications
- [x] Rename "supervise" → "approve" across the entire codebase

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add Permission Mode Context to System Prompt

The agent currently has **zero upfront awareness** of permission modes. It discovers constraints reactively through tool errors. We should tell it what mode it starts in, what the modes mean, and — critically for Plan mode — where the `plans/` directory is.

### Where to add it

In `agents/src/runners/shared.ts`, the `buildSystemPrompt()` function assembles the appended prompt from `config.appendedPrompt` + runtime context. We need to:

1. Accept `permissionModeId` as a new parameter to `buildSystemPrompt()`
2. Look up the mode definition from `BUILTIN_MODES`
3. Append a `<permissions>` block to the runtime context

### What to inject

The permission context block should be concise — this is system prompt budget. It lives alongside the `<env>` and `<git>` blocks in `formatSystemPromptContext()`.

```
<permissions>
Active mode: Plan
Modes: Plan (read all, write plans/ only) | Implement (all tools allowed) | Approve (edits need approval)
The user can switch modes at any time. You will be notified via a system message when this happens.
</permissions>
```

When in **Plan mode specifically**, append additional plan-directory context:

```
<permissions>
Active mode: Plan
Modes: Plan (read all, write plans/ only) | Implement (all tools allowed) | Approve (edits need approval)
The user can switch modes at any time. You will be notified via a system message when this happens.

You are in Plan mode. Write all plans and design documents to the plans/ directory.
- Use kebab-case filenames (e.g., plans/user-auth.md)
- For multi-part plans, create a folder with readme.md as the parent (e.g., plans/user-auth/readme.md)
- You may read any file in the codebase but can only write to plans/
</permissions>
```

### Files to modify

| File | Changes |
|------|---------|
| `agents/src/runners/shared.ts` | `buildSystemPrompt()` — accept `permissionModeId`, pass to `formatSystemPromptContext()` |
| `agents/src/context.ts` | `formatSystemPromptContext()` — accept `permissionModeId`, append `<permissions>` block |
| `agents/src/runners/shared.ts` | Call site at ~line 379 — pass `context.permissionModeId ?? "plan"` through |

### Design notes

- Keep the block under 10 lines — the agent gets plan conventions separately via `PLAN_CONVENTIONS` in the appended prompt
- Don't duplicate the full rule definitions; the hook enforces them regardless
- The purpose is to **reduce wasted tool calls**, not to be the source of truth for permissions

---

## Phase 2: Filter System-Injected Messages from UI Rendering

Currently, when the permission mode changes mid-run, a message is injected via `messageStream.push()`:
```typescript
messageStream.push(id, `[System] Permission mode changed to "Plan". ...`);
```

This becomes a `{ role: "user", content: "..." }` message in `state.messages`, which the UI renders as a user bubble. These should be hidden.

### Approach: Content-based prefix filtering

The simplest approach that doesn't require schema changes to `MessageParam` or `state.json`:

1. Define a constant prefix for system-injected messages: `"[System] "`
2. Filter at the `turn-grouping.ts` level so it's centralized

### Implementation

**`src/lib/utils/turn-grouping.ts`** — add a helper:

```typescript
/** Check if a user turn is a system-injected message (not from the human user) */
export function isSystemInjectedTurn(turn: Turn): boolean {
  if (turn.type !== "user") return false;
  const content = turn.message.content;
  if (typeof content === "string") return content.startsWith("[System] ");
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "text" && block.text.startsWith("[System] ")) return true;
    }
  }
  return false;
}
```

**`src/components/thread/turn-renderer.tsx`** — add filtering alongside the existing `isToolResultOnlyTurn` check:

```typescript
import { isToolResultOnlyTurn, isSystemInjectedTurn } from "@/lib/utils/turn-grouping";

// Skip rendering system-injected messages (e.g., permission mode changes)
if (turn.type === "user" && isSystemInjectedTurn(turn)) {
  return null;
}
```

### Files to modify

| File | Changes |
|------|---------|
| `src/lib/utils/turn-grouping.ts` | Add `isSystemInjectedTurn()` helper |
| `src/components/thread/turn-renderer.tsx` | Import and use `isSystemInjectedTurn` to skip rendering |

### Notes

- Messages are still persisted in `state.json` (disk-as-truth) — only hidden from rendering
- The `[System] ` prefix convention is already used in `runner.ts:200` — just formalize it
- The agent still sees these messages in its conversation context — they're only hidden from the human UI

---

## Phase 3: Improve Deny Reason Messages

Current deny reasons are functional but terse. The agent sees strings like:
- `"Plan mode: writes are restricted to the plans/ directory"` (good, but only for one rule)
- `"Plan mode default"` (useless — what was denied? why?)
- `"Approve mode default"` (same problem)
- `"override"` (what override? what's blocked?)

The agent sees these as tool errors and needs to understand what happened and what to do instead.

### New deny reason format

Pattern: `"[Mode] mode: [what happened]. [what to do instead]"`

### Updated rules in `core/types/permissions.ts`

**Global overrides:**
```typescript
{
  toolPattern: "^Bash$",
  commandPattern: "rm\\s+(-rf|--force).*\\.git",
  decision: "deny",
  reason: "Safety override: cannot delete .git directory. This is a global protection that cannot be bypassed in any mode."
},
{
  toolPattern: "^(Write|Edit)$",
  pathPattern: "\\.env",
  decision: "deny",
  reason: "Safety override: cannot modify .env files. This is a global protection that cannot be bypassed in any mode."
},
```

**Plan mode:**
```typescript
// The existing write-to-plans rule already has a good reason — keep it
{ toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "deny",
  reason: "Plan mode: file writes are restricted to the plans/ directory. Move your output to plans/ or ask the user to switch to Implement mode." },
```

**Plan mode default decision reason:**
Change the `defaultDecision` to use a more descriptive fallback. Since `defaultDecision` itself doesn't carry a reason string, the reason comes from the evaluator's fallback at line 138. We should make the evaluator's default reason more descriptive by including the tool name.

### Evaluator changes in `agents/src/lib/permission-evaluator.ts`

Update the default fallback to include what was attempted:

```typescript
// 3. Mode default
return {
  decision: this.mode.defaultDecision,
  reason: `${this.mode.name} mode: "${toolName}" is not in the allowed tool list. ${this.mode.description}.`,
};
```

This changes `"Plan mode default"` → `"Plan mode: "TodoWrite" is not in the allowed tool list. Can read everything, write only to plans/, Bash allowed."`

### Files to modify

| File | Changes |
|------|---------|
| `core/types/permissions.ts` | Update `reason` strings on global overrides and Plan mode deny rule |
| `agents/src/lib/permission-evaluator.ts` | Update default fallback reason to include `toolName` and mode description |

---

## Phase 4: Use `<system-reminder>` Tags for Mid-Run Notifications

Currently the injected mode-change message is plain text:
```
[System] Permission mode changed to "Plan". Can read everything, write only to plans/, Bash allowed
```

The `<system-reminder>` tag pattern is used by Claude Code itself to inject system-level context into user messages. The model treats content within these tags with higher authority than regular user text.

### Changes to `agents/src/runner.ts`

Update the message injection at ~line 198:

```typescript
messageStream.push(
  crypto.randomUUID(),
  `[System] <system-reminder>Permission mode changed to "${newMode.name}". ${newMode.description}.</system-reminder>`,
);
```

Keep the `[System] ` prefix so the UI filtering from Phase 2 still works. The `<system-reminder>` wrapping gives the content more weight in the model's attention.

**For Plan mode specifically**, include the plans directory instruction:

```typescript
const planContext = newMode.id === "plan"
  ? " Write all plans to the plans/ directory."
  : "";
messageStream.push(
  crypto.randomUUID(),
  `[System] <system-reminder>Permission mode changed to "${newMode.name}". ${newMode.description}.${planContext}</system-reminder>`,
);
```

### Files to modify

| File | Changes |
|------|---------|
| `agents/src/runner.ts` | Update mode change notification at ~line 198 to use `<system-reminder>` tags and plan-specific context |

---

## Phase 5: Rename "supervise" → "approve" Across the Codebase

The mode name "supervise" implies the agent is doing the supervising. The intended meaning is the opposite — the user approves each action. Rename to "approve" for clarity and consistency with the verb trio: **plan / implement / approve**.

### Scope

Every occurrence of `supervise`, `Supervise`, and `SUPERVISE` in identifiers, string literals, type unions, comments, and plan docs.

### Source files to modify

| File | Changes |
|------|---------|
| `core/types/permissions.ts` | `PermissionModeId` union: `"supervise"` → `"approve"`, `SUPERVISE_MODE` → `APPROVE_MODE`, `id: "supervise"` → `id: "approve"`, `name: "Supervise"` → `name: "Approve"`, `BUILTIN_MODES.supervise` → `BUILTIN_MODES.approve` |
| `core/types/threads.ts` | Zod enum and type literal: `"supervise"` → `"approve"` |
| `agents/src/context.ts` | Mode description map key: `supervise:` → `approve:`, display string `"Approve (edits need approval)"` → `"Approve (edits need approval)"` |
| `agents/src/runners/types.ts` | JSDoc comment: `"supervise"` → `"approve"` |
| `agents/src/lib/permission-evaluator.ts` | Any references to supervise mode in logic or comments |
| `agents/src/lib/__tests__/permission-evaluator.test.ts` | Import `SUPERVISE_MODE` → `APPROVE_MODE`, update test descriptions and references |
| `src/components/reusable/thread-input-status-bar.tsx` | Status bar color map key and description: `supervise:` → `approve:` |
| `src/components/content-pane/thread-content.tsx` | Mode cycle comment: `plan -> implement -> supervise` → `plan -> implement -> approve` |

### Plan docs to update

| File | Changes |
|------|---------|
| `plans/permissions-modes/readme.md` | All references to "Supervise" / "supervise" / `SUPERVISE_MODE` |
| `plans/permissions-modes/00-shared-contract.md` | Type definitions, constants, enum values |
| `plans/permissions-modes/01-permission-evaluator.md` | Test case descriptions |
| `plans/permissions-modes/03-permission-ui.md` | UI descriptions and examples |
| `plans/fix-permission-mode-spawn.md` | Narrative references |
| `plans/agent-permission-awareness.md` | This file — update all inline examples and references |

### Notes

- This is a pure rename — no behavioral changes
- Run `pnpm test` after to verify nothing breaks
- Search for `supervise` case-insensitively to catch any stragglers
- Any persisted `metadata.json` files on disk with `"permissionMode": "supervise"` will need migration or fallback handling (accept both values during a transition period)

---

## Files Summary

| File | Phase | Changes |
|------|-------|---------|
| `agents/src/context.ts` | 1 | Accept `permissionModeId`, append `<permissions>` block |
| `agents/src/runners/shared.ts` | 1 | Pass `permissionModeId` through to `buildSystemPrompt()` → `formatSystemPromptContext()` |
| `src/lib/utils/turn-grouping.ts` | 2 | Add `isSystemInjectedTurn()` |
| `src/components/thread/turn-renderer.tsx` | 2 | Filter system-injected turns from rendering |
| `core/types/permissions.ts` | 3 | Improve deny `reason` strings |
| `agents/src/lib/permission-evaluator.ts` | 3 | Include tool name and mode description in default deny reason |
| `agents/src/runner.ts` | 4 | Use `<system-reminder>` tags + plan-specific context in mode change notification |
| `core/types/permissions.ts` | 5 | Rename `SUPERVISE_MODE` → `APPROVE_MODE`, update id/name/type union |
| `core/types/threads.ts` | 5 | Rename `"supervise"` → `"approve"` in Zod enum and type literal |
| `agents/src/context.ts` | 5 | Rename `supervise` key → `approve` in mode description map |
| `agents/src/runners/types.ts` | 5 | Update JSDoc reference |
| `agents/src/lib/permission-evaluator.ts` | 5 | Update any supervise references |
| `agents/src/lib/__tests__/permission-evaluator.test.ts` | 5 | Rename imports and test descriptions |
| `src/components/reusable/thread-input-status-bar.tsx` | 5 | Rename `supervise` key → `approve` |
| `src/components/content-pane/thread-content.tsx` | 5 | Update mode cycle comment |
| `plans/permissions-modes/*.md` | 5 | Update all plan docs |
