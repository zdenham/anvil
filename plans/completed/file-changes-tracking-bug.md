# File Changes Tracking Bug Analysis

**Status: FIXED**

## Implementation Summary

The fix was implemented as follows:
1. Added file tracking to the `PostToolUse` hook in `agents/src/runners/shared.ts`
2. Removed redundant file tracking code from `agents/src/runners/message-handler.ts`

Files modified:
- `agents/src/runners/shared.ts` - Added `updateFileChange()` call in PostToolUse hook
- `agents/src/runners/message-handler.ts` - Removed `pendingFileOps` Map, `FILE_MODIFYING_TOOLS` constant, and file tracking logic

---

## Issue
Files being edited by the agent (Edit/Write tools) are not being tracked in the `fileChanges` array in `state.json`.

## Evidence
Thread state at `/Users/zac/.anvil-dev/tasks/0294860d-3bc7-409a-a062-8062ccdde41d/threads/simple-fe97bffb-6558-4ca4-bc5c-92725f98806a/state.json` shows:
- `toolStates` correctly contains Edit tool completion with file path `/Users/zac/Documents/juice/anvil/anvil/README.md`
- `fileChanges` is empty: `[]`

The same pattern is observed across multiple threads.

## Root Cause Analysis

### The Problem: Duplicate Tool Result Handling with Different Capabilities

There are **two code paths** that handle tool results:

1. **`PostToolUse` hook in `shared.ts`** (lines 210-236):
   - Fires after tool execution
   - Has access to `tool_name`, `tool_input`, and `tool_response`
   - Calls `markToolComplete()`
   - Does **NOT** call `updateFileChange()`

2. **`MessageHandler.handleUser`** (lines 106-134):
   - Processes SDK `user` messages with `parent_tool_use_id`
   - Looks up `pendingFileOps` map (populated by `handleAssistant`)
   - Calls `markToolComplete()`
   - **DOES** call `updateFileChange()` (lines 120-131)

### The Critical Issue

The `PostToolUse` hook fires **FIRST** and calls `markToolComplete()`. This works correctly for tracking tool state.

However, the file tracking code in `MessageHandler.handleUser` (which calls `updateFileChange()`) depends on receiving a `user` message with `parent_tool_use_id` from the SDK.

**The bug is that when `PostToolUse` hooks are registered, the SDK may not emit separate `user` messages for tool results to the async iterator.** The hook mechanism replaces/supersedes the message emission.

This is consistent with the hooks documentation which shows `PostToolUse` as the primary way to intercept tool results when using hooks.

## Message Flow Comparison

### Expected Flow (without hooks)
```
1. SDK emits assistant message with tool_use block
2. MessageHandler.handleAssistant tracks pendingFileOps
3. Tool executes
4. SDK emits user message with parent_tool_use_id
5. MessageHandler.handleUser:
   - Calls markToolComplete
   - Looks up pendingFileOps
   - Calls updateFileChange ← FILE TRACKING HAPPENS
```

### Actual Flow (with PostToolUse hook)
```
1. SDK emits assistant message with tool_use block
2. MessageHandler.handleAssistant tracks pendingFileOps
3. Tool executes
4. PostToolUse hook fires:
   - Calls markToolComplete ← TOOL STATE TRACKING HAPPENS
   - Does NOT call updateFileChange ← FILE TRACKING MISSING!
5. SDK may or may not emit user message (depends on hook return)
6. If user message is emitted, MessageHandler.handleUser:
   - Calls markToolComplete again (duplicate, harmless)
   - Looks up pendingFileOps (may still work)
   - Calls updateFileChange ← BUT message may not be emitted!
```

## Verification

Looking at the `PostToolUseHookInput` type from the SDK documentation:
```typescript
type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;  // ← FILE PATH IS HERE!
  tool_response: unknown;
}
```

The hook **does have access to `tool_input`** which contains `file_path`, but the current implementation doesn't extract it.

## Proposed Fix

### Option A: Track file changes in the `PostToolUse` hook (Recommended)

Modify `shared.ts` to extract file path from `tool_input` and call `updateFileChange()`:

