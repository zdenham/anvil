# Plan: Flexible Agent Progression (Remove Rigid State Machine)

## Current State Summary (Updated 2025-12-27)

The system currently has a **two-phase review/merge flow** implemented as part of the merge strategy work:

### How It Works Now

1. **Status-to-agent mapping** via `getAgentTypeForStatus()`:
   - `todo` → `entrypoint` agent
   - `in_progress` → `execution` agent
   - `in_review` → `review` OR `merge` agent (depends on `reviewApproved` flag)

2. **Two-phase `in_review` flow**:
   - **Phase 1** (`reviewApproved=false`): Review agent checks work, requests approval
   - User approves → sets `reviewApproved=true`, spawns merge agent
   - **Phase 2** (`reviewApproved=true`): Merge agent creates PR or merges locally
   - User approves → task completes

3. **`determineResponseAction()`** handles the phase transitions:
   - Empty input + `in_review` + `reviewApproved=false` → `{ type: "approve_review" }` → merge agent
   - Empty input + `in_review` + `reviewApproved=true` → `{ type: "complete" }`
   - Non-empty input → `{ type: "stay" }` → respawn same agent with feedback

4. **Merge agent** now supports configurable strategies via `buildMergeAgentPrompt()`:
   - `MergeDestination`: "local" | "pull-request"
   - `MergeMethod`: "merge" | "rebase"

### Key Files (Current)
- `src/lib/agent-state-machine.ts` - State transitions, `determineResponseAction()`
- `src/components/workspace/action-panel.tsx` - Review UI, phase handling
- `agents/src/cli/mort.ts` - `request-review` command
- `agents/src/agent-types/merge.ts` - Merge agent with `buildMergeAgentPrompt()`
- `agents/src/agent-types/index.ts` - Agent registry with `listAgentTypes()`
- `src/entities/tasks/types.ts` - `PendingReview`, `reviewApproved` in TaskMetadata

### Current PendingReview Structure
```typescript
interface PendingReview {
  markdown: string;
  defaultResponse: string;
  requestedAt: number;
}
```

---

## Desired State

1. **Agents suggest their own next agents** via `mort request-review`:
   - Happy path: "If user approves, spawn X agent"
   - Changes path: "If user requests changes, spawn Y agent"

2. **User can override** the suggested agent via a dropdown (showing all agent types)

3. **Task stage updates are agent-controlled** via `mort` CLI, not automatic

4. **Simplify state machine** - remove rigid status→agent mapping, keep validation helpers

---

## Design Decisions

1. **Agent dropdown**: Show ALL registered agent types from `listAgentTypes()`
2. **Suggestions are mandatory**: Agents must always provide both suggestions
3. **Keep `reviewApproved` for now**: Useful for UI badges ("Ready to Merge"), remove later if truly unused
4. **Preserve merge strategy integration**: `buildMergeAgentPrompt()` continues to work - just invoked when user selects merge agent

---

## Implementation Plan

### Phase 1: Data Structure Updates

#### 1.1 Update `PendingReview` type
**File:** `src/entities/tasks/types.ts`

```typescript
interface PendingReview {
  markdown: string;
  defaultResponse: string;
  requestedAt: number;
  onApprove: string;   // NEW: Agent type to spawn on approval
  onFeedback: string;  // NEW: Agent type to spawn on feedback
}
```

### Phase 2: CLI Updates

#### 2.1 Update `request-review` command
**File:** `agents/src/cli/mort.ts`

Add required flags:
- `--on-approve <agentType>` - Agent to spawn when user approves (presses Enter)
- `--on-feedback <agentType>` - Agent to spawn when user provides feedback

Both flags required. Validation: must be valid agent type from `listAgentTypes()`.

### Phase 3: UI Updates

#### 3.1 Update Action Panel
**File:** `src/components/workspace/action-panel.tsx`

Changes:
1. **Add agent dropdown** using types from `listAgentTypes()` (exposed via IPC)
2. **Pre-select based on context**:
   - Empty input → show `onApprove` agent
   - User typing feedback → show `onFeedback` agent
3. **On submit**:
   - Spawn the selected agent directly (bypass `determineResponseAction()` for agent selection)
   - Pass user feedback as context to the spawned agent
   - If selected agent is `merge`, inject merge strategy prompt via `buildMergeAgentPrompt()`
4. **Keep status completion logic**: When merge agent completes successfully, still allow completing the task

**Note:** The existing agent registry at `agents/src/agent-types/index.ts` already exports `listAgentTypes()`. Need to expose this to the frontend via IPC.

