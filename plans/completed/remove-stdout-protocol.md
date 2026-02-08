# Remove stdout Protocol from Agents

Complete removal of stdout-based communication in favor of socket-only IPC.

## Phases

- [x] Remove stdout fallbacks from event emission
- [x] Remove subagent_result stdout emission
- [x] Remove child thread state stdout emission
- [x] Update logger to be socket-only or file-based
- [x] Clean up test mocks and harness code
- [x] Remove stdout function and update imports

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Background

The codebase has partially migrated from stdout JSON-line protocol to socket-based IPC. However, several stdout usages remain:

**Primary usages (not fallbacks):**
- `output.ts:309-312` - Emits `subagent_result` marker for bash-based sub-agents
- `message-handler.ts:342` - Emits child thread state via stdout
- `logger.ts:21` - All logging routes through stdout

**Fallback usages (socket check → stdout):**
- `events.ts:28-35` - Event emission falls back to stdout when hub not connected
- `shared.ts:102-105` - Event emission uses direct `console.log` fallback

## Phase 1: Remove stdout Fallbacks from Event Emission

### Files to modify:

**`agents/src/lib/events.ts`**
- Remove lines 28-35 (stdout fallback in `emitEvent`)
- Keep only the socket path - if hub not connected, log warning and skip
- Remove `stdout` import from line 13

**`agents/src/runners/shared.ts`**
- Remove lines 102-105 (console.log fallback in `emitEvent`)
- Keep only the socket path - if hub not connected, log warning and skip

## Phase 2: Remove subagent_result stdout Emission

**`agents/src/output.ts`**
- Remove lines 306-313 (subagent_result emission in `complete()`)
- This marker was for bash-based sub-agent consumption
- Sub-agents should read final result from `state.json` file instead (disk-as-truth)

## Phase 3: Remove Child Thread State stdout Emission

**`agents/src/runners/message-handler.ts`**
- Remove line 342: `stdout({ type: "state", state, threadId: childThreadId });`
- Child thread state is already written to disk via `emitState()`
- Remove `stdout` import from line 16

## Phase 4: Update Logger to Use Socket

**`agents/src/lib/logger.ts`**
- Remove the `stdout` function (lines 9-14)
- Update `log()` function to send logs via hub socket
- Add hub client dependency (import `getHubClient` from output.ts)
- If hub not connected, silently drop logs (or optionally keep console.log as last resort for debugging)

```typescript
import { getHubClient } from "../output.js";

function log(level: string, message: string): void {
  const hub = getHubClient();
  if (hub?.isConnected) {
    hub.sendLog(level, message);
  }
  // Optionally keep console.log for local debugging when hub not connected
}
```

**Requires adding `sendLog` to HubClient** (`agents/src/lib/hub/client.ts`):
```typescript
sendLog(level: string, message: string): void {
  this.send({ type: "log", level, message });
}
```

**Requires adding "log" to SocketMessage types** (`agents/src/lib/hub/types.ts`).

## Phase 5: Clean Up Test Mocks and Harness

**Test files with stdout mocks to update:**

| File | Lines | Action |
|------|-------|--------|
| `output.test.ts` | 34-35, 76-112 | Remove stdout mock, update "disk before emit" test to check socket |
| `message-handler.test.ts` | 29 | Remove stdout mock |
| `thread-history.test.ts` | 45 | Remove stdout mock |
| `thread-history-live.test.ts` | 121 | Remove stdout mock |
| `shared.integration.test.ts` | 61 | Remove stdout mock |

**Agent harness (`agents/src/testing/agent-harness.ts`):**
- Lines 215-219: Remove stdout parsing comment and dead code for socket mode
- Lines 265-340: Remove or deprecate legacy stdin/stdout mode entirely
- Lines 368-401: Simplify `parseOutputLine` - only handle debug log output

## Phase 6: Remove stdout Function and Update Imports

**`agents/src/lib/logger.ts`**
- Remove `export function stdout()` entirely
- Keep `logger` object with info/warn/debug/error methods using console.log directly

**Update imports in:**
- `agents/src/output.ts` - Remove `stdout` from import
- `agents/src/lib/events.ts` - Remove `stdout` import entirely
- `agents/src/runners/message-handler.ts` - Remove `stdout` from import

## Files Summary

### Files to modify:
1. `agents/src/lib/hub/client.ts` - Add sendLog method
2. `agents/src/lib/hub/types.ts` - Add "log" message type
3. `agents/src/lib/logger.ts` - Remove stdout function, use socket for logs
4. `agents/src/lib/events.ts` - Remove fallback, remove import
5. `agents/src/output.ts` - Remove subagent_result emission, update import
6. `agents/src/runners/shared.ts` - Remove fallback
7. `agents/src/runners/message-handler.ts` - Remove child state emission, update import
8. `agents/src/testing/agent-harness.ts` - Clean up stdout parsing
9. `agents/src/output.test.ts` - Update disk-as-truth test
10. `agents/src/runners/message-handler.test.ts` - Remove mock
11. `agents/src/runners/thread-history.test.ts` - Remove mock
12. `agents/src/runners/thread-history-live.test.ts` - Remove mock
13. `agents/src/runners/shared.integration.test.ts` - Remove mock

### Comments to update:
- `agents/src/runner.ts:146` - Remove "stdout fallback" mention
- `agents/src/output.ts:101-103` - Already says removed, verify accurate
- `agents/src/output.ts:372-373` - Already says removed, verify accurate

## Testing

After changes:
1. Run `pnpm test` in agents directory
2. Verify agent can start and communicate via socket
3. Test sub-agent execution reads results from state.json
4. Verify logs still appear in console for debugging