```typescript
PostToolUse: [
  {
    // Match file-modifying tools
    matcher: 'Edit|Write|NotebookEdit',
    hooks: [
      async (hookInput: unknown) => {
        const input = hookInput as PostToolUseHookInput;
        const toolInput = input.tool_input as { file_path?: string; notebook_path?: string };
        const filePath = toolInput.file_path ?? toolInput.notebook_path;

        if (filePath) {
          const operation = input.tool_name === "Write" ? "create" : "modify";
          await updateFileChange({
            path: filePath,
            operation,
            diff: "", // Path is what matters for diffing
          });
        }

        return { continue: true };
      },
    ],
  },
  {
    // Handle all tools for state tracking
    hooks: [
      async (hookInput: unknown) => {
        const input = hookInput as PostToolUseHookInput;
        const toolResponse = typeof input.tool_response === "string"
          ? input.tool_response
          : JSON.stringify(input.tool_response);

        await markToolComplete(input.tool_use_id, toolResponse, false);
        relayEventsFromToolOutput(toolResponse);

        if (options.onFileChange) {
          options.onFileChange(input.tool_name);
        }

        return { continue: true };
      },
    ],
  },
],
```

**Pros:**
- Directly uses the hook mechanism as intended by the SDK
- File tracking happens synchronously with tool completion
- No reliance on separate user message emission

**Cons:**
- Slightly more complex hook configuration
- Need to handle matcher and general hooks separately

### Option B: Move file tracking entirely into the hook (Simpler)

Consolidate all file tracking into a single hook:

```typescript
PostToolUse: [
  {
    hooks: [
      async (hookInput: unknown) => {
        const input = hookInput as PostToolUseHookInput;

        // Mark tool as complete in state
        const toolResponse = typeof input.tool_response === "string"
          ? input.tool_response
          : JSON.stringify(input.tool_response);

        await markToolComplete(input.tool_use_id, toolResponse, false);
        relayEventsFromToolOutput(toolResponse);

        // Track file changes for file-modifying tools
        const FILE_MODIFYING_TOOLS = ["Edit", "Write", "NotebookEdit"];
        if (FILE_MODIFYING_TOOLS.includes(input.tool_name)) {
          const toolInput = input.tool_input as { file_path?: string; notebook_path?: string };
          const filePath = toolInput.file_path ?? toolInput.notebook_path;

          if (filePath) {
            const operation = input.tool_name === "Write" ? "create" : "modify";
            await updateFileChange({
              path: filePath,
              operation,
              diff: "",
            });
            logger.info(`[PostToolUse] Recorded file change: ${operation} ${filePath}`);
          }
        }

        if (options.onFileChange) {
          options.onFileChange(input.tool_name);
        }

        return { continue: true };
      },
    ],
  },
],
```

**Pros:**
- Simpler, all in one place
- No duplicate code paths

**Cons:**
- File tracking check runs for all tools (minor overhead)

### Option C: Remove MessageHandler file tracking (Cleanup)

Since the `PostToolUse` hook is the authoritative source for tool completion, we can remove the duplicate handling in `MessageHandler.handleUser`:
- Remove the `pendingFileOps` Map tracking
- Remove the `updateFileChange` call from `handleUser`

This cleanup should happen regardless of which fix option is chosen.

## Recommended Implementation

1. **Implement Option B** - Move file tracking to the `PostToolUse` hook
2. **Remove duplicate handling** from `MessageHandler`:
   - Remove `pendingFileOps` Map
   - Remove `FILE_MODIFYING_TOOLS` constant
   - Remove `updateFileChange` call from `handleUser`
   - Keep `markToolComplete` call in `handleUser` for safety (in case user messages are emitted without hooks)

## Files to Modify

1. `agents/src/runners/shared.ts` - Add file tracking to `PostToolUse` hook
2. `agents/src/runners/message-handler.ts` - Remove redundant file tracking
3. `agents/src/runners/message-handler.test.ts` - Update tests
4. `agents/src/runners/message-handler.integration.test.ts` - Verify file tracking works through hooks

## Testing Plan

1. Run existing tests to ensure no regressions
2. Create a simple agent that edits a file and verify `fileChanges` is populated
3. Test Write tool creates with operation "create"
4. Test Edit tool edits with operation "modify"
5. Test NotebookEdit with notebook_path extraction
