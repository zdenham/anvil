# Phase 2c: Update CLI

**File:** `agents/src/cli/anvil.ts`
**Dependencies:** 00-types

## Changes

### 1. Add --thread Argument with Validation

Update `request-human` command to require thread ID with proper validation:

```typescript
async function requestHuman(args: string[]): Promise<void> {
  const taskId = getArg(args, "--task");
  const threadId = getArg(args, "--thread");  // NEW
  const markdownArg = getArg(args, "--markdown");
  const defaultResponse = getArg(args, "--default") ?? "Proceed";
  const onApproveArg = getArg(args, "--on-approve");
  const onFeedbackArg = getArg(args, "--on-feedback");

  if (!taskId) error("--task is required");
  if (!threadId) error("--thread is required");  // NEW
  if (threadId.trim() === "") error("--thread must not be empty");  // NEW - empty string validation
  // ... existing validation
```

### 2. Use addPendingReview Operation

**Important:** The CLI does NOT generate review IDs. The persistence layer (`updateTask` with `addPendingReview`) is responsible for generating the unique `id` field for each review entry.

```typescript
// FROM:
const task = await persistence.updateTask(taskId, {
  pendingReview: {
    markdown,
    defaultResponse,
    requestedAt: Date.now(),
    onApprove,
    onFeedback,
  },
});

// TO:
const task = await persistence.updateTask(taskId, {
  addPendingReview: {
    threadId,
    markdown,
    defaultResponse,
    requestedAt: Date.now(),
    onApprove,
    onFeedback,
    isAddressed: false,
    // NOTE: `id` is NOT passed here - persistence layer generates it
  },
});
```

### 3. Update Help Text

Document the new `--thread` flag in the help output.

---

## Runner Update: Expose threadId Template Variable

**File:** `agents/src/runner.ts`

The runner must expose `{{threadId}}` as a template variable so agents can access it in their prompts.

Update `buildAppendedPrompt()` to include threadId replacement:

```typescript
// In buildAppendedPrompt() - add to existing template variable replacements
prompt = prompt.replace(/\{\{taskId\}\}/g, context.taskId ?? "none");
prompt = prompt.replace(/\{\{slug\}\}/g, context.slug ?? "none");
prompt = prompt.replace(/\{\{branchName\}\}/g, context.branchName ?? "none");
prompt = prompt.replace(/\{\{anvilDir\}\}/g, context.anvilDir);
prompt = prompt.replace(/\{\{threadId\}\}/g, context.threadId ?? "none");  // NEW
```

Ensure the `context` object passed to `buildAppendedPrompt()` includes `threadId` from `args.threadId`.

---

## Shared Prompts Update: Add --thread to HUMAN_REVIEW_TOOL

**File:** `agents/src/agent-types/shared-prompts.ts`

**Critical:** The `HUMAN_REVIEW_TOOL` prompt section must include `--thread={{threadId}}` or agents will not know to pass the thread ID.

Update the template variable comment at the top:
```typescript
/**
 * Shared prompt sections for DRY agent system prompts.
 * Template variables: {{taskId}}, {{branchName}}, {{threadId}}  // ADD threadId
 * Commands: `anvil` CLI is available in PATH (set by runner)
 */
```

Update `HUMAN_REVIEW_TOOL`:
```typescript
export const HUMAN_REVIEW_TOOL = `## Human Review Tool

Request review using:
\`\`\`bash
anvil request-human --task={{taskId}} --thread={{threadId}} \\
  --markdown "## Your review content" \\
  --default "Proceed" \\
  --on-approve <agentType> \\
  --on-feedback <agentType>
\`\`\`

**Required flags:**
- \`--thread\`: The current thread ID (identifies which agent thread made the request)
- \`--on-approve\`: Agent to spawn when user approves (presses Enter)
- \`--on-feedback\`: Agent to spawn when user provides feedback text

...rest unchanged...
`;
```

---

## Caller Updates

Find where `anvil request-human` is invoked and ensure `--thread` is passed:
- Search for `request-human` in agent system prompts (covered by shared-prompts.ts update above)
- Update any orchestration code that spawns this command

## Verification Checklist

- [ ] CLI validates `--thread` is present and non-empty
- [ ] CLI passes `threadId` to `addPendingReview` (persistence generates the `id`)
- [ ] `runner.ts` exposes `{{threadId}}` template variable
- [ ] `shared-prompts.ts` includes `--thread={{threadId}}` in the example command
- [ ] Help text documents the `--thread` flag
