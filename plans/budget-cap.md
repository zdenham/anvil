# Budget Cap for mort-repl

## Summary

Add a `budgetCapUsd` field to thread metadata and enforce it in the mort-repl spawn path. Before spawning a child agent, walk up the ancestor chain (via `parentThreadId`) and check whether any ancestor with a `budgetCapUsd` has already exceeded its budget — computed by summing `totalCostUsd` across that ancestor's descendant tree. If over budget, refuse to spawn.

## Context

### What exists today

- **Thread metadata** (`~/.mort/threads/{id}/metadata.json`) already stores `parentThreadId`, `cumulativeUsage`, and per-turn `costUsd`.
- `ResultMetrics` (`core/types/events.ts:379`) includes `totalCostUsd` — written to `state.json` on agent completion via the `COMPLETE` reducer action.
- `child-spawner.ts` is the sole spawn path for mort-repl child agents. It creates metadata on disk, emits events, then spawns a runner subprocess.
- `mort-sdk.ts` exposes `mort.spawn()` which delegates to `ChildSpawner.spawn()`.

### Cost tracking gap

`totalCostUsd` is available in `state.json` under `metrics.totalCostUsd` after a thread completes (written by `complete()` in `output.ts` via the `MessageHandler` result handler). Each child runner process writes its own `state.json`, so completed children have accurate USD cost.

**However**, there are two gaps:

1. **Running threads** have no `totalCostUsd` on disk yet — only `cumulativeUsage` (token counts) in both `state.json` and `metadata.json`. Converting tokens to USD requires pricing knowledge we don't currently embed.
2. **mort-repl children never propagate cost to metadata**. The `ChildSpawner.waitForResult()` reads the last assistant message but ignores `metrics.totalCostUsd`. Compare with the SDK Task tool path (`shared.ts:1277`) which emits `costUsd` in the `AGENT_COMPLETED` event.

**Decision**:

- For **completed** threads: read `metadata.json → totalCostUsd` (propagated from `state.json` after completion — see Phase 2).
- For **running** threads: fall back to `0`. The budget check is conservative — it only counts cost from threads that have completed. This is acceptable as a soft cap since most cost comes from completed child agents.
- **New in this plan**: After `waitForResult()` completes, read the child's `state.json → metrics.totalCostUsd` and write it to the child's `metadata.json` as `totalCostUsd`. This makes cost data available via lightweight metadata reads during budget checks.

## Phases

- [ ] Add `budgetCapUsd` and `totalCostUsd` to thread metadata schema
- [ ] Propagate child cost to metadata after mort-repl child completion
- [ ] Implement `isOverBudget` utility that walks the ancestor graph
- [ ] Integrate budget check into `ChildSpawner.spawn()`
- [ ] Add `budgetCapUsd` to spawn options and `mort` SDK
- [ ] Write tests for budget enforcement logic

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `budgetCapUsd` and `totalCostUsd` to thread metadata

**File**: `core/types/threads.ts`

Add to `ThreadMetadataBaseSchema`:

```ts
budgetCapUsd: z.number().positive().optional(),
totalCostUsd: z.number().optional(),
```

- `budgetCapUsd` — only threads that are budget roots will have it set. Descendants inherit via ancestor walk.
- `totalCostUsd` — written to metadata after a thread completes. Mirrors `state.json → metrics.totalCostUsd` for cheap reads.

## Phase 2: Propagate child cost to metadata

**File**: `agents/src/lib/mort-repl/child-spawner.ts`

Currently `waitForResult()` reads `state.json` only for the last assistant message. After the child exits, also read `metrics.totalCostUsd` from the child's `state.json` and write it to the child's `metadata.json`:

```ts
// In waitForResult(), after reading resultText:
const childCostUsd = this.readChildCost(childThreadPath);
if (childCostUsd !== undefined) {
  this.writeCostToMetadata(childThreadPath, childCostUsd);
}
```

New private methods:

