# Agent Runner (Node.js)

Creates the Node.js agent runner that uses `@anthropic-ai/claude-agent-sdk` to execute agents.

**Documentation:**

- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/api/agent-sdk/typescript)
- [Hooks Guide](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [NPM Package](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)

## Responsibility Boundary

The agent runner is a **stateless executor**. It:

- Receives a pre-created conversation ID and path from the frontend
- Writes raw message streams (`messages.jsonl`, `changes.jsonl`) to the conversation path
- Emits JSONL to stdout for real-time streaming
- Does NOT manage entity state (that's the frontend's job via `conversationService`)

**Entity state is managed by the frontend:**

- `conversationService.create()` creates the conversation before spawning runner
- `conversationService.update()` updates status/turns after runner completes
- Entity types are defined in `src/entities/conversations/types.ts`

## Type Strategy

**SDK types from `@anthropic-ai/sdk`:**

- `ContentBlock`, `TextBlock`, `ToolUseBlock` (message content)
- `Message`, `MessageParam` (API messages)
- Tool input/output types

**Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`):**

- `SDKMessage` - union type for all message types (assistant, user, system, result, stream_event)
- `SDKAssistantMessage`, `SDKSystemMessage`, `SDKResultMessage` - specific message types
- `HookCallback`, `PreToolUseHookInput`, `PostToolUseHookInput` - hook types
- `Options` - full configuration type

**App-specific types (defined in runner):**

- `FileChangeMessage` - tracks file modifications (computed via git diff after tool use)
- `CompleteMessage` - run completion with metrics

## Files Owned

```
agents/
├── package.json
├── tsconfig.json
├── src/
│   ├── runner.ts          # Main entry point, handles CLI args
│   ├── agent-types/       # Agent type definitions
│   │   ├── index.ts       # Registry of available agents
│   │   └── simplifier.ts  # Port of legacy-simplifier logic
│   ├── git.ts             # Git utilities (branch management)
│   ├── output.ts          # Dual output utilities (stdout + file)
│   └── types.ts           # Re-exports from src/lib/types/agent-messages.ts
```

## Dependencies

- `@anthropic-ai/claude-agent-sdk` - Agent execution framework
- `@anthropic-ai/sdk` - **Required for types** (installed explicitly, not just as peer dep)

## Implementation

### 1. Create package.json

```json
{
  "name": "@mort/agents",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist/runner.js",
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "@anthropic-ai/sdk": "^0.52.0" // Explicit dependency - we use its types directly
  },
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^5.7"
  }
}
```

**Note:** `@anthropic-ai/sdk` is listed as an explicit dependency (not just peer dep) because we import and use its types throughout our code.

### 2. Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

### 3. Implement runner.ts

```typescript
import {
  query,
  type SDKMessage,
  type HookCallback,
  type PostToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "fs";
import {
  initOutput,
  emitMessage,
  emitComplete,
  emitError,
  emitToolResult,
  emitFileChange,
} from "./output.js";
import { getAgentConfig } from "./agent-types/index.js";
import {
  createTaskBranch,
  generateTaskDiff,
  getChangedFilesSinceHead,
  getFileDiff,
  isBinaryFile,
} from "./git.js";

interface Args {
  agentType: string;
  cwd: string;
  prompt: string;
  conversationId: string;
  conversationPath: string; // Path provided by frontend (already created by conversationService)
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--agent":
        args.agentType = argv[++i];
        break;
      case "--cwd":
        args.cwd = argv[++i];
        break;
      case "--prompt":
        args.prompt = argv[++i];
        break;
      case "--conversation-id":
        args.conversationId = argv[++i];
        break;
      case "--conversation-path":
        args.conversationPath = argv[++i];
        break;
    }
  }

  if (
    !args.agentType ||
    !args.cwd ||
    !args.prompt ||
    !args.conversationId ||
    !args.conversationPath
  ) {
    throw new Error("Missing required arguments");
  }

  return args as Args;
}

