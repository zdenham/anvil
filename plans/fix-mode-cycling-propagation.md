# Fix Mode Cycling Propagation to Agent

## Diagnosis

**The bug: mode cycling from the UI never reaches the agent's permission evaluator.**

### Root Cause

The UI sends mode changes using the **event protocol format**, but the agent runner expects the **`TauriToAgentMessage` format**. The message arrives at the agent with `type: "event"` and is silently ignored because no case in the `switch (msg.type)` handles `"event"`.

### Detailed Trace

**What the UI sends** (`thread-content.tsx:214`, `control-panel-window.tsx:285`):

```ts
await sendToAgent(threadId, {
  type: "event",                                  // ← problem
  name: EventName.PERMISSION_MODE_CHANGED,        // "permission:mode-changed"
  payload: { threadId, modeId: nextMode },
});
```

This goes through `sendToAgent()` (`agent-service.ts:201`) which wraps it as:

```json
{
  "senderId": "tauri",
  "threadId": "...",
  "type": "event",
  "name": "permission:mode-changed",
  "payload": { "threadId": "...", "modeId": "plan" }
}
```

The Rust hub (`agent_hub.rs:310`) passes this JSON string directly to the agent's socket writer channel — no transformation.

**What the agent expects** (`runner.ts:185-215`):

```ts
hub.on("message", (msg: TauriToAgentMessage) => {
  switch (msg.type) {
    case "permission_response": ...
    case "permission_mode_changed": ...  // ← expects this type
    case "queued_message": ...
    case "cancel": ...
  }
});
```

The runner expects `msg.type === "permission_mode_changed"` — a direct `TauriToAgentMessage`.

**How the other messages work correctly** (`agent-service.ts:230-242`):

```ts
// permission_response — sends type: "permission_response" directly ✓
await sendToAgent(threadId, { type: "permission_response", payload: { ... } });

// cancel — sends type: "cancel" directly ✓
await sendToAgent(threadId, { type: "cancel" });

// queued_message — sends type: "queued_message" directly ✓
await sendToAgent(threadId, { type: "queued_message", payload: { ... } });
```

All three working message types use the `TauriToAgentMessage` format directly. Only the mode change uses the event protocol format by mistake.

### Why It's Silent

There is no `default` case in the `switch (msg.type)` statement, so unmatched types are silently dropped. The `HubConnection` (`connection.ts:56`) parses all valid JSON as `SocketMessage` and emits it regardless of type — there is no validation.

### Secondary Effect

Even when the mode appears to change (e.g., restarting the agent), the mode persists correctly to disk via `threadService.update()` and gets picked up on the next agent spawn via the `--permission-mode` CLI arg. So mode changes "work" on restart but **not** mid-conversation.

## Phases

- [ ] Fix the `sendToAgent` call in `thread-content.tsx` to use `TauriToAgentMessage` format
- [ ] Fix the identical `sendToAgent` call in `control-panel-window.tsx`
- [ ] Add a `default` warning case to the runner's message switch for future debugging

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Proposed Fix

### Change 1: `src/components/content-pane/thread-content.tsx` (line ~214)

```ts
// Before:
await sendToAgent(threadId, {
  type: "event",
  name: EventName.PERMISSION_MODE_CHANGED,
  payload: { threadId, modeId: nextMode },
});

// After:
await sendToAgent(threadId, {
  type: "permission_mode_changed",
  payload: { modeId: nextMode },
});
```

### Change 2: `src/components/control-panel/control-panel-window.tsx` (line ~285)

Same fix as Change 1.

### Change 3: `agents/src/runner.ts` (after the switch block)

Add a `default` case to log unhandled message types:

```ts
default:
  logger.warn(`[runner] Unhandled message type: ${msg.type}`);
  break;
```

### Files Affected

| File | Change |
|------|--------|
| `src/components/content-pane/thread-content.tsx` | Fix `sendToAgent` call format |
| `src/components/control-panel/control-panel-window.tsx` | Fix `sendToAgent` call format |
| `agents/src/runner.ts` | Add `default` warning in switch |

### Notes

- The `EventName.PERMISSION_MODE_CHANGED` import can be removed from both UI files if it's no longer used elsewhere in those files.
- The `threadId` inside the payload is unnecessary — the agent already knows its own `threadId`. The `TauriToAgentMessage` type only expects `{ modeId: string }`. Removing it keeps the message clean.
- No changes needed to the Rust hub — it's a pass-through and works correctly.
