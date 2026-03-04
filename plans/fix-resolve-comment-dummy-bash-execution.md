# Fix: mort-resolve-comment still executes a dummy Bash command

## Problem

When the agent addresses comments and runs `mort-resolve-comment "id1,id2"`, the PreToolUse hook in `comment-resolution-hook.ts` correctly:
1. Intercepts the command
2. Emits `COMMENT_RESOLVED` events (comments get resolved)
3. Rewrites the command to `echo "Resolved N comment(s): id1, id2"`

But step 3 means a **Bash tool call still executes** — the `echo` command runs and shows up in the thread UI as a visible tool block. The user sees a Bash execution of `echo "Resolved..."` which is confusing and unnecessary.

Thread reference: `8203ad39-2bed-4467-a793-d264e19c7391` in mort-dev.

## Root Cause

The SDK's PreToolUse hook API doesn't support returning a synthetic tool result without running the tool. The only options are:
- `permissionDecision: "allow"` + `updatedInput` → tool runs with modified input (current: echo runs)
- `permissionDecision: "deny"` → tool doesn't run, agent sees error
- `permissionDecision: "ask"` → falls through to canUseTool

The current approach chose `allow` + echo rewrite as a compromise: the agent sees a successful result, but the dummy echo command still visibly executes.

## Approach

Switch from `allow` + echo rewrite to `deny` + a clear success message. The key insight: `deny` with `permissionDecisionReason` sends the reason text back to the agent as the tool error message. If we make the reason clearly indicate success (not failure), the agent will understand the comments were resolved and won't retry.

To reinforce this, also update the prompt in `formatAddressPrompt()` to tell the agent that `mort-resolve-comment` is a virtual command that gets intercepted — a "deny" response with a success message is expected behavior.

### Why this works
- No Bash tool execution at all — nothing shows in the thread UI
- The agent still gets feedback via the deny reason
- The `additionalContext` field provides extra guidance to the model
- The prompt primes the agent to expect this behavior

### Why not other approaches
- **Auto-resolve on Edit/Write**: Too aggressive — would resolve comments even if the agent only partially addressed them. Also a much bigger architectural change.
- **Hide echo in UI**: Hides the symptom, not the cause. Still wastes a Bash tool call round-trip.
- **Custom tool instead of Bash**: Would require SDK-level changes and is much more complex.

## Phases

- [x] Update comment resolution hook to use deny + success message
- [x] Update formatAddressPrompt to explain virtual command behavior
- [x] Update tests to match new deny-based behavior

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### 1. Update `agents/src/hooks/comment-resolution-hook.ts`

Change the success return from `allow` + echo rewrite to `deny` + success reason:

```diff
-    // Rewrite command to a harmless echo — agent sees success
-    return {
-      hookSpecificOutput: {
-        hookEventName: "PreToolUse" as const,
-        permissionDecision: "allow" as const,
-        updatedInput: {
-          command: `echo "Resolved ${ids.length} comment(s): ${ids.join(", ")}"`,
-        },
-      },
-    };
+    // Deny the command (prevents any Bash execution) but with a success reason
+    // so the agent understands the comments were resolved, not that something failed.
+    return {
+      reason: `Resolved ${ids.length} comment(s): ${ids.join(", ")}. Comments have been marked as resolved internally — no Bash execution needed.`,
+      hookSpecificOutput: {
+        hookEventName: "PreToolUse" as const,
+        permissionDecision: "deny" as const,
+        permissionDecisionReason: `Successfully resolved ${ids.length} comment(s). This is a virtual command handled by the system.`,
+      },
+    };
```

### 2. Update `formatAddressPrompt()` in both button components

In `src/components/diff-viewer/address-comments-button.tsx` and `floating-address-button.tsx`:

```diff
     "For each comment, make the requested change. After addressing a comment, mark it resolved:",
-    `mort-resolve-comment "${commentIds.join(",")}"`,
+    `mort-resolve-comment "${commentIds.join(",")}"`,
+    "",
+    "Note: mort-resolve-comment is a virtual command intercepted by the system. It will appear as \"denied\" in the tool output but the comments ARE resolved — this is expected behavior, do not retry.",
```

### 3. Update tests in `agents/src/hooks/__tests__/comment-resolution-hook.test.ts`

Update all assertions from `permissionDecision: "allow"` + `updatedInput` to `permissionDecision: "deny"` + no `updatedInput`:

```diff
-      expect(result).toMatchObject({
-        hookSpecificOutput: {
-          permissionDecision: "allow",
-          updatedInput: {
-            command: 'echo "Resolved 1 comment(s): abc-123"',
-          },
-        },
-      });
+      expect(result).toMatchObject({
+        reason: expect.stringContaining("Resolved 1 comment(s)"),
+        hookSpecificOutput: {
+          permissionDecision: "deny",
+          permissionDecisionReason: expect.stringContaining("Successfully resolved 1 comment(s)"),
+        },
+      });
```

Remove the entire "updatedInput rewrite" describe block since there's no longer an updatedInput.

## Files Changed

| File | Change |
|------|--------|
| `agents/src/hooks/comment-resolution-hook.ts` | `allow` + echo → `deny` + success reason |
| `agents/src/hooks/__tests__/comment-resolution-hook.test.ts` | Update assertions for deny behavior |
| `src/components/diff-viewer/address-comments-button.tsx` | Add note about virtual command in prompt |
| `src/components/diff-viewer/floating-address-button.tsx` | Add note about virtual command in prompt |

## Risk

**Agent retry risk**: The agent sees `is_error: true` on the tool result (since it's denied). It might retry. Mitigations:
1. The deny reason clearly says "Successfully resolved" — not an error
2. The `permissionDecisionReason` reinforces this
3. The prompt explicitly tells the agent not to retry
4. If retries are observed in practice, we can add `additionalContext` to the hook output for stronger model guidance

**Testing**: Run `cd agents && pnpm test` to verify hook tests pass after the changes.
