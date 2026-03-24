# Fix: Anvil CLI Disambiguation

## Problem

When agents run `anvil tasks get --id=...`, they get an error:

```
Error: Unknown tasks subcommand: get. Use: list, show, search, create, create-subtask, associate
```

This happens because there are **two different `anvil` CLIs**:

1. **Rust CLI** (`/Users/zac/Library/pnpm/anvil` → `src-tauri/target/debug/anvil`)
   - Commands: `list, show, search, create, create-subtask, associate`

2. **Node.js CLI** (`agents/dist/cli/anvil.js`)
   - Commands: `list, create, get, rename, update, delete, associate, disassociate`

The agent prompts reference the Node.js CLI's commands (`get`, `rename`, `update`), but the shell finds the Rust CLI first in PATH.

## Root Cause

- A global `anvil` wrapper was installed at `/Users/zac/Library/pnpm/anvil`
- This wrapper invokes the Rust binary from `src-tauri/target/debug/anvil`
- The Rust CLI has a different command structure than the Node.js CLI
- Agent prompts say `anvil tasks get ...` but the Rust CLI expects `anvil tasks show ...`

## Solution

**Use absolute paths** to ensure agents always invoke the correct CLI.

Introduced a `{{anvilCli}}` template variable that resolves to:
```
node /path/to/agents/dist/cli/anvil.js
```

This is interpolated at runtime by the agent runner, ensuring the correct CLI is always used regardless of what's installed globally.

## Implementation

### 1. Update `runner.ts`

Add function to resolve CLI path and update template interpolation:

```typescript
import { dirname } from "path";
import { fileURLToPath } from "url";

function getAnvilCliPath(): string {
  // This file is at agents/dist/runner.js after build
  // CLI is at agents/dist/cli/anvil.js
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "cli", "anvil.js");
}

function buildSystemPrompt(config, context) {
  let prompt = config.systemPrompt ?? "";
  prompt = prompt.replace(/\{\{taskId\}\}/g, context.taskId ?? "none");
  prompt = prompt.replace(/\{\{branchName\}\}/g, context.branchName ?? "none");
  prompt = prompt.replace(/\{\{anvilCli\}\}/g, `node ${getAnvilCliPath()}`);
  return prompt;
}
```

### 2. Update `shared-prompts.ts`

Replace all `anvil` references with `{{anvilCli}}`:

```typescript
export const TASK_CONTEXT = `## Current Task Context

Task ID: {{taskId}}
Branch: {{branchName}}

Use \`{{anvilCli}} tasks get --id={{taskId}}\` to fetch current task state.`;

export const ANVIL_CLI_CORE = `## Anvil CLI Reference

\`\`\`bash
# Get task details
{{anvilCli}} tasks get --id=<task-id>
{{anvilCli}} tasks get --slug=<task-slug>

# Update task status
{{anvilCli}} tasks update --id=<task-id> --status=<status>
...
\`\`\``;
```

### 3. Update agent configs

Update `entrypoint.ts`, `execution.ts`, and `review.ts` to use `{{anvilCli}}` in their local prompt sections.

## Files Changed

- `agents/src/runner.ts` - Add `getAnvilCliPath()` and update `buildSystemPrompt()`
- `agents/src/agent-types/shared-prompts.ts` - Replace `anvil` with `{{anvilCli}}`
- `agents/src/agent-types/entrypoint.ts` - Replace `anvil` with `{{anvilCli}}`
- `agents/src/agent-types/execution.ts` - Replace `anvil` with `{{anvilCli}}`
- `agents/src/agent-types/review.ts` - Replace `anvil` with `{{anvilCli}}`

## Result

Agents will now execute commands like:
```bash
node /Users/zac/Documents/juice/anvil/anvil/agents/dist/cli/anvil.js tasks get --id=task-abc123
```

This bypasses any global `anvil` command and ensures the correct Node.js CLI is always used.

## Optional Cleanup

Remove the global Rust CLI wrapper if no longer needed:
```bash
rm /Users/zac/Library/pnpm/anvil
```
