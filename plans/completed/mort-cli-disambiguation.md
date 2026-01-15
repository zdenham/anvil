# Fix: Mort CLI Disambiguation

## Problem

When agents run `mort tasks get --id=...`, they get an error:

```
Error: Unknown tasks subcommand: get. Use: list, show, search, create, create-subtask, associate
```

This happens because there are **two different `mort` CLIs**:

1. **Rust CLI** (`/Users/zac/Library/pnpm/mort` → `src-tauri/target/debug/mort`)
   - Commands: `list, show, search, create, create-subtask, associate`

2. **Node.js CLI** (`agents/dist/cli/mort.js`)
   - Commands: `list, create, get, rename, update, delete, associate, disassociate`

The agent prompts reference the Node.js CLI's commands (`get`, `rename`, `update`), but the shell finds the Rust CLI first in PATH.

## Root Cause

- A global `mort` wrapper was installed at `/Users/zac/Library/pnpm/mort`
- This wrapper invokes the Rust binary from `src-tauri/target/debug/mort`
- The Rust CLI has a different command structure than the Node.js CLI
- Agent prompts say `mort tasks get ...` but the Rust CLI expects `mort tasks show ...`

## Solution

**Use absolute paths** to ensure agents always invoke the correct CLI.

Introduced a `{{mortCli}}` template variable that resolves to:
```
node /path/to/agents/dist/cli/mort.js
```

This is interpolated at runtime by the agent runner, ensuring the correct CLI is always used regardless of what's installed globally.

## Implementation

### 1. Update `runner.ts`

Add function to resolve CLI path and update template interpolation:

```typescript
import { dirname } from "path";
import { fileURLToPath } from "url";

function getMortCliPath(): string {
  // This file is at agents/dist/runner.js after build
  // CLI is at agents/dist/cli/mort.js
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "cli", "mort.js");
}

function buildSystemPrompt(config, context) {
  let prompt = config.systemPrompt ?? "";
  prompt = prompt.replace(/\{\{taskId\}\}/g, context.taskId ?? "none");
  prompt = prompt.replace(/\{\{branchName\}\}/g, context.branchName ?? "none");
  prompt = prompt.replace(/\{\{mortCli\}\}/g, `node ${getMortCliPath()}`);
  return prompt;
}
```

### 2. Update `shared-prompts.ts`

Replace all `mort` references with `{{mortCli}}`:

```typescript
export const TASK_CONTEXT = `## Current Task Context

Task ID: {{taskId}}
Branch: {{branchName}}

Use \`{{mortCli}} tasks get --id={{taskId}}\` to fetch current task state.`;

export const MORT_CLI_CORE = `## Mort CLI Reference

\`\`\`bash
# Get task details
{{mortCli}} tasks get --id=<task-id>
{{mortCli}} tasks get --slug=<task-slug>

# Update task status
{{mortCli}} tasks update --id=<task-id> --status=<status>
...
\`\`\``;
```

### 3. Update agent configs

Update `entrypoint.ts`, `execution.ts`, and `review.ts` to use `{{mortCli}}` in their local prompt sections.

## Files Changed

- `agents/src/runner.ts` - Add `getMortCliPath()` and update `buildSystemPrompt()`
- `agents/src/agent-types/shared-prompts.ts` - Replace `mort` with `{{mortCli}}`
- `agents/src/agent-types/entrypoint.ts` - Replace `mort` with `{{mortCli}}`
- `agents/src/agent-types/execution.ts` - Replace `mort` with `{{mortCli}}`
- `agents/src/agent-types/review.ts` - Replace `mort` with `{{mortCli}}`

## Result

Agents will now execute commands like:
```bash
node /Users/zac/Documents/juice/mort/mortician/agents/dist/cli/mort.js tasks get --id=task-abc123
```

This bypasses any global `mort` command and ensures the correct Node.js CLI is always used.

## Optional Cleanup

Remove the global Rust CLI wrapper if no longer needed:
```bash
rm /Users/zac/Library/pnpm/mort
```
