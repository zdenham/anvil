# Optimistic Thread Loading Fix

## Problem Statement

When creating a new thread, there's a noticeable loading delay before the optimistic user message is displayed, despite the UI intending to show the message immediately.

## Investigation Summary

### Current Flow

1. **Thread Creation (Spotlight)**
   - User submits prompt in Spotlight
   - `spawnSimpleAgent()` is called with `threadId`, `prompt`, and `workingDirectory`
   - Control panel is opened immediately with the prompt via `openControlPanel(threadId, prompt)`

2. **Control Panel Initialization**
   - `useControlPanelParams` hook fetches params (async IPC call to `get_pending_control_panel`)
   - Until params arrive, `LoadingView` is shown with "Loading..." message
   - Once params arrive, `ControlPanelWindowContent` renders

3. **Thread State Loading**
   - `useEffect` in `ControlPanelWindowContent` (line 241-265) calls `threadService.setActiveThread(threadId)`
   - This triggers `loadThreadState(threadId)` which:
     - Sets `activeThreadLoading = true` in Zustand store
     - Attempts to read `state.json` from disk (which doesn't exist for new threads)
     - Sets `activeThreadLoading = false` in finally block

4. **Message Display**
   - `messages` memo (line 294-306) correctly creates optimistic message from `prompt` when no real messages exist
   - `viewStatus` is derived as `"running"` when we have a prompt but no messages
   - `ThreadView` receives `status="running"` and displays the optimistic message

### Root Causes of Delay

**Cause 1: IPC Fetch for Params (Primary Delay)**

Location: `useControlPanelParams` hook (line 92-114)

```typescript
const fetchPendingControlPanel = async () => {
  const raw = await invoke<unknown>("get_pending_control_panel");
  // ... parse and set params
};
fetchPendingControlPanel();
```

Until this async IPC call completes, the control panel shows `LoadingView` with "Loading..." text. This is the **primary source of perceived delay** - the user sees a loading screen instead of their message.

**Cause 2: Thread State Load (Secondary)**

Location: `threadService.loadThreadState` (line 487-579)

Even though new threads don't have `state.json`, the code still:
1. Calls `await findThreadPath(threadId)` - performs disk I/O to locate thread
2. Calls `await this.getStatePath(threadId)` - another disk lookup
3. Calls `await persistence.readJson(statePath)` - attempts to read non-existent file

This adds 50-200ms of I/O overhead before displaying content.

**Cause 3: Thread Metadata Refresh**

Location: `ControlPanelWindowContent` useEffect (line 248-255)

```typescript
const threadExists = !!useThreadStore.getState().threads[threadId];
if (!threadExists) {
  await threadService.refreshById(threadId);
}
```

For new threads created moments ago, the metadata may not be in the store yet, triggering an additional disk read.

### What's NOT the Problem

The `ThreadView` component's `status === "loading"` check (line 52-54) is **not** being triggered. The `viewStatus` derivation (line 274-281) never produces `"loading"` status:

```typescript
const viewStatus: ViewStatus =
  prompt && !activeState?.messages?.length
    ? "running"  // <-- Optimistic case goes here
    : entityStatus === "paused" ? "idle"
    : entityStatus === "cancelled" ? "cancelled"
    : entityStatus;
```

The `isLoadingThreadState` flag from the store is fetched but only used in `ChangesTab`, not in the thread view path.

## Proposed Fix

### Option A: Pass Prompt to Control Panel via URL Params (Recommended)

**Change**: Include the prompt in URL params when opening the control panel, eliminating the need to fetch it via IPC.

**Files to modify:**
- `src/lib/panel-navigation.ts` or wherever `openControlPanel` is implemented
- `src/components/control-panel/use-control-panel-params.ts`

**Implementation:**

1. When opening control panel, include prompt in URL:
   ```typescript
   const url = `/control-panel?view=thread&threadId=${threadId}&prompt=${encodeURIComponent(prompt)}`;
   ```

2. In `useControlPanelParams`, parse prompt from URL immediately:
   ```typescript
   function parseUrlParams(): { view: ControlPanelViewType | null; instanceId: string | null; prompt: string | undefined } {
     const searchParams = new URLSearchParams(window.location.search);
     const prompt = searchParams.get("prompt") ?? undefined;
     // ... existing logic
     return { view, instanceId, prompt };
   }
   ```

3. Set params synchronously when URL contains all needed data:
   ```typescript
   const { view: urlView, instanceId, prompt } = parseUrlParams();
   if (urlView && (urlView.type !== "thread" || prompt !== undefined)) {
     // Set params immediately - no async needed
     setParams({ view: urlView, prompt, ... });
     return; // Skip IPC fetch entirely
   }
   ```

**Pros:**
- Eliminates the primary IPC delay entirely
- Params available synchronously on mount
- No loading screen needed for new threads

**Cons:**
- URL becomes longer (prompt in query string)
- Need to handle URL encoding properly

### Option B: Skip State Load for New Threads

**Change**: When the thread was just created (within last few seconds), skip the state loading entirely since there's nothing to load.

**Files to modify:**
- `src/entities/threads/service.ts`

**Implementation:**

```typescript
async loadThreadState(threadId: string): Promise<void> {
  const store = useThreadStore.getState();
  const metadata = this.get(threadId);

  // Skip state load for very new threads (created within last 5 seconds)
  // They won't have state.json yet, so no point in trying to read it
  if (metadata && Date.now() - metadata.createdAt < 5000) {
    logger.info(`[threadService.loadThreadState] Skipping load for new thread ${threadId}`);
    return;
  }

  // ... existing logic
}
```

**Pros:**
- Eliminates unnecessary disk I/O for new threads
- Simple change with minimal risk

**Cons:**
- Doesn't address the primary IPC delay
- Edge case: if thread somehow has state written within 5 seconds, it won't load

### Option C: Initialize with Optimistic State Immediately

**Change**: When `prompt` is available, immediately set params without waiting for IPC, then update if IPC returns different data.

**Files to modify:**
- `src/components/control-panel/use-control-panel-params.ts`

**Implementation:**

```typescript
export function useControlPanelParams(_windowConfig?: WindowConfig): ControlPanelParams | null {
  // Check if we have prompt in event bus cache or some other immediate source
  const cachedPayload = eventBus.getLastPayload?.("open-control-panel");

  const [params, setParams] = useState<ControlPanelParams | null>(() => {
    // Initialize immediately if we have cached data
    if (cachedPayload?.threadId && cachedPayload?.prompt) {
      return {
        view: { type: "thread", threadId: cachedPayload.threadId },
        prompt: cachedPayload.prompt,
        // ...
      };
    }
    return null;
  });
  // ...
}
```

This requires the event bus to cache the last payload, which may not be implemented.

## Recommended Approach

**Implement Option A + Option B together:**

1. **Option A** eliminates the primary delay by passing prompt in URL params
2. **Option B** eliminates secondary delays for new threads by skipping unnecessary state loads

### Implementation Plan

1. **Modify URL params handling** in `use-control-panel-params.ts`:
   - Parse `prompt` from URL search params
   - Set initial state synchronously when prompt is available

2. **Update panel opening logic** to include prompt in URL:
   - Find where `openControlPanel` or equivalent is called
   - Include prompt as URL parameter

3. **Add early return in `loadThreadState`** for new threads:
   - Check `createdAt` timestamp
   - Skip disk I/O if thread is less than 5 seconds old

4. **Test the flow**:
   - Create new thread from Spotlight
   - Verify optimistic message appears immediately (< 50ms)
   - Verify real messages load correctly when they arrive

## Files to Modify

1. `src/components/control-panel/use-control-panel-params.ts` - Parse prompt from URL
2. `src/lib/panel-navigation.ts` (or similar) - Include prompt in URL when opening panel
3. `src/entities/threads/service.ts` - Skip state load for new threads
4. Rust backend (if needed) - May need to pass prompt through to URL

## Expected Outcome

After implementing these changes:
- User submits prompt in Spotlight
- Control panel opens immediately showing the user's message
- No loading screen visible
- Real agent responses stream in as they arrive