```ts
private readChildCost(childThreadPath: string): number | undefined {
  const statePath = join(childThreadPath, "state.json");
  if (!existsSync(statePath)) return undefined;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    return state.metrics?.totalCostUsd;
  } catch { return undefined; }
}

private writeCostToMetadata(childThreadPath: string, costUsd: number): void {
  const metadataPath = join(childThreadPath, "metadata.json");
  if (!existsSync(metadataPath)) return;
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    metadata.totalCostUsd = costUsd;
    metadata.updatedAt = Date.now();
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  } catch (err) {
    logger.warn(`[mort-repl] Failed to write cost to metadata: ${err}`);
  }
}
```

This ensures that after any mort-repl child completes, its `metadata.json` has `totalCostUsd` — making budget calculations cheap (metadata-only reads).

Also emit `costUsd` in the existing `AGENT_COMPLETED` event (currently missing from the mort-repl path):

```ts
this.emitEvent(EventName.AGENT_COMPLETED, {
  threadId: childThreadId,
  exitCode,
  costUsd: childCostUsd,  // NEW
}, "mort-repl:child-complete");
```

## Phase 3: Implement `isOverBudget`

**New file**: `agents/src/lib/mort-repl/budget.ts` (~100 lines)

```ts
export interface BudgetCheckResult {
  overBudget: boolean;
  /** The ancestor thread ID that owns the budget cap */
  budgetThreadId?: string;
  /** The cap in USD */
  capUsd?: number;
  /** Total spent by the budget thread's entire descendant tree */
  spentUsd?: number;
}

export function isOverBudget(
  threadId: string,
  mortDir: string,
): BudgetCheckResult
```

### Algorithm

1. **Walk up ancestors**: Starting from `threadId`, follow `parentThreadId` links in each `metadata.json` until we find a thread with `budgetCapUsd` set (or reach the root with no budget).
2. **If no ancestor has a budget**: Return `{ overBudget: false }`.
3. **If ancestor has budget**: Collect the total cost for that ancestor's subtree:
   - Scan all `~/.mort/threads/*/metadata.json` once to build a `parentThreadId → childIds[]` map.
   - BFS/DFS from the budget ancestor to collect all descendant thread IDs.
   - For each thread in the subtree (including the budget ancestor itself): read `metadata.json → totalCostUsd` (set by Phase 2 for mort-repl children, or `0` if still running).
   - Sum all costs.
4. **Compare**: If `spentUsd >= capUsd`, return `{ overBudget: true, budgetThreadId, capUsd, spentUsd }`.

### Cost source for each thread

For budget checks, read **only** from `metadata.json`:

1. `metadata.json → totalCostUsd` (written by Phase 2 after completion)
2. Fall back to `0` if not present (thread still running or just started)

We avoid reading `state.json` during budget checks to keep them fast. The tradeoff is that in-flight thread costs aren't counted, but this is acceptable for a soft cap.

This is O(n) in total threads, but `n` is small (hundreds at most on disk). Keep it simple — no caching.

**Important**: `totalCostUsd` represents a single thread's own API cost (not its children). So we must sum across the whole tree — the budget thread + all its descendants.

## Phase 4: Integrate into `ChildSpawner.spawn()`

**File**: `agents/src/lib/mort-repl/child-spawner.ts`

At the top of `spawn()`, before creating the child thread on disk:

```ts
async spawn(options: SpawnOptions): Promise<string> {
  // Budget gate: check if any ancestor is over budget
  const budgetCheck = isOverBudget(this.context.threadId, this.context.mortDir);
  if (budgetCheck.overBudget) {
    throw new Error(
      `Budget exceeded: ancestor thread ${budgetCheck.budgetThreadId} ` +
      `has spent $${budgetCheck.spentUsd?.toFixed(2)} of ` +
      `$${budgetCheck.capUsd?.toFixed(2)} budget cap`
    );
  }

  const childThreadId = crypto.randomUUID();
  // ... rest unchanged
}
```

The thrown error propagates to the mort-repl script as a `mort.spawn()` rejection, which surfaces in the `ReplResult.error` field. No special handling needed — the existing error path already captures this.

## Phase 5: Add `budgetCapUsd` to spawn options and `mort` SDK

### 5a. `mort.spawn()` options

**File**: `agents/src/lib/mort-repl/types.ts`

