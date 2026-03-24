# 02: CLI Command

**Dependencies:** 01-types
**Enables:** None (end of chain)

---

## Goal

Implement the `anvil request-review` CLI command that agents use to request human review.

---

## Tasks

### 1. Create the command

File: `agents/src/cli/commands/request-review.ts`

```typescript
import { Command } from "commander";
import { taskService } from "../../services/task-service";
import { eventBus } from "../../lib/event-bus";

export const requestReviewCommand = new Command("request-review")
  .description("Request human review for a task")
  .requiredOption("--task <taskId>", "Task ID")
  .option("--markdown <content>", "Markdown content (or pipe via stdin)")
  .option("--default <response>", "Default response sent on Enter", "Proceed")
  .action(async (options) => {
    const markdown = options.markdown ?? await readStdin();
    const defaultResponse = options.default;

    // Update task metadata
    await taskService.update(options.task, {
      pendingReview: {
        markdown,
        defaultResponse,
        requestedAt: Date.now(),
      },
    });

    // Emit event
    eventBus.emit("action-requested", {
      taskId: options.task,
      markdown,
      defaultResponse,
    });

    console.log("Review requested");
  });
```

### 2. Register the command

Add the command to the CLI entrypoint (likely `agents/src/cli/anvil.ts` or similar).

### 3. Implement stdin reading

Create helper function `readStdin()` if not already present:

```typescript
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
```

---

## Usage Examples

```bash
# With inline markdown
anvil request-review --task <task-id> --markdown "## Please Review" --default "Proceed"

# With stdin
echo "## Please Review\n\nThe plan is ready." | anvil request-review --task <task-id> --default "Proceed"

# Multiline markdown
anvil request-review --task $TASK_ID --default "Start implementation" --markdown "
## Plan Ready for Review

I've analyzed the codebase and created an implementation plan.

### Proposed Changes
1. Add authentication middleware in \`src/middleware/auth.ts\`
2. Update user model with session fields
3. Create login/logout API endpoints

### Questions
- Should sessions expire after 24 hours or 7 days?
"
```

---

## Acceptance Criteria

- [ ] `anvil request-review` command exists and is registered
- [ ] `--task` is required
- [ ] `--markdown` accepts content or falls back to stdin
- [ ] `--default` defaults to "Proceed"
- [ ] Command updates task's `pendingReview` metadata
- [ ] Command emits `action-requested` event
- [ ] Command prints confirmation and exits
