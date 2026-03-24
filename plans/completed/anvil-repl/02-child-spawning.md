# Phase 2: Child Spawning

Implement `anvil.spawn()` so the REPL can create and wait for child agent processes.

## Implementation

### 1. `agents/src/lib/anvil-repl/child-spawner.ts`

`ChildSpawner` class handles the full lifecycle:

```typescript
class ChildSpawner {
  constructor(
    private context: ReplContext,
    private emitEvent: EmitEventFn,
    private parentToolUseId: string,  // Bash call's tool_use_id for UI mapping
  ) {}

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    // 1. Create thread metadata + state on disk
    // 2. Emit thread:created event
    // 3. Spawn child process
    // 4. Wait for exit
    // 5. Read result from child's state.json
    // 6. Return structured result
  }
}
```

#### Step 1: Create thread on disk

Reuses exact same pattern as `shared.ts:734-782` (PreToolUse:Task hook):
- Generate `childThreadId = crypto.randomUUID()`
- Create `~/.anvil/threads/{childThreadId}/metadata.json` with:
  - `parentThreadId: context.threadId`
  - `parentToolUseId` (the Bash call's tool_use_id)
  - `agentType` from options
  - `permissionMode` from options or parent's mode
- Create `state.json` with initial user message

#### Step 2: Emit thread:created

```typescript
this.emitEvent(EventName.THREAD_CREATED, {
  threadId: childThreadId,
  repoId: this.context.repoId,
  worktreeId: this.context.worktreeId,
});
```

This makes the child appear in the sidebar immediately.

#### Step 3: Spawn child process

```typescript
import { spawn } from "child_process";
import { runnerPath } from "../../runner.js"; // agents/src/runner.ts:11 exports fileURLToPath(import.meta.url) → agents/dist/runner.js

const child = spawn("node", [
  runnerPath,
  "--thread-id", childThreadId,
  "--repo-id", this.context.repoId,
  "--worktree-id", this.context.worktreeId,
  "--cwd", options.cwd ?? this.context.workingDir,
  "--prompt", options.prompt,
  "--anvil-dir", this.context.anvilDir,
  "--parent-id", this.context.threadId,
  ...(permissionMode ? ["--permission-mode", permissionMode] : []),
  "--skip-naming",  // parent handles naming via thread-naming-service
], {
  stdio: "pipe",
  env: { ...process.env },
  detached: false,
});
```

#### Step 4: Wait for exit

```typescript
const exitCode = await new Promise<number>((resolve) => {
  child.on("exit", (code) => resolve(code ?? 1));
});
```

#### Step 5: Read result

```typescript
const statePath = join(this.context.anvilDir, "threads", childThreadId, "state.json");
const state = JSON.parse(readFileSync(statePath, "utf-8"));

// Extract last assistant message
const lastAssistant = state.messages
  ?.filter((m: any) => m.role === "assistant")
  ?.pop();

const resultText = lastAssistant?.content
  ?.filter((c: any) => c.type === "text")
  ?.map((c: any) => c.text)
  ?.join("\n") ?? "";
```

### 2. `agents/src/lib/anvil-repl/anvil-sdk.ts`

Wire `ChildSpawner` into the `AnvilReplSdk`:

```typescript
class AnvilReplSdk {
  private spawner: ChildSpawner;
  private _logs: string[] = [];

  constructor(spawner: ChildSpawner, context: ReplContext) {
    this.spawner = spawner;
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    return this.spawner.spawn(options);
  }

  log(message: string): void {
    this._logs.push(message);
    logger.info(`[anvil-repl] ${message}`);
  }

  get context(): ReplContext {
    return { ...this._context };
  }

  get logs(): string[] {
    return this._logs;
  }
}
```

### 3. Update `repl-runner.ts`

Pass `toolUseId` from the hook through to `ChildSpawner` so spawned children get the correct `parentToolUseId`.

### 4. Thread naming

Fire-and-forget `generateThreadName()` for each spawned child (same as PreToolUse:Task hook does).

## Types

```typescript
export interface SpawnOptions {
  prompt: string;
  agentType?: string;        // default: "general-purpose"
  cwd?: string;              // default: parent's workingDir
  permissionMode?: string;   // default: parent's permissionModeId
}

export interface SpawnResult {
  threadId: string;
  status: "completed" | "error" | "cancelled";
  exitCode: number;
  result: string;            // last assistant message text
  durationMs: number;
}
```

## Result Truncation

Child results could be very large. Truncate `result` to 50KB with a trailing `... [truncated, full output in thread {threadId}]`.

## Process Cleanup

`ChildSpawner` registers `process.on("exit", () => killAllChildren())` in its constructor. This piggybacks on the existing signal handling in `runner.ts` (which calls `process.exit()` on SIGTERM/SIGINT), so children get cleaned up automatically without modifying the runner's signal handlers.

```typescript
// In ChildSpawner constructor
process.on("exit", () => {
  for (const pid of this.activePids) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ }
  }
});
```