Add to `SpawnOptions`:

```ts
budgetCapUsd?: number;
```

**File**: `agents/src/lib/mort-repl/mort-sdk.ts`

Update `spawn()` to pass through:

```ts
async spawn(options: {
  prompt: string;
  contextShortCircuit?: ContextShortCircuit;
  budgetCapUsd?: number;
}): Promise<string> {
  if (!options?.prompt) throw new Error("mort.spawn() requires a prompt");
  return this.spawner.spawn({
    prompt: options.prompt,
    contextShortCircuit: options.contextShortCircuit,
    budgetCapUsd: options.budgetCapUsd,
  });
}
```

### 5b. Write `budgetCapUsd` to child metadata

**File**: `agents/src/lib/mort-repl/child-spawner.ts`

In `createThreadOnDisk()`, if `options.budgetCapUsd` is set, write it to the child's `metadata.json`:

```ts
const childMetadata = {
  // ... existing fields
  ...(options.budgetCapUsd ? { budgetCapUsd: options.budgetCapUsd } : {}),
};
```

This makes the child thread a new budget root. Its descendants will find this cap when walking up the ancestor chain.

### 5c. `mort.setBudgetCap()` for self-budgeting

Allow the orchestrating agent to set a budget for its own thread:

```ts
mort.setBudgetCap(5.00); // $5 cap for this thread's subtree
```

**File**: `agents/src/lib/mort-repl/mort-sdk.ts` — add method:

```ts
async setBudgetCap(usd: number): Promise<void> {
  const metadataPath = join(this._context.mortDir, "threads", this._context.threadId, "metadata.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
  metadata.budgetCapUsd = usd;
  metadata.updatedAt = Date.now();
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}
```

## Phase 6: Tests

**New file**: `agents/src/lib/mort-repl/__tests__/budget.test.ts`

### Unit tests for `isOverBudget`:

1. **No budget set anywhere** → returns `{ overBudget: false }`
2. **Parent has budget, under limit** → returns `{ overBudget: false }`
3. **Parent has budget, over limit** → returns `{ overBudget: true, ... }`
4. **Grandparent has budget** (intermediate parent has none) → correctly walks up
5. **Multiple descendants** → sums costs across entire subtree
6. **Running thread** (no `totalCostUsd`) → treated as $0 cost
7. **Budget exactly at cap** → over budget (>= check)
8. **Circular parentThreadId guard** → terminates without infinite loop

### Integration test in `child-spawner.test.ts`:

9. **Spawn rejected when over budget** → `spawn()` throws with descriptive error
10. **Child cost propagated to metadata after completion** → `metadata.json` has `totalCostUsd`

### Test setup

Use `tmp` dirs with mock `metadata.json` files — same pattern as existing `child-spawner.test.ts`.

## File Change Summary

| File | Change |
| --- | --- |
| `core/types/threads.ts` | Add `budgetCapUsd` and `totalCostUsd` to `ThreadMetadataBaseSchema` |
| `agents/src/lib/mort-repl/budget.ts` | **New** — `isOverBudget()` function |
| `agents/src/lib/mort-repl/child-spawner.ts` | Budget gate before spawn + cost propagation after child exit |
| `agents/src/lib/mort-repl/types.ts` | Add `budgetCapUsd` to `SpawnOptions` |
| `agents/src/lib/mort-repl/mort-sdk.ts` | Pass through `budgetCapUsd`, add `setBudgetCap()` |
| `agents/src/lib/mort-repl/__tests__/budget.test.ts` | **New** — unit + integration tests |

## Edge Cases

- **Circular `parentThreadId`**: Guard with a visited set to avoid infinite loops.
- **Missing metadata files**: Thread dir exists but metadata is corrupted/missing — skip with warning log.
- **Race condition**: Thread completes between budget check and spawn — acceptable, budget is a soft cap.
- **No cost data yet**: A just-spawned thread with no completed turns has $0 cost — correct behavior.
- **Multiple budget caps in ancestry**: The first (nearest) ancestor with `budgetCapUsd` wins. If a grandparent also has a budget, it's checked independently when the grandparent's children spawn.