### Phase 4: State Machine Simplification

#### 4.1 Simplify `agent-state-machine.ts`
**File:** `src/lib/agent-state-machine.ts`

**Remove:**
- `getAgentTypeForStatus()` - agents are now explicit from suggestions
- `determineResponseAction()` - replaced by UI logic reading suggestions
- `getInReviewAgentType()` - no longer needed

**Keep:**
- `getNextStatus()` - still useful for manual progression
- `canProgress()` - useful for drag-drop validation
- `getNextPhaseLabel()` - useful for UI buttons (can simplify)
- Status constants/types

### Phase 5: Agent Prompt Updates

#### 5.1 Update HUMAN_REVIEW_TOOL in shared-prompts.ts
**File:** `agents/src/agent-types/shared-prompts.ts`

Update the `HUMAN_REVIEW_TOOL` section:
```markdown
## Human Review Tool

Request review using:
\`\`\`bash
mort request-review --task={{taskId}} \\
  --markdown "## Your review content" \\
  --default "Proceed" \\
  --on-approve <agentType> \\
  --on-feedback <agentType>
\`\`\`

**Required flags:**
- \`--on-approve\`: Agent to spawn when user approves (presses Enter)
- \`--on-feedback\`: Agent to spawn when user provides feedback text

**Available agent types:**

| Agent | Purpose | Use when... |
|-------|---------|-------------|
| `entrypoint` | Task routing & planning | Need to refine requirements, break down work, or re-plan |
| `execution` | Code implementation | Ready to write code, or need to fix/revise implementation |
| `review` | Code review & quality check | Implementation complete, needs review before merge |
| `merge` | Git merge/PR creation | Review approved, ready to integrate into target branch |

**Common patterns:**
- Entrypoint completing plan: \`--on-approve execution --on-feedback entrypoint\`
- Execution ready for review: \`--on-approve review --on-feedback execution\`
- Review approving work: \`--on-approve merge --on-feedback execution\`
- Merge completing: \`--on-approve merge --on-feedback merge\` (user completes task via UI)
```

#### 5.2 No changes needed to individual agent files
The agents use `HUMAN_REVIEW_TOOL` from shared prompts, so updating that propagates to all.

### Phase 6: IPC Bridge for Agent Types

#### 6.1 Expose agent types to frontend
**Files:**
- `src/lib/agent-service.ts` - Add IPC handler to return agent types
- Frontend needs to fetch available agent types for dropdown

```typescript
// In agent-service.ts or similar
ipcMain.handle('get-agent-types', async () => {
  // Import from agents package or maintain a mirror list
  return ['entrypoint', 'execution', 'review', 'merge'];
});
```

### Phase 7: Optional Cleanup (Deferred)

#### 7.1 Consider removing `reviewApproved` later
If after implementation we find `reviewApproved` is truly unused:
- Remove from `TaskMetadata` in types.ts
- Remove "Merge" badge from task-row.tsx and task-card.tsx
- Remove from service.ts

---

## Files Summary

| File | Action |
|------|--------|
| `src/entities/tasks/types.ts` | Add `onApprove`/`onFeedback` to PendingReview |
| `agents/src/cli/mort.ts` | Add `--on-approve`/`--on-feedback` flags |
| `src/components/workspace/action-panel.tsx` | Add agent dropdown, use suggestions |
| `src/lib/agent-state-machine.ts` | Remove getAgentTypeForStatus, determineResponseAction |
| `agents/src/agent-types/shared-prompts.ts` | Update HUMAN_REVIEW_TOOL with agent descriptions |
| `src/lib/agent-service.ts` | Add IPC handler for agent types |

---

## Migration & Backwards Compatibility

1. **Existing tasks with pendingReview**: Handle missing `onApprove`/`onFeedback` gracefully:
   - If fields missing, show dropdown with no pre-selection
   - Or fall back to current behavior until user selects

2. **Agents must be updated**: Old request-review calls without `--on-approve`/`--on-feedback` will fail validation. Update all agents simultaneously.

3. **Merge strategy integration preserved**: `buildMergeAgentPrompt()` continues to work - invoked when merge agent is selected (either via suggestion or override).

---

## Open Questions

1. **Task completion flow**: Should completing a task always require explicit action, or can merge agent signal "ready to complete"?

2. **Status transitions**: Should agents be the only way to change status, or keep manual drag-drop in kanban?

3. **"Complete" as an agent type?**: Could add a pseudo-agent that just marks task complete instead of spawning an agent.
