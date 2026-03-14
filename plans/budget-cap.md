# Budget Cap for mort-repl

## Summary

Ensure cost tracking is accurate and bubbles up from children to parents, then add a simple `budgetCapUsd` gate. Today each thread tracks its **own** `totalCostUsd` in `state.json → metrics` after completion, but this cost never propagates to `metadata.json` and never rolls up to parent threads. The fix is:

1. Propagate each thread's own cost to its `metadata.json` on completion
2. On child completion, add the child's cost to the parent's cumulative cost in metadata
3. Walk ancestors on spawn to check if any have a `budgetCapUsd` that's been exceeded

## Context — What exists today

| Field | Location | Tracks | When Written |
| --- | --- | --- | --- |
| `cumulativeUsage` (tokens) | `metadata.json` + `state.json` | Token counts for this thread only | Live, after each API call |
| `metrics.totalCostUsd` | `state.json` only | This thread's own USD cost | Once, on SDK result message |
| `turns[n].costUsd` | `metadata.json` | Per-turn USD cost | `completeTurn()` — **defined but never called** |

### Gaps

1. **`totalCostUsd` never reaches `metadata.json`** — The SDK writes `metrics.totalCostUsd` to `state.json` via the COMPLETE reducer, but `metadata.json` has no `totalCostUsd` field. Budget checks need metadata-only reads (state.json is large).

2. **No cumulative USD cost** — There is no field that represents "this thread + all its descendants" cost. `cumulativeUsage` is cumulative _tokens_ for a single thread, not a tree-wide USD sum.

3. **mort-repl children don't emit `costUsd`** — `child-spawner.ts:287-289` emits AGENT_COMPLETED without `costUsd`. The child's `state.json` has the cost, but the parent never reads it.

4. **SDK Task children emit `costUsd` but nobody consumes it** — `shared.ts:1278` emits `costUsd` in AGENT_COMPLETED, but `handleAgentCompleted` in `listeners.ts:165` destructures only `{ threadId, exitCode }`.

5. **`completeTurn()` is never called** — `threadService.completeTurn()` exists and would write `costUsd` to turn metadata, but nothing calls it.

## Phases

- [ ] Propagate own `totalCostUsd` to `metadata.json` on thread completion
- [ ] Roll up child cost to parent `metadata.json` on child completion
- [ ] Add `budgetCapUsd` field and ancestor-walk budget check
- [ ] Integrate budget gate into `ChildSpawner.spawn()`
- [ ] Add `budgetCapUsd` to spawn options and `mort` SDK
- [ ] Tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Propagate own `totalCostUsd` to `metadata.json`

When a thread completes, its `state.json` has `metrics.totalCostUsd` but `metadata.json` does not. Fix this so budget checks can read metadata only.

### 1a. Add fields to `ThreadMetadataBaseSchema`

**File**: `core/types/threads.ts`

```ts
// After cumulativeUsage field:
totalCostUsd: z.number().optional(),       // This thread's own USD cost (from SDK result)
cumulativeCostUsd: z.number().optional(),   // This thread + all descendants' cost
budgetCapUsd: z.number().positive().optional(), // Budget cap (only on budget root threads)
```

- `totalCostUsd` — written once when thread completes (Phase 1b)
- `cumulativeCostUsd` — updated when children complete (Phase 2)
- `budgetCapUsd` — set by caller when spawning a budget-capped subtree (Phase 5)

### 1b. Write `totalCostUsd` to metadata on completion

**File**: `agents/src/output.ts` — in `complete()` function

After writing state.json (which already happens), also read-modify-write `metadata.json` to add `totalCostUsd`:

```ts
export async function complete(metrics: ResultMetrics): Promise<void> {
  dispatch({ type: "COMPLETE", payload: { metrics } });
  await writeToDisk();

  // NEW: Propagate totalCostUsd to metadata.json for cheap budget reads
  if (metrics.totalCostUsd !== undefined) {
    await writeCostToMetadata(metadataPath, metrics.totalCostUsd);
  }
}

async function writeCostToMetadata(mdPath: string, costUsd: number): Promise<void> {
  try {
    if (!existsSync(mdPath)) return;
    const raw = readFileSync(mdPath, "utf-8");
    const metadata = JSON.parse(raw);
    metadata.totalCostUsd = costUsd;
    metadata.updatedAt = Date.now();
    writeFileSync(mdPath, JSON.stringify(metadata, null, 2));
  } catch (err) {
    logger.warn(`[output] Failed to write cost to metadata: ${err}`);
  }
}
```

