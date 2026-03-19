# Budget Cap for mort-repl

## Summary

Ensure cost tracking is accurate and bubbles up from children to parents, then add a simple `budgetCapUsd` gate. Today `totalCostUsd` lives in `state.json → metrics` only, which is the wrong place — state.json is large and costly to read. All cost fields should live exclusively in `metadata.json`.

1. Write `totalCostUsd` to metadata.json on thread completion, remove from state.json metrics
2. On child completion, add the child's tree cost to the parent's `cumulativeCostUsd` in metadata
3. Walk ancestors on spawn to check if any have a `budgetCapUsd` that's been exceeded

## Design Decision: Cost Lives in Metadata Only

Cost metrics (`totalCostUsd`, `cumulativeCostUsd`, `budgetCapUsd`) live **exclusively in metadata.json**. No duplication in state.json. Rationale:

- Budget checks only need metadata (cheap to read vs large state.json)
- Single source of truth — no drift between state and metadata
- `ResultMetrics` remains the SDK transport type but `totalCostUsd` is stripped before persisting to state

## Phases

- [x] Write `totalCostUsd` to metadata.json on completion, strip from state.json

- [x] Roll up child cost to parent metadata.json on child completion

- [x] Add `budgetCapUsd` field and ancestor-walk budget check

- [x] Integrate budget gate into `ChildSpawner.spawn()`

- [x] Add `budgetCapUsd` to spawn options and `mort` SDK

- [x] Tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Write `totalCostUsd` to metadata.json, strip from state.json

### 1a. Add fields to `ThreadMetadataBaseSchema`

**File**: `core/types/threads.ts`

```ts
// After cumulativeUsage field:
totalCostUsd: z.number().optional(),       // This thread's own USD cost (from SDK result)
cumulativeCostUsd: z.number().optional(),   // All descendants' cost (rolled up on child completion)
budgetCapUsd: z.number().positive().optional(), // Budget cap (only on budget root threads)
```

### 1b. Write `totalCostUsd` to metadata on completion

**File**: `agents/src/output.ts` — in `complete()` function

After dispatching COMPLETE and writing state, write `totalCostUsd` to metadata.json:

```ts
export async function complete(metrics: ResultMetrics): Promise<void> {
  dispatch({ type: "COMPLETE", payload: { metrics } });
  await writeToDisk();

  // Write totalCostUsd to metadata.json (canonical location for cost)
  if (metrics.totalCostUsd !== undefined) {
    await writeCostToMetadata(metadataPath, metrics.totalCostUsd);
  }
}
```

### 1c. Strip `totalCostUsd` from state.json

**File**: `core/lib/thread-reducer.ts` — in `applyComplete()`

Remove `totalCostUsd` from the metrics persisted in state, since it now lives in metadata:

```ts
function applyComplete(state: ThreadState, payload: { metrics: ResultMetrics }): ThreadState {
  const toolStates = markOrphanedTools(state.toolStates);
  const { totalCostUsd: _, ...metricsWithoutCost } = payload.metrics;
  const metrics = { ...metricsWithoutCost };
  if (state.lastCallUsage && !metrics.lastCallUsage) {
    metrics.lastCallUsage = state.lastCallUsage;
  }
  return { ...state, toolStates, metrics, status: "complete" };
}
```

Update `ResultMetricsSchema` to make `totalCostUsd` optional in the persisted form, or use a separate `PersistedMetrics` type that omits it.

## Phase 2: Roll up child cost to parent on child completion

When a child completes, add its full tree cost `(totalCostUsd + cumulativeCostUsd)` to the parent's `cumulativeCostUsd`. This is incremental — no tree scan needed.

### Roll-up model

- `totalCostUsd` — this thread's own USD cost
- `cumulativeCostUsd` — sum of all descendants' tree costs
- Total tree cost = `totalCostUsd + cumulativeCostUsd`
- Budget check: `budgetRoot.totalCostUsd + budgetRoot.cumulativeCostUsd >= budgetRoot.budgetCapUsd`

### 2a. mort-repl path: `child-spawner.ts`

After child exits in `waitForResult()`, read child's metadata (which has `totalCostUsd` from Phase 1) and roll up to parent:

