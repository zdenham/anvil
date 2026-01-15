# Plan: Improve Spotlight Task Creation Snappiness

## Problem

After creating a task via spotlight, there is noticeable latency (500ms - 4s+) before the conversation UI appears. The goal is to make the conversation window feel instant, even if background work is still completing.

## Current Flow Analysis

```
Spotlight submit (0ms)
  → taskService.create (20-50ms)
  → workspace allocation lock (0-100ms wait)
    → syncWithDisk (5-10ms)
    → releaseStaleWorkspaces (50-200ms PER WORKTREE) ← BOTTLENECK
    → initialize branch (50-300ms)
    → create/claim worktree (0-2000ms if new) ← BOTTLENECK
    → checkout branch (100-300ms)
  → prepareAgent (50-200ms)
  → openConversation Tauri command (10-50ms)
  → conversation window receives "open-conversation" event
    → setupIncomingBridge (50-100ms)
    → conversationService.hydrate (100-500ms) ← BOTTLENECK
    → emit "conversation-ready"
  → WAIT for "conversation-ready" (up to 2s timeout)
  → spawn agent
  → hide spotlight

UI FIRST APPEARS: 500ms - 4s+ depending on workspace state
```

### Key Bottlenecks

| Component | Location | Latency | Issue |
|-----------|----------|---------|-------|
| Stale workspace checks | `workspace-service.ts:189-206` | 50-200ms per worktree | Sequential Tauri calls |
| Git worktree creation | `workspace-service.ts:330` | 500ms-2s | Only when pool exhausted |
| Conversation hydration | `conversations/service.ts:22-36` | 100-500ms | Loads ALL conversations on every open |
| Bridge listener setup | `event-bridge.ts:46-74` | 50-100ms | 14 sequential listen() calls |
| Ready signal wait | `spotlight.tsx:283-313` | Blocks until above complete | Window hidden until ready |

## Proposed Solution

### Core Principle
**Show the conversation window immediately with optimistic UI, then populate asynchronously.**

### Target Flow

```
Spotlight submit (0ms)
  → Open conversation window IMMEDIATELY with loading state + prompt text
  → Hide spotlight
  → [Background: Task + Workspace + Agent prep]
  → [Background: Bridge setup + Load specific conversation]
  → Update UI when ready, spawn agent

UI APPEARS: <100ms (optimistic)
FULLY READY: 500ms-2s (background)
```

---

## Implementation Steps

### Step 1: Open Window Immediately (Highest Impact)

**Goal:** Show conversation window before any async work completes.

**Files to modify:**
- `src/components/spotlight/spotlight.tsx:279-313`

**Changes:**
1. Call `openConversation()` immediately after form validation, before task creation
2. Pass the prompt text in the open event so window can display it immediately
3. Don't await "conversation-ready" before hiding spotlight
4. Move task creation, workspace allocation, and agent spawn to after window opens

**Current code (spotlight.tsx:305-317):**
```typescript
await openConversation(prepared.conversation.id);
await readyPromise;
await prepared.spawn();
```

**New approach:**
```typescript
// Open window immediately with prompt (before task even created)
await openConversationOptimistic({ prompt: query, repoName: selectedRepo });
hideSpotlight();

// Now do all the slow work
const task = await taskService.create({ ... });
const workspaceInfo = await workspaceService.allocateWorkspace(...);
const prepared = await prepareAgent({ ... });

// Update conversation window with real data
await updateConversation(prepared.conversation.id);
await prepared.spawn();
```

---

### Step 2: Skip Full Hydration on Open

**Goal:** Don't load all conversations from disk when opening one conversation.

**Files to modify:**
- `src/conversation-main.tsx:51`
- `src/entities/conversations/service.ts` (add `loadOne` method)

**Current code (conversation-main.tsx:51):**
```typescript
listen<OpenConversationPayload>("open-conversation", async (event) => {
  await conversationService.hydrate(); // Loads ALL conversations
  setConversationId(event.payload.conversationId);
  ...
});
```

**New approach:**
```typescript
listen<OpenConversationPayload>("open-conversation", async (event) => {
  // Only load the specific conversation we need
  await conversationService.ensureLoaded(event.payload.conversationId);
  setConversationId(event.payload.conversationId);
  ...
});
```

**New method in service.ts:**
```typescript
async ensureLoaded(conversationId: string): Promise<Conversation | null> {
  // Check if already in store
  const existing = useConversationStore.getState().conversations.get(conversationId);
  if (existing) return existing;

  // Load just this one from disk
  const conversation = await persistence.readJson(`conversations/${conversationId}.json`);
  if (conversation) {
    useConversationStore.getState()._applyCreate(conversation);
  }
  return conversation;
}
```

**Savings:** 100-500ms

---

### Step 3: Parallelize Stale Workspace Checks