This handles the common case: every thread that completes normally gets `totalCostUsd` in its metadata.

## Phase 2: Roll up child cost to parent on child completion

When a child completes, add its `totalCostUsd` to the parent's `cumulativeCostUsd`. This bubbles costs upward so any ancestor can see the total spend of its subtree.

### 2a. mort-repl path: `child-spawner.ts`

In `waitForResult()`, after the child exits:

```ts
// After reading resultText:
const childCostUsd = this.readChildCost(childThreadPath);

// Emit costUsd in AGENT_COMPLETED (currently missing)
this.emitEvent(EventName.AGENT_COMPLETED, {
  threadId: childThreadId,
  exitCode,
  costUsd: childCostUsd,  // NEW
}, "mort-repl:child-complete");

// Roll up cost to parent metadata
if (childCostUsd !== undefined) {
  this.rollUpCostToParent(childCostUsd);
}
```

New private methods on `ChildSpawner`:

```ts
private readChildCost(childThreadPath: string): number | undefined {
  const statePath = join(childThreadPath, "state.json");
  if (!existsSync(statePath)) return undefined;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    return state.metrics?.totalCostUsd;
  } catch { return undefined; }
}

/** Add child's cost to parent's cumulativeCostUsd in metadata. */
private rollUpCostToParent(childCostUsd: number): void {
  const parentMetadataPath = join(
    this.context.mortDir, "threads", this.context.threadId, "metadata.json"
  );
  try {
    if (!existsSync(parentMetadataPath)) return;
    const metadata = JSON.parse(readFileSync(parentMetadataPath, "utf-8"));
    metadata.cumulativeCostUsd = (metadata.cumulativeCostUsd ?? 0) + childCostUsd;
    metadata.updatedAt = Date.now();
    writeFileSync(parentMetadataPath, JSON.stringify(metadata, null, 2));
  } catch (err) {
    logger.warn(`[mort-repl] Failed to roll up cost to parent: ${err}`);
  }
}
```

### 2b. SDK Task tool path: `shared.ts`

The SDK Task tool already emits `costUsd` in AGENT_COMPLETED (`shared.ts:1278`). Add the same roll-up there. After the existing event emission:

```ts
// Roll up child cost to parent metadata
if (taskResponse.total_cost_usd) {
  rollUpCostToParent(mortDir, parentThreadId, taskResponse.total_cost_usd);
}
```

