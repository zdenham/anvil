# Plan: Wire Plan Detection at the Agent Level

## Problem

The plan detection service (`src/entities/plans/detection-service.ts`) and React hook (`use-plan-detection.ts`) exist but are **never used**. When the agent writes/edits files in `plans/*.md`, no plan entity is created or associated with the thread.

## Current Flow (Broken)

```
Agent writes to plans/foo.md
    ↓
PostToolUse hook records fileChange in state
    ↓
AGENT_STATE emitted with fileChanges[]
    ↓
Frontend receives event
    ↓
❌ Nothing calls detectPlanFromFileChanges()
    ↓
No plan created
```

## Proposed Flow (Agent-Level Detection with Persistence)

Following the established pattern (agent writes to disk, emits event with ID, frontend refreshes from disk):

```
Agent writes to plans/foo.md
    ↓
PostToolUse hook detects plan path
    ↓
Agent creates plan via NodePersistence (writes ~/.mort/plans/{id}/metadata.json)
    ↓
Agent emits PLAN_DETECTED event { planId }
    ↓
Frontend receives event via eventBus
    ↓
Plan listener calls planService.refreshById(planId)
    ↓
Plan loaded from disk into store
```

## Implementation Steps

### Step 1: Add PLAN_DETECTED event to schema

**File:** `core/types/events.ts`

```typescript
// Add to EventName
PLAN_DETECTED = "plan:detected"

// Add to EventPayloads
[EventName.PLAN_DETECTED]: {
  planId: string;  // UUID of the created/updated plan
}
```

### Step 2: Add plan persistence to agent-side core

**File:** `agents/src/core/persistence.ts`

Add plan operations to `MortPersistence` (similar to task operations):

```typescript
const PLANS_DIR = "plans";

// In MortPersistence class:

/**
 * Create or update a plan.
 * Idempotent - looks up by repositoryName + path first.
 */
async ensurePlanExists(
  repositoryName: string,
  path: string
): Promise<{ id: string; isNew: boolean }> {
  // Find existing plan by path
  const existing = await this.findPlanByPath(repositoryName, path);
  if (existing) {
    // Mark as unread (content was updated)
    await this.updatePlan(existing.id, { isRead: false });
    return { id: existing.id, isNew: false };
  }

  // Create new plan
  const plan = await this.createPlan({ repositoryName, path });
  return { id: plan.id, isNew: true };
}

/**
 * Create a new plan.
 */
async createPlan(input: { repositoryName: string; path: string; title?: string }): Promise<PlanMetadata> {
  const title = input.title || this.extractTitleFromPath(input.path);
  const now = Date.now();
  const id = crypto.randomUUID();

  const plan: PlanMetadata = {
    id,
    path: input.path,
    repositoryName: input.repositoryName,
    title,
    isRead: false,
    createdAt: now,
    updatedAt: now,
  };

  await this.mkdir(`${PLANS_DIR}/${id}`);
  await this.write(`${PLANS_DIR}/${id}/metadata.json`, plan);
  return plan;
}

/**
 * Update plan metadata.
 */
async updatePlan(id: string, updates: { title?: string; isRead?: boolean }): Promise<void> {
  const plan = await this.getPlan(id);
  if (!plan) return;

  const updated = {
    ...plan,
    ...updates,
    updatedAt: Date.now(),
  };
  await this.write(`${PLANS_DIR}/${id}/metadata.json`, updated);
}

/**
 * Get plan by ID.
 */
async getPlan(id: string): Promise<PlanMetadata | null> {
  return this.read<PlanMetadata>(`${PLANS_DIR}/${id}/metadata.json`);
}

/**
 * Find plan by repository + path.
 */
async findPlanByPath(repositoryName: string, path: string): Promise<PlanMetadata | null> {
  const dirs = await this.listDirs(PLANS_DIR);
  for (const dir of dirs) {
    const plan = await this.read<PlanMetadata>(`${PLANS_DIR}/${dir}/metadata.json`);
    if (plan && plan.repositoryName === repositoryName && plan.path === path) {
      return plan;
    }
  }
  return null;
}

private extractTitleFromPath(path: string): string {
  const filename = path.split("/").pop() || path;
  const nameWithoutExt = filename.replace(/\.md$/, "");
  return nameWithoutExt
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
```