```ts
private rollUpCostToParent(childThreadPath: string): void {
  try {
    const childMeta = JSON.parse(readFileSync(join(childThreadPath, "metadata.json"), "utf-8"));
    const childTreeCost = (childMeta.totalCostUsd ?? 0) + (childMeta.cumulativeCostUsd ?? 0);
    if (childTreeCost <= 0) return;

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

Also emit `costUsd` in AGENT_COMPLETED (currently missing).

### 2b. SDK Task tool path: `shared.ts`

The SDK Task tool already emits `costUsd` in AGENT_COMPLETED. Add the same roll-up using a shared utility.

### Timing

For mort-repl: Phase 1 writes `totalCostUsd` to child's metadata inside the child process (via `complete()` in `output.ts`). The parent waits for child exit, then reads metadata. Safe ordering.

For SDK Task: The SDK gives us `taskResponse.total_cost_usd` directly.

## Phase 3: Add `budgetCapUsd` and ancestor-walk check

**New file**: `agents/src/lib/mort-repl/budget.ts`

```ts
export interface BudgetCheckResult {
  overBudget: boolean;
  budgetThreadId?: string;
  capUsd?: number;
  spentUsd?: number;
}

export function isOverBudget(threadId: string, mortDir: string): BudgetCheckResult {
  // Walk up parent pointers, read metadata.json per ancestor
  // If any ancestor has budgetCapUsd, check totalCostUsd + cumulativeCostUsd >= cap
  // Nearest budget root wins (stop at first cap found)
  // Guarded with visited set against circular parentThreadId
}
```

O(depth) — just walk up parent pointers, one metadata read per ancestor.

## Phase 4: Integrate into `ChildSpawner.spawn()`

At the top of `spawn()`, call `isOverBudget()`. If over budget, throw an Error that surfaces as `mort.spawn()` rejection.

## Phase 5: Add `budgetCapUsd` to spawn options and mort SDK

- Add `budgetCapUsd?: number` to `SpawnOptions` in `types.ts`
- Write to child metadata in `createThreadOnDisk()`
- Pass through in `mort-sdk.ts` `spawn()`
- Add `mort.setBudgetCap(usd)` for self-budgeting (writes to current thread's metadata.json)

## Phase 6: Tests

**New file**: `agents/src/lib/mort-repl/__tests__/budget.test.ts`

### `isOverBudget` unit tests:

1. No budget set → `{ overBudget: false }`
2. Parent has budget, under limit → `{ overBudget: false }`
3. Parent has budget, over limit → `{ overBudget: true, ... }`
4. Grandparent has budget (intermediate has none) → walks up correctly
5. Exactly at cap → over budget (&gt;= check)
6. Circular `parentThreadId` → terminates via visited set

### Cost roll-up unit tests:

7. `rollUpCostToParent` adds child tree cost to parent's `cumulativeCostUsd`
8. Grandchild cost bubbles through (child's `cumulativeCostUsd` included)

### Integration:

 9. `spawn()` throws when budget exceeded
10. `spawn()` succeeds when under budget

Use tmp dirs with mock metadata.json files.

## File Change Summary

| File | Change |
| --- | --- |
| `core/types/threads.ts` | Add `totalCostUsd`, `cumulativeCostUsd`, `budgetCapUsd` to metadata schema |
| `core/types/events.ts` | Make `totalCostUsd` optional in persisted `ResultMetrics` |
| `core/lib/thread-reducer.ts` | Strip `totalCostUsd` from metrics in COMPLETE reducer |
| `agents/src/output.ts` | Write `totalCostUsd` to metadata.json on completion |
| `agents/src/lib/mort-repl/child-spawner.ts` | Read child cost + roll up to parent + budget gate + `budgetCapUsd` passthrough |
| `agents/src/runners/shared.ts` | Roll up SDK Task child cost to parent metadata |
| `agents/src/lib/mort-repl/budget.ts` | **New** — `isOverBudget()` ancestor walk |
| `agents/src/lib/mort-repl/types.ts` | Add `budgetCapUsd` to `SpawnOptions` |
| `agents/src/lib/mort-repl/mort-sdk.ts` | Pass through `budgetCapUsd`, add `setBudgetCap()` |
| `agents/src/lib/mort-repl/__tests__/budget.test.ts` | **New** — tests |

## Edge Cases

- **Circular** `parentThreadId`: Guarded with visited set in ancestor walk.
- **Missing metadata**: Skip with warning — don't block spawning.
- **Race condition**: Thread completes between budget check and spawn — acceptable soft cap.
- **In-flight threads**: Their cost is $0 until completion — budget is conservative (under-counts).
- **Multiple budget caps in ancestry**: Nearest ancestor wins (first cap found stops the walk).