**Goal:** Check all worktree claims concurrently instead of sequentially.

**File to modify:**
- `src/lib/workspace-service.ts:189-206`

**Current code:**
```typescript
async releaseStaleWorkspaces(repoName: string): Promise<number> {
  const settings = await loadSettings(repoName);
  let released = 0;

  for (const worktree of settings.worktrees) {
    if (worktree.claim && (await isClaimStale(worktree.claim))) {
      worktree.claim = null;
      released++;
    }
  }
  // ...
}
```

**New approach:**
```typescript
async releaseStaleWorkspaces(repoName: string): Promise<number> {
  const settings = await loadSettings(repoName);

  // Check all claims in parallel
  const staleChecks = await Promise.all(
    settings.worktrees.map(async (worktree) => ({
      worktree,
      isStale: worktree.claim ? await isClaimStale(worktree.claim) : false,
    }))
  );

  let released = 0;
  for (const { worktree, isStale } of staleChecks) {
    if (isStale) {
      worktree.claim = null;
      released++;
    }
  }
  // ...
}
```

**Savings:** With 3 worktrees at 100ms each: 300ms → 100ms

---

### Step 4: Parallelize Bridge Listener Setup

**Goal:** Register all event listeners concurrently.

**File to modify:**
- `src/lib/event-bridge.ts:46-74`

**Current code:**
```typescript
export async function setupIncomingBridge() {
  await listen("broadcast:task-created", ...);
  await listen("broadcast:task-updated", ...);
  await listen("broadcast:task-deleted", ...);
  // ... 11 more sequential awaits
}
```

**New approach:**
```typescript
export async function setupIncomingBridge() {
  await Promise.all([
    listen("broadcast:task-created", ...),
    listen("broadcast:task-updated", ...),
    listen("broadcast:task-deleted", ...),
    // ... all listeners in parallel
  ]);
}
```

**Savings:** 50-100ms

---

### Step 5: Pass Prompt in Open Event

**Goal:** Display prompt text immediately without waiting for conversation entity to load.

**Files to modify:**
- `src-tauri/src/panels.rs:475-497` - Add prompt to payload
- `src/conversation-main.tsx` - Use prompt from payload for immediate display

**Current payload:**
```rust
app.emit_to(CONVERSATION_LABEL, "open-conversation", json!({
    "conversationId": conversation_id
}))
```

**New payload:**
```rust
app.emit_to(CONVERSATION_LABEL, "open-conversation", json!({
    "conversationId": conversation_id,
    "prompt": prompt,  // Optional, for optimistic display
    "repoName": repo_name
}))
```

**Conversation window can then show:**
- Prompt text immediately (from payload)
- Loading indicator for response
- Full conversation once loaded

---

### Step 6: Optimistic Conversation UI State

**Goal:** Show meaningful UI immediately, not just a blank loading screen.

**File to modify:**
- `src/conversation-main.tsx:74-82`
- Create new component for optimistic loading state

**Optimistic UI should show:**
1. The user's prompt text (passed in event payload)
2. Repository context
3. "Agent starting..." or similar indicator
4. Skeleton/placeholder for where response will appear

---

## Implementation Order

1. **Step 1: Open Window Immediately** - Highest impact, makes everything feel instant
2. **Step 2: Skip Full Hydration** - Easy win, 100-500ms savings
3. **Step 3: Parallelize Stale Checks** - 100-200ms savings
4. **Step 4: Parallelize Bridge Setup** - 50-100ms savings
5. **Step 5: Pass Prompt in Event** - Enables optimistic UI
6. **Step 6: Optimistic UI** - Polish the loading experience

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Time to window visible | 500ms - 4s+ | <100ms |
| Time to show prompt | 500ms - 4s+ | <100ms |
| Time to agent ready | 500ms - 4s+ | 300ms - 2s (unchanged, but async) |
| Perceived latency | High | Near-instant |

## Risks and Mitigations

1. **Race conditions** - Window opens before conversation entity exists
   - Mitigation: Handle "optimistic" state explicitly, update when real data arrives

2. **Error handling** - Task creation might fail after window opens
   - Mitigation: Show error state in conversation window, allow retry

3. **State sync** - Multiple windows might get out of sync
   - Mitigation: Use event bridge to propagate updates

## Files Summary

| File | Changes |
|------|---------|
| `src/components/spotlight/spotlight.tsx` | Reorder flow, open window first |
| `src/conversation-main.tsx` | Handle optimistic state, skip full hydration |
| `src/entities/conversations/service.ts` | Add `ensureLoaded()` method |
| `src/lib/workspace-service.ts` | Parallelize stale checks |
| `src/lib/event-bridge.ts` | Parallelize listener setup |
| `src-tauri/src/panels.rs` | Add prompt to open event payload |
