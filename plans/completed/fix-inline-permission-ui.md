# Fix Inline Permission UI Not Rendering

After implementing the approve-mode-improvements plan, the permission approval UI doesn't appear at all. The old pinned UI was removed from `thread-input-section.tsx` but the new inline UI in `ToolUseBlock` isn't rendering. Simultaneously, errors appear: `Failed to send to agent <uuid>: Agent not connected`.

## Phases

- [x] Spike: Validate permission flow end-to-end via AgentTestHarness
- [x] Fix issues identified by spike
- [ ] Verify end-to-end flow works in the app

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Spike Results (COMPLETED)

### Spike Summary

All 3 tests pass. The **entire agent-side permission flow works correctly**. The problem is **purely frontend** (Hypothesis B confirmed).

### Answers to Key Questions

| # | Question | Answer |
|---|----------|--------|
| Q1 | Does `permission:request` get emitted? | **YES** — Event arrives at MockHubServer with correct shape: `requestId`, `threadId`, `toolName` ("Write"), `toolInput` (file_path + content), `toolUseId`, `timestamp` |
| Q2 | Does the agent stay connected while waiting? | **YES** — Agent socket remains open for the full wait period. Verified at 1s, 2s, 3s, 4s, 5s — all `isConnected(threadId) === true` |
| Q3 | Does `sendPermissionResponse` unblock the agent? | **YES** — After sending approval, the agent immediately proceeds and completes. The `decision: "approve"` vocabulary fix in MockHubServer was the only issue. |
| Q4 | Does the tool execute after approval? | **YES** — File `test-output.txt` is created in the repo with correct content. Agent exits with code 0. |
| Q5 | Does denial work? | **YES** — After denial, file is NOT created. Agent handles denial gracefully (exits code 0, no crash). |

### Event Shape (from actual test output)

```json
{
  "type": "event",
  "name": "permission:request",
  "payload": {
    "requestId": "b762fc97-...",
    "threadId": "642ad07d-...",
    "toolName": "Write",
    "toolInput": {
      "file_path": "/var/.../test-output.txt",
      "content": "hello world"
    },
    "toolUseId": "toolu_013K23cdxWJURDzK6uYFejDm",
    "timestamp": 1772096286776
  }
}
```

### Infrastructure Changes Made

1. **`MockHubServer.sendPermissionResponse()`** — Fixed `"allow"` → `"approve"` to match Tauri→agent contract
2. **`AgentTestHarness`** — Added `getMockHub(): MockHubServer | null` accessor for reactive test flows

### Test Performance

- Approval flow: ~9s
- Denial flow: ~7.5s
- Delayed approval (5s wait): ~13.5s
- Total suite: ~30.5s

### Key Conclusion

**The agent-side flow is 100% working.** The bug is entirely in the frontend:
- The agent emits `permission:request` with all required data including `toolUseId`
- The agent stays connected and responsive throughout the wait
- Approval unblocks the tool, denial blocks it gracefully
- The "Agent not connected" error is **NOT** from the permission flow itself — it must be a separate issue (possibly from a different message type or a timing issue in the frontend's socket management)

### Test File

`agents/src/experimental/__tests__/permission-gate.integration.test.ts`

---

## Phase 2: Fix Frontend Issues (COMPLETED)

### Root Cause

The event flow was actually working correctly end-to-end:
- Agent emits `permission:request` with `toolUseId` ✅
- `routeAgentEvent()` routes to eventBus ✅
- Permission listener validates via `PermissionRequestSchema` (which includes optional `toolUseId`) and adds to store ✅
- `getRequestByToolUseId()` in the store works correctly ✅

**The real problem**: `ToolUseBlock` has permission awareness (queries store, renders `InlinePermissionApproval`), but **specialized tool blocks** (`WriteToolBlock`, `EditToolBlock`, `BashToolBlock`, `NotebookEditToolBlock`) render **instead** of `ToolUseBlock` for those tools. The specialized blocks have zero permission awareness — they don't import `usePermissionStore` or render any approval UI.

Since `Write` and `Edit` are the primary tools that trigger `"ask"` decisions in approve mode, the permission UI was never visible.

### Fix Applied

Created `ToolPermissionWrapper` — a wrapper component that adds permission awareness to **any** tool block (specialized or generic):

1. **`src/components/thread/tool-permission-wrapper.tsx`** (NEW) — Wraps any tool block. When a pending permission request exists for the tool use ID, it renders the child block inside an amber-bordered container with an "Awaiting approval" badge and the `InlinePermissionApproval` component below it. When no permission is pending, it's a transparent passthrough (`<>{children}</>`).

2. **`src/components/thread/assistant-message.tsx`** (MODIFIED) — Wraps all specialized tool blocks with `<ToolPermissionWrapper>`, so permission UI works for Write, Edit, Bash, and all other registered tool blocks.

3. **`src/lib/agent-service.ts`** (MODIFIED) — Added `toolUseId?: string` to the TypeScript type cast in `routeAgentEvent()` for `PERMISSION_REQUEST`, matching the actual event payload shape.

---

## Phase 3: Verify End-to-End Flow in App

Manual verification after fixes are applied:
1. Switch to approve mode
2. Give agent a task that requires file editing
3. Verify inline permission UI appears in ToolUseBlock
4. Click approve → tool executes
5. Click deny → tool is blocked, agent continues

---

## Reference: Key Files

| Component | File | Notes |
|-----------|------|-------|
| Agent harness | `agents/src/testing/agent-harness.ts` | `getMockHub()` accessor added |
| MockHubServer | `agents/src/testing/mock-hub-server.ts` | Fixed `"allow"` → `"approve"` |
| Permission gate | `agents/src/lib/permission-gate.ts` | Agent-side blocking gate — **WORKING** |
| Permission hook | `agents/src/runners/shared.ts:550-716` | PreToolUse hook with evaluator+gate — **WORKING** |
| Permission evaluator | `agents/src/lib/permission-evaluator.ts` | Rule-based decision engine — **WORKING** |
| Runner message handler | `agents/src/runner.ts:197-201` | Resolves gate on `permission_response` — **WORKING** |
| Hub socket types | `agents/src/lib/hub/types.ts:55` | `TauriToAgentMessage` type |
| Runner config | `agents/src/testing/runner-config.ts` | `buildArgs` for CLI args |
| Spike test | `agents/src/experimental/__tests__/permission-gate.integration.test.ts` | All 3 tests pass |