Extract the roll-up logic into a shared utility (or inline it — it's just a metadata read-modify-write).

### 2c. Transitive roll-up

When a grandchild completes, its cost rolls up to its direct parent. When that parent later completes, its `totalCostUsd` (own cost) should roll up to the grandparent. But `cumulativeCostUsd` on the parent already includes the grandchild's cost, so we also need to roll up `cumulativeCostUsd` when a thread completes.

In `output.ts:complete()`, after writing `totalCostUsd` to metadata, also propagate this thread's cumulative cost upward:

```ts
// In complete(), after writeCostToMetadata:
// Also roll up cumulative cost to parent if this thread has a parent
const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
if (metadata.parentThreadId) {
  const ownCost = metrics.totalCostUsd ?? 0;
  const childrenCost = metadata.cumulativeCostUsd ?? 0;
  const totalTreeCost = ownCost + childrenCost;
  rollUpCostToAncestor(mortDir, metadata.parentThreadId, totalTreeCost);
}
```

Wait — this would double-count because child costs were already rolled up when the child completed. The simpler model:

**`cumulativeCostUsd` tracks only direct children's costs that have been rolled up.** The total tree cost for a thread is `totalCostUsd + cumulativeCostUsd`. When checking budget, sum `totalCostUsd + cumulativeCostUsd` for the budget root thread only.

This means:
- Child completes → child's `(totalCostUsd + cumulativeCostUsd)` rolls up to parent's `cumulativeCostUsd`
- The parent's `cumulativeCostUsd` thus includes the entire descendant tree's cost
- Budget check: `budgetRoot.totalCostUsd + budgetRoot.cumulativeCostUsd >= budgetRoot.budgetCapUsd`

This avoids scanning all threads. The roll-up is incremental — each completion adds to the direct parent, which already accumulated its own children.

**Revised roll-up logic**: When a child completes, add `child.totalCostUsd + child.cumulativeCostUsd` (the child's entire subtree cost) to `parent.cumulativeCostUsd`.

For mort-repl children, read the child's metadata after Phase 1b writes `totalCostUsd`:

```ts
private rollUpCostToParent(childThreadPath: string): void {
  try {
    // Read child's full tree cost
    const childMeta = JSON.parse(readFileSync(join(childThreadPath, "metadata.json"), "utf-8"));
    const childTreeCost = (childMeta.totalCostUsd ?? 0) + (childMeta.cumulativeCostUsd ?? 0);
    if (childTreeCost <= 0) return;

    // Add to parent's cumulativeCostUsd
    const parentPath = join(this.context.mortDir, "threads", this.context.threadId, "metadata.json");
    if (!existsSync(parentPath)) return;
    const parentMeta = JSON.parse(readFileSync(parentPath, "utf-8"));
    parentMeta.cumulativeCostUsd = (parentMeta.cumulativeCostUsd ?? 0) + childTreeCost;
    parentMeta.updatedAt = Date.now();
    writeFileSync(parentPath, JSON.stringify(parentMeta, null, 2));
  } catch (err) {
    logger.warn(`[mort-repl] Failed to roll up cost to parent: ${err}`);
  }
}
```

### Timing note

For mort-repl: Phase 1b writes `totalCostUsd` inside the child's own process (via `complete()` in `output.ts`). The parent process waits for child exit in `waitForResult()`, then reads the child's state.json. By the time the parent reads, the child has already written both `state.json` and `metadata.json`. So the ordering is safe.

For SDK Task: The SDK gives us `taskResponse.total_cost_usd` directly, so we don't need to read state.json.

## Phase 3: Add `budgetCapUsd` and ancestor-walk check

**New file**: `agents/src/lib/mort-repl/budget.ts`

With incremental roll-up from Phase 2, budget checking becomes trivial — no tree scan needed:

```ts
export interface BudgetCheckResult {
  overBudget: boolean;
  budgetThreadId?: string;
  capUsd?: number;
  spentUsd?: number;
}

/**
 * Walk up the ancestor chain from threadId. If any ancestor has budgetCapUsd,
 * check if its total spend (own + descendants) exceeds the cap.
 */
export function isOverBudget(threadId: string, mortDir: string): BudgetCheckResult {
  const visited = new Set<string>();
  let currentId: string | undefined = threadId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const metadataPath = join(mortDir, "threads", currentId, "metadata.json");

    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    } catch {
      break; // Missing or corrupt metadata — stop walking
    }

    const capUsd = metadata.budgetCapUsd as number | undefined;
    if (capUsd !== undefined && capUsd > 0) {
      const ownCost = (metadata.totalCostUsd as number) ?? 0;
      const childrenCost = (metadata.cumulativeCostUsd as number) ?? 0;
      const spentUsd = ownCost + childrenCost;

      if (spentUsd >= capUsd) {
        return { overBudget: true, budgetThreadId: currentId, capUsd, spentUsd };
      }
      // Found a budget cap that's not exceeded — stop here
      // (nearest budget root wins; don't keep walking to grandparent budgets)
      return { overBudget: false, budgetThreadId: currentId, capUsd, spentUsd };
    }

    currentId = metadata.parentThreadId as string | undefined;
  }

  return { overBudget: false };
}
```

This is O(depth) — just walk up parent pointers, read one metadata.json per ancestor. No tree scan.

## Phase 4: Integrate into `ChildSpawner.spawn()`

**File**: `agents/src/lib/mort-repl/child-spawner.ts`

At the top of `spawn()`, before creating the child thread:

```ts
async spawn(options: SpawnOptions): Promise<string> {
  // Budget gate
  const budgetCheck = isOverBudget(this.context.threadId, this.context.mortDir);
  if (budgetCheck.overBudget) {
    throw new Error(
      `Budget exceeded: thread ${budgetCheck.budgetThreadId} ` +
      `has spent $${budgetCheck.spentUsd?.toFixed(2)} of ` +
      `$${budgetCheck.capUsd?.toFixed(2)} budget cap`
    );
  }

  const childThreadId = crypto.randomUUID();
  // ... rest unchanged
}
```

The thrown error propagates as a `mort.spawn()` rejection, surfacing in `ReplResult.error`.

## Phase 5: Add `budgetCapUsd` to spawn options and mort SDK

### 5a. SpawnOptions

**File**: `agents/src/lib/mort-repl/types.ts` — add to `SpawnOptions`:

```ts
budgetCapUsd?: number;
```

### 5b. Write to child metadata

**File**: `agents/src/lib/mort-repl/child-spawner.ts` — in `createThreadOnDisk()`:

```ts
const childMetadata = {
  // ... existing fields
  ...(options.budgetCapUsd ? { budgetCapUsd: options.budgetCapUsd } : {}),
};
```

### 5c. mort SDK passthrough

**File**: `agents/src/lib/mort-repl/mort-sdk.ts`

Pass `budgetCapUsd` through in `spawn()` options.

### 5d. `mort.setBudgetCap()` for self-budgeting

```ts
mort.setBudgetCap(5.00); // $5 cap for this thread's subtree
```

Writes `budgetCapUsd` to the current thread's `metadata.json`.

## Phase 6: Tests

**New file**: `agents/src/lib/mort-repl/__tests__/budget.test.ts`

### Unit tests for `isOverBudget`:

1. No budget set → `{ overBudget: false }`
2. Parent has budget, under limit → `{ overBudget: false }`
3. Parent has budget, over limit → `{ overBudget: true, ... }`
4. Grandparent has budget (intermediate has none) → walks up correctly
5. Exactly at cap → over budget (>= check)
6. Circular `parentThreadId` → terminates via visited set

### Unit tests for cost roll-up:

7. Child completion writes `totalCostUsd` to child's `metadata.json`
8. Child completion adds to parent's `cumulativeCostUsd`
9. Grandchild cost bubbles through (child's `cumulativeCostUsd` included in roll-up)

### Integration:

10. `spawn()` throws when budget exceeded
11. `spawn()` succeeds when under budget

Use `tmp` dirs with mock `metadata.json` files — same pattern as existing tests.

## File Change Summary

| File | Change |
| --- | --- |
| `core/types/threads.ts` | Add `totalCostUsd`, `cumulativeCostUsd`, `budgetCapUsd` to schema |
| `agents/src/output.ts` | Write `totalCostUsd` to metadata.json on completion |
| `agents/src/lib/mort-repl/child-spawner.ts` | Read child cost + roll up to parent + budget gate + `budgetCapUsd` passthrough |
| `agents/src/runners/shared.ts` | Roll up SDK Task child cost to parent metadata |
| `agents/src/lib/mort-repl/budget.ts` | **New** — `isOverBudget()` ancestor walk |
| `agents/src/lib/mort-repl/types.ts` | Add `budgetCapUsd` to `SpawnOptions` |
| `agents/src/lib/mort-repl/mort-sdk.ts` | Pass through `budgetCapUsd`, add `setBudgetCap()` |
| `agents/src/lib/mort-repl/__tests__/budget.test.ts` | **New** — tests |

## Edge Cases

- **Circular `parentThreadId`**: Guarded with visited set in ancestor walk.
- **Missing metadata**: Skip with warning — don't block spawning.
- **Race condition**: Thread completes between budget check and spawn — acceptable soft cap.
- **In-flight threads**: Their cost is $0 until completion — budget is conservative (under-counts).
- **Multiple budget caps in ancestry**: Nearest ancestor wins (first cap found stops the walk).