// File-modifying tools that should trigger diff emission
const FILE_MODIFYING_TOOLS = new Set(["Write", "Edit", "Bash"]);

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Ensure conversation directory exists (may already exist from conversationService)
  mkdirSync(args.conversationPath, { recursive: true });

  // Create and checkout task branch (use conversationId as branch identifier)
  const taskBranch = `mort/${args.conversationId}`;
  createTaskBranch(args.cwd, taskBranch);

  // Initialize dual output (stdout + file)
  initOutput(args.conversationPath);

  const agentConfig = getAgentConfig(args.agentType);
  const startTime = Date.now();

  // NOTE: Conversation metadata is managed by the frontend via conversationService.
  // The runner only writes raw message streams (messages.jsonl, changes.jsonl).

  // Track files we've already emitted diffs for (to detect new changes)
  const lastKnownDiffs = new Map<string, string>();

  /**
   * PostToolUse hook: Emit tool results and detect file changes via git.
   *
   * Per SDK docs (https://platform.claude.com/docs/en/agent-sdk/hooks):
   * - HookCallback signature: (input, toolUseID, { signal }) => Promise<HookJSONOutput>
   * - PostToolUseHookInput includes: tool_name, tool_input, tool_response, cwd, session_id
   */
  const postToolUseHook: HookCallback = async (
    input,
    toolUseID,
    { signal }
  ) => {
    const hookInput = input as PostToolUseHookInput;

    // Emit the tool result
    emitToolResult({
      toolUseId: toolUseID ?? "unknown",
      toolName: hookInput.tool_name,
      content:
        typeof hookInput.tool_response === "string"
          ? hookInput.tool_response
          : JSON.stringify(hookInput.tool_response),
    });

    // For file-modifying tools, check git for changes and emit FileChangeMessages
    if (FILE_MODIFYING_TOOLS.has(hookInput.tool_name)) {
      const changedFiles = getChangedFilesSinceHead(args.cwd);

      for (const file of changedFiles) {
        // Skip binary files
        if (isBinaryFile(args.cwd, file.path)) {
          continue;
        }

        // Get the full cumulative diff from HEAD
        const diff = getFileDiff(args.cwd, file.path);

        // Only emit if diff has changed since last emission for this file
        if (diff && diff !== lastKnownDiffs.get(file.path)) {
          lastKnownDiffs.set(file.path, diff);
          emitFileChange({
            path: file.path,
            operation: file.operation,
            diff,
          });
        }
      }
    }

    // Return empty object to continue execution
    // Per SDK: { continue: true } is not needed, just return {}
    return {};
  };

  try {
    /**
     * query() returns an AsyncGenerator<SDKMessage, void>
     *
     * Per SDK docs (https://platform.claude.com/docs/en/api/agent-sdk/typescript):
     * - Options.permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
     * - Options.allowDangerouslySkipPermissions: required when permissionMode is 'bypassPermissions'
     * - Options.hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>
     * - HookCallbackMatcher: { matcher?: string, hooks: HookCallback[], timeout?: number }
     */
    const result = query({
      prompt: args.prompt,
      options: {
        cwd: args.cwd,
        model: agentConfig.model ?? "claude-opus-4-5-20251101",
        systemPrompt: agentConfig.systemPrompt,
        allowedTools: agentConfig.tools ?? [
          "Read",
          "Write",
          "Edit",
          "Glob",
          "Grep",
          "Bash",
        ],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: false,
        hooks: {
          PostToolUse: [
            {
              // No matcher = match all tools
              hooks: [postToolUseHook],
              timeout: 30, // 30 second timeout for hook
            },
          ],
        },
      },
    });

    for await (const message of result) {
      handleMessage(message);
    }

    // Generate git diff of all changes on the task branch
    const diff = generateTaskDiff(args.cwd, taskBranch);
    const endTime = Date.now();

    // Emit completion message - frontend will update entity status via conversationService
    emitComplete({
      durationMs: endTime - startTime,
      success: true,
      diff,
    });
    // Exit with success code - frontend uses this to determine status
    process.exit(0);
  } catch (error) {
    // Emit error - frontend will update entity status via conversationService
    emitError(error instanceof Error ? error.message : String(error));
    // Exit with error code - frontend uses this to determine status
    process.exit(1);
  }
}

