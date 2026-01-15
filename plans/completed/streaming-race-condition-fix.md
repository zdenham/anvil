# Fix: Cross-Window Event Bridge

## Problem

Events emitted from the spotlight window are not being received by the conversation window. The logs show:

```
[event-bridge] OUTGOING: mitt "agent:state" → Tauri "app:agent:state" (targeting: conversation)
[event-bridge] ✓ Successfully emitted to conversation
```

But there are NO corresponding `[event-bridge] INCOMING:` logs on the conversation side, meaning the Tauri listeners never fire.

## Root Cause

The current implementation uses `emitTo(CONVERSATION_LABEL, ...)` to target a specific window. However, according to Tauri issues [#11561](https://github.com/tauri-apps/tauri/issues/11561) and [#11379](https://github.com/tauri-apps/tauri/issues/11379):

1. `emitTo()` with specific targets has bugs with `AnyLabel` handling
2. The generic `listen()` function doesn't properly filter by target
3. NSPanels may have additional quirks with event delivery

## Solution

**Broadcast events to ALL windows** using `emit()` instead of `emitTo()`. Let each window filter events by conversationId.

This is simpler and more robust:
- No target label coordination needed
- Works regardless of NSPanel quirks
- Each window already filters by conversationId anyway
- Generic event bus pattern - windows subscribe to what they care about

## Implementation

### 1. Update `event-bridge.ts`

Change outgoing bridge to use broadcast `emit()`:

```typescript
export function setupOutgoingBridge(): void {
  for (const eventName of BROADCAST_EVENTS) {
    eventBus.on(eventName, async (payload) => {
      const tauriEventName = `app:${eventName}`;
      // Broadcast to ALL windows - let receivers filter by conversationId
      await emit(tauriEventName, payload);
    });
  }
}
```

### 2. No changes needed to:

- `conversation-main.tsx` - already sets up incoming bridge
- `useStreamingConversation.ts` - already filters by conversationId
- `spotlight.tsx` - emits to local eventBus which bridges to Tauri

## Files Changed

- `src/lib/event-bridge.ts` - use `emit()` instead of `emitTo()`
