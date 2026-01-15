# 02 - Agent Runner (Node)

**Parallelizable:** Yes (no dependencies)
**Estimated scope:** 3 files created, 1 file modified

## Overview

Create the simplified agent runner that operates directly on the source repository without worktree allocation or branch management.

## Tasks

### 1. Create simple agent config

**File:** `agents/src/agent-types/simple.ts`

```typescript
import type { AgentConfig } from "./index.js";

export const simple: AgentConfig = {
  name: "simple",
  description: "Simple Claude Code agent - runs directly in repository",
  model: "claude-sonnet-4-20250514",
  tools: { type: "preset", preset: "claude_code" },
  appendedPrompt: `## Context

You are helping the user with a task in their codebase.

- Task ID: {{taskId}}
- Thread ID: {{threadId}}

Work directly in the current repository. Make changes as requested.
Request human review when you need input or approval.`,
};
```

### 2. Register simple agent config

**File:** `agents/src/agent-types/index.ts`

Add import and registration:

```typescript
import { simple } from "./simple.js";

// In the agentConfigs object or registry:
export const agentConfigs = {
  // ... existing configs
  simple,
};
```

### 3. Create argument parser

**File:** `agents/src/simple-runner-args.ts` (~50 lines)

```typescript
import { logger } from "./lib/logger.js";

export interface SimpleArgs {
  taskId: string;
  threadId: string;
  prompt: string;
  cwd: string;
  mortDir: string;
  historyFile?: string;
}

export function parseSimpleArgs(argv: string[]): SimpleArgs {
  const args: Partial<SimpleArgs> = {};

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--task-id":
        args.taskId = argv[++i];
        break;
      case "--thread-id":
        args.threadId = argv[++i];
        break;
      case "--prompt":
        args.prompt = argv[++i];
        break;
      case "--cwd":
        args.cwd = argv[++i];
        break;
      case "--mort-dir":
        args.mortDir = argv[++i];
        break;
      case "--history-file":
        args.historyFile = argv[++i];
        break;
    }
  }

  if (!args.taskId || !args.threadId || !args.prompt || !args.cwd || !args.mortDir) {
    logger.error("Missing required arguments: --task-id, --thread-id, --prompt, --cwd, --mort-dir");
    throw new Error("Missing required arguments");
  }

  return args as SimpleArgs;
}
```

### 4. Create simple runner entry point

**File:** `agents/src/simple-runner.ts` (~150 lines)

Key points:
- Parse args via `parseSimpleArgs()`
- Create task metadata in `~/.mort/simple-tasks/{taskId}/metadata.json`
- Create thread directory: `~/.mort/simple-tasks/{taskId}/threads/simple-{threadId}/`
- Write `metadata.json` for thread
- Use existing `output.ts` functions: `initState()`, `appendUserMessage()`, `appendAssistantMessage()`, etc.
- Call `query()` from Claude Agent SDK with `claude_code` preset
- Handle resume via `--history-file` argument
- Emit `thread:created` event via stdout protocol

Reference the full implementation from the parent plan's Step 3.

### 5. Update build config

**File:** `agents/package.json` or `agents/tsconfig.json`

Ensure `simple-runner.ts` is included in the build output.

Add npm script if needed:
```json
{
  "scripts": {
    "build:simple-runner": "..."
  }
}
```

## Verification

```bash
cd agents
pnpm build
# Verify agents/dist/simple-runner.js exists
node agents/dist/simple-runner.js --help
# Should show usage or error about missing args
```