### Step 3: Add plan detection in PostToolUse hook

**File:** `agents/src/runners/shared.ts`

In the PostToolUse hook, after recording the file change:

```typescript
// Existing code records file change...

// NEW: Detect plan paths and persist plan entity
if (isPlanPath(filePath)) {
  const relativePath = normalizeToRelativePath(filePath, workingDirectory);
  const repositoryName = context.repositoryName; // Need to pass this through context

  const { id: planId } = await persistence.ensurePlanExists(repositoryName, relativePath);

  emitEvent(EventName.PLAN_DETECTED, { planId });
}
```

Add helper function:

```typescript
function isPlanPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  const relativePath = normalized.includes('/plans/')
    ? normalized.substring(normalized.indexOf('/plans/') + 1)
    : normalized;
  return relativePath.startsWith('plans/') && relativePath.endsWith('.md');
}
```

### Step 4: Handle event in agent-service.ts

**File:** `src/lib/agent-service.ts`

Add PLAN_DETECTED to the handleAgentEvent switch statement:

```typescript
case EventName.PLAN_DETECTED:
  eventBus.emit(name, payload);
  break;
```

### Step 5: Create plan listener

**File:** `src/entities/plans/listeners.ts` (new file)

```typescript
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events";
import { planService } from "./service";

export function setupPlanListeners(): void {
  eventBus.on(EventName.PLAN_DETECTED, async ({ planId }) => {
    // Refresh plan from disk - agent already wrote metadata.json
    await planService.refreshById(planId);
  });
}
```

### Step 6: Initialize listener at app startup

**File:** `src/entities/plans/index.ts`

Export the setup function:

```typescript
export { setupPlanListeners } from "./listeners";
```

**File:** `src/main.tsx` or equivalent initialization

Call `setupPlanListeners()` during app initialization.

### Step 7: Update event bridge for cross-window support

**File:** `src/lib/event-bridge.ts`

Add PLAN_DETECTED to the bridged events array so all windows see plan detections.

## Files to Modify

| File | Change |
|------|--------|
| `core/types/events.ts` | Add PLAN_DETECTED event name and payload type |
| `agents/src/core/persistence.ts` | Add plan CRUD operations to MortPersistence |
| `agents/src/runners/shared.ts` | Add plan detection + persistence in PostToolUse hook |
| `src/lib/agent-service.ts` | Handle PLAN_DETECTED in event switch |
| `src/entities/plans/listeners.ts` | New file - event listener that refreshes from disk |
| `src/entities/plans/index.ts` | Export setupPlanListeners |
| `src/lib/event-bridge.ts` | Add PLAN_DETECTED to bridged events |
| `src/main.tsx` (or init file) | Call setupPlanListeners() |

## What Happens to Existing Detection Code

The existing detection functions in `detection-service.ts` can be:
- **Kept** for detecting plans from user messages (when user types `plans/foo.md`)
- **Removed** if we only care about agent-created plans

The `use-plan-detection.ts` hook can be deleted since detection now happens via events.

## Key Pattern

This follows the established pattern used for tasks:
1. **Agent writes to disk** using `MortPersistence` (shared between Node and Tauri)
2. **Agent emits event** with just the entity ID
3. **Frontend refreshes from disk** using the service's `refreshById()` method

This ensures:
- Single source of truth on disk
- Agent doesn't need to know about Zustand stores
- All clients stay in sync via events + disk reads
- Works across multiple windows

## Testing

1. Start agent, ask it to create a plan file
2. Verify plan metadata written to `~/.mort/plans/{id}/metadata.json`
3. Verify PLAN_DETECTED event is emitted with planId
4. Verify plan appears in plan list UI after refresh
5. Verify updates to existing plan file mark it as unread