/**
 * Handle SDK messages and emit to stdout/file.
 *
 * SDKMessage types (per SDK docs):
 * - 'system' with subtype 'init': Initial session info (model, tools, cwd)
 * - 'assistant': Assistant response with message.content array (TextBlock, ToolUseBlock, etc.)
 * - 'result' with subtype 'success': Completion metrics (duration_ms, total_cost_usd, num_turns)
 * - 'result' with subtype 'error_*': Error information
 * - 'stream_event': Partial messages (only when includePartialMessages: true)
 */
function handleMessage(message: SDKMessage) {
  switch (message.type) {
    case "system":
      if (message.subtype === "init") {
        emitMessage({
          type: "system",
          subtype: "init",
          model: message.model,
          tools: message.tools,
        });
      }
      break;

    case "assistant":
      // SDKAssistantMessage.message is the Anthropic API Message type
      // message.message.content is ContentBlock[] (TextBlock | ToolUseBlock | ThinkingBlock | etc.)
      for (const block of message.message.content) {
        if (block.type === "text") {
          emitMessage({ type: "text", content: block.text });
        } else if (block.type === "thinking") {
          emitMessage({ type: "thinking", content: block.thinking });
        } else if (block.type === "tool_use") {
          emitMessage({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }
      break;

    case "result":
      if (message.subtype === "success") {
        // SDKResultMessage with subtype 'success' includes:
        // duration_ms, duration_api_ms, total_cost_usd, num_turns, usage, result
        emitMessage({
          type: "result_metrics",
          durationApiMs: message.duration_api_ms,
          totalCostUsd: message.total_cost_usd,
          numTurns: message.num_turns,
        });
      }
      break;
  }
}

main();
```

### 4. Implement git.ts

```typescript
import { execSync, execFileSync } from "child_process";

export interface ChangedFile {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
}

/**
 * Create and checkout a task branch. If it already exists, just checkout.
 */
export function createTaskBranch(cwd: string, branchName: string): void {
  try {
    // Check if branch exists
    execFileSync(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
      { cwd }
    );
    // Branch exists, checkout
    execFileSync("git", ["checkout", branchName], { cwd, stdio: "pipe" });
  } catch {
    // Branch doesn't exist, create and checkout
    execFileSync("git", ["checkout", "-b", branchName], { cwd, stdio: "pipe" });
  }
}

/**
 * Generate a git diff of all changes made on the task branch.
 */
export function generateTaskDiff(
  cwd: string,
  taskBranch: string
): string | undefined {
  try {
    // Try to find merge base with main, master, or just use HEAD~1
    let mergeBase: string;
    try {
      mergeBase = execFileSync("git", ["merge-base", "main", taskBranch], {
        cwd,
        encoding: "utf-8",
      }).trim();
    } catch {
      try {
        mergeBase = execFileSync("git", ["merge-base", "master", taskBranch], {
          cwd,
          encoding: "utf-8",
        }).trim();
      } catch {
        // Fallback: diff against the commit before branch was created
        mergeBase = execFileSync("git", ["rev-parse", "HEAD~1"], {
          cwd,
          encoding: "utf-8",
        }).trim();
      }
    }

    const diff = execFileSync("git", ["diff", mergeBase, "HEAD"], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB max
    });

    return diff || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get list of files changed since HEAD (working directory changes).
 * Uses `git status --porcelain` to detect all changed, added, and deleted files.
 */
export function getChangedFilesSinceHead(cwd: string): ChangedFile[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf-8",
    });

    const files: ChangedFile[] = [];

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;

      // git status --porcelain format: XY filename
      // X = index status, Y = working tree status
      const status = line.substring(0, 2);
      let path = line.substring(3);

      // Handle renamed files: "R  old -> new"
      if (status.startsWith("R")) {
        const parts = path.split(" -> ");
        path = parts[1] || path;
        files.push({ path, operation: "rename" });
        continue;
      }

      // Determine operation from status
      let operation: ChangedFile["operation"];
      if (status.includes("A") || status === "??") {
        operation = "create";
      } else if (status.includes("D")) {
        operation = "delete";
      } else {
        operation = "modify";
      }

      files.push({ path, operation });
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Get the full cumulative diff for a specific file from HEAD.
 * Returns the unified diff output, or undefined if file is unchanged or error.
 */
export function getFileDiff(cwd: string, filePath: string): string | undefined {
  try {
    // Use execFileSync with array args to avoid shell injection
    const diff = execFileSync("git", ["diff", "HEAD", "--", filePath], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024, // 5MB max per file
    });

    return diff || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check if a file is binary using git's detection.
 */
export function isBinaryFile(cwd: string, filePath: string): boolean {
  try {
    // git diff --numstat shows binary files as "-\t-\tfilename"
    const output = execFileSync(
      "git",
      ["diff", "--numstat", "HEAD", "--", filePath],
      {
        cwd,
        encoding: "utf-8",
      }
    );

    // Binary files show as: -\t-\tfilename
    return output.startsWith("-\t-\t");
  } catch {
    // If we can't determine, assume not binary
    return false;
  }
}
```

### 5. Implement output.ts

```typescript
import { appendFileSync, writeFileSync } from "fs";
import { join } from "path";

let messagesPath: string;
let changesPath: string;

interface BaseMessage {
  timestamp?: number;
  [key: string]: unknown;
}

export function initOutput(conversationPath: string): void {
  messagesPath = join(conversationPath, "messages.jsonl");
  changesPath = join(conversationPath, "changes.jsonl");
  writeFileSync(messagesPath, "");
  writeFileSync(changesPath, "");
}

function emit(message: BaseMessage): void {
  const fullMessage = { ...message, timestamp: Date.now() };

  // Write to stdout for real-time streaming to frontend
  console.log(JSON.stringify(fullMessage));

  // Append to JSONL file for persistence
  appendFileSync(messagesPath, JSON.stringify(fullMessage) + "\n");
}

export function emitMessage(message: BaseMessage): void {
  emit(message);
}

export function emitToolResult(data: {
  toolUseId: string;
  toolName: string;
  content: string;
}): void {
  emit({
    type: "tool_result",
    tool_use_id: data.toolUseId,
    tool_name: data.toolName,
    content: data.content,
  });
}

/**
 * Emit a file change message. Written to both stdout and changes.jsonl.
 * Each emission contains the FULL cumulative diff from HEAD (not a delta).
 * Later messages for the same file supersede earlier ones entirely.
 */
export function emitFileChange(data: {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  oldPath?: string;
  diff: string;
}): void {
  const message = {
    type: "file_change",
    path: data.path,
    operation: data.operation,
    oldPath: data.oldPath,
    diff: data.diff,
    timestamp: Date.now(),
  };

  // Write to stdout for real-time streaming to frontend
  console.log(JSON.stringify(message));

  // Append to changes.jsonl (separate from messages.jsonl for efficient diff viewing)
  appendFileSync(changesPath, JSON.stringify(message) + "\n");
}

export function emitComplete(data: {
  durationMs: number;
  success: boolean;
  diff?: string;
}): void {
  emit({ type: "complete", ...data });
}

export function emitError(message: string): void {
  emit({ type: "error", message });
}
```

### 6. Implement agent-types/index.ts

```typescript
export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  systemPrompt?: string;
  tools?: string[] | { type: "preset"; preset: "claude_code" };
}

const agents: Record<string, AgentConfig> = {
  simplifier: {
    name: "Simplifier",
    description: "Simplifies and refactors code",
    systemPrompt: `You are a code simplifier. Your goal is to make code cleaner,
more readable, and easier to maintain. Focus on:
- Removing unnecessary complexity
- Improving naming
- Breaking down large functions
- Eliminating dead code`,
  },
};

export function getAgentConfig(type: string): AgentConfig {
  const config = agents[type];
  if (!config) {
    throw new Error(`Unknown agent type: ${type}`);
  }
  return config;
}

export function listAgentTypes(): string[] {
  return Object.keys(agents);
}
```

## Prompt Caching Strategy

The Claude Agent SDK does **not** automatically handle prompt caching. We must implement it manually to reduce costs and latency for multi-turn conversations.

### Cache Hierarchy

Claude's cache operates hierarchically: `tools` → `system` → `messages`. We leverage this by placing cache breakpoints strategically:

1. **Tool definitions** - Rarely change, cache at the tools level
2. **System prompt** - Static per agent type, cache separately
3. **Message history** - Mark the final message block to enable incremental caching

### Implementation Approach

When continuing an existing conversation (passing message history), add `cache_control` to:

```typescript
// System prompt with cache control
const systemPromptWithCache = [
  {
    type: "text",
    text: agentConfig.systemPrompt,
    cache_control: { type: "ephemeral" }, // 5-minute TTL, refreshed on use
  },
];

// For multi-turn: mark the last message in history for caching
function addCacheControlToHistory(messages: MessageParam[]): MessageParam[] {
  if (messages.length === 0) return messages;

  const lastIdx = messages.length - 1;
  const lastMessage = messages[lastIdx];

  // Add cache_control to the last content block of the last message
  if (Array.isArray(lastMessage.content)) {
    const content = [...lastMessage.content];
    const lastBlockIdx = content.length - 1;
    content[lastBlockIdx] = {
      ...content[lastBlockIdx],
      cache_control: { type: "ephemeral" },
    };
    return [...messages.slice(0, lastIdx), { ...lastMessage, content }];
  }

  return messages;
}
```

### Cache Control in query() Options

The SDK's `query()` function accepts message history. When implementing multi-turn support (see feedback item 6), structure calls like:

```typescript
const result = query({
  prompt: newUserPrompt,
  options: {
    // ... other options
    systemPrompt: systemPromptWithCache, // Cached system prompt
    messages: addCacheControlToHistory(previousMessages), // Cached history
  },
});
```

### Cache Metrics

The SDK's result message includes usage data. Track cache performance:

- `cache_read_input_tokens` - Tokens read from cache (10% cost)
- `cache_creation_input_tokens` - Tokens written to cache (125% cost)
- `input_tokens` - New tokens not in cache (100% cost)

Emit these in the `result_metrics` message for monitoring cache effectiveness.

### Minimum Cacheable Size

- **1,024 tokens** for Claude Sonnet models
- **4,096 tokens** for Claude Opus 4.5 and Haiku 4.5

System prompts and accumulated conversation history typically exceed these thresholds.

### Cache Invalidation

Cache is invalidated when:

- Tool definitions change
- System prompt changes
- Images are added/removed
- Extended thinking settings change

Cache persists through:

- New user messages (only new content is processed)
- Tool results being added
- Regular conversation continuation

## Testing

1. Build: `cd agents && pnpm install && pnpm build`
2. Run manually:

   ```bash
   # First create the conversation directory (simulates what conversationService.create() does)
   mkdir -p /path/to/repo/.mort/conversations/test-conv-123

   ANTHROPIC_API_KEY=xxx node agents/dist/runner.js \
     --agent simplifier \
     --cwd /path/to/repo \
     --prompt "Simplify the auth module" \
     --conversation-id test-conv-123 \
     --conversation-path /path/to/repo/.mort/conversations/test-conv-123
   ```

3. Verify stdout outputs JSONL messages
4. Verify `/path/to/repo/.mort/conversations/test-conv-123/messages.jsonl` is created and matches stdout
5. Verify git branch `mort/test-conv-123` is created and checked out
6. Verify exit code is 0 on success, 1 on error
