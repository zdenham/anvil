# Fix Worktree Sync & PR Detection Event Routing

## Problem

When an agent runs `git worktree add` via Bash, the `worktree:synced` event is emitted correctly by the agent (confirmed in event log, seq 23), but the frontend never syncs the worktree.

**Root cause**: `routeAgentEvent()` in `src/lib/agent-service.ts:219-280` has a switch statement that routes named events from the agent hub to the frontend `eventBus`. Neither `WORKTREE_SYNCED` nor `PR_DETECTED` are listed in the switch cases. They fall through to the `default` case (line 274-278), which wraps the payload differently:

```typescript
// Default wraps payload: { threadId, payload: { repoId: "..." } }
eventBus.emit(eventName, { threadId, payload });
```

But the listener at `src/entities/worktrees/listeners.ts:25` destructures `{ repoId }` directly:

```typescript
eventBus.on(EventName.WORKTREE_SYNCED, async ({ repoId }) => { ... });
```

So `repoId` is `undefined`, the `getRepoName(undefined)` call returns `"Unknown"`, and the listener bails out at the guard clause without syncing.

The same issue affects `PR_DETECTED` — it also falls through to the default case.

## Phases

- [x] Add `WORKTREE_SYNCED` and `PR_DETECTED` to the explicit switch cases in `routeAgentEvent()`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

In `src/lib/agent-service.ts`, add `EventName.WORKTREE_SYNCED` and `EventName.PR_DETECTED` to the existing group of pass-through event names at lines 246-259:

```typescript
case EventName.THREAD_CREATED:
case EventName.THREAD_UPDATED:
case EventName.THREAD_STATUS_CHANGED:
case EventName.WORKTREE_ALLOCATED:
case EventName.WORKTREE_RELEASED:
case EventName.WORKTREE_NAME_GENERATED:
case EventName.WORKTREE_SYNCED:          // ← add
case EventName.PR_DETECTED:              // ← add
case EventName.ACTION_REQUESTED:
case EventName.AGENT_CANCELLED:
case EventName.AGENT_COMPLETED:
case EventName.THREAD_NAME_GENERATED:
case EventName.PLAN_DETECTED:
case EventName.COMMENT_ADDED:
case EventName.COMMENT_UPDATED:
case EventName.COMMENT_RESOLVED:
case EventName.COMMENT_DELETED:
  eventBus.emit(eventName, payload);
  break;
```

This ensures the raw payload `{ repoId }` is emitted directly to the eventBus, matching what the listener destructures.

## Files to Modify

| File | Change |
| --- | --- |
| `src/lib/agent-service.ts` | Add `WORKTREE_SYNCED` and `PR_DETECTED` to pass-through cases in `routeAgentEvent()` |

## Risk

Minimal — this is a two-line addition to an existing fall-through case group. No signature changes, no new behavior, just routing events that were already being emitted but mis-wrapped.
