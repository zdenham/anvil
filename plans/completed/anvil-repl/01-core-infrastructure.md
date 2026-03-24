# Phase 1: Core Infrastructure

Implement the hook interception and code execution pipeline. No spawning yet — just get `anvil-repl "return 42"` working end-to-end.

**No new dependencies required.** Uses `typescript` (already in `agents/package.json`) for type stripping via `ts.transpileModule()`.

## Implementation

### 1. `agents/src/lib/anvil-repl/types.ts`

```typescript
export interface ReplContext {
  threadId: string;
  repoId: string;
  worktreeId: string;
  workingDir: string;
  permissionModeId: string;
  anvilDir: string;
}

export interface ReplResult {
  success: boolean;
  value: unknown;      // return value from the code
  logs: string[];      // anvil.log() output
  error?: string;      // error message if success=false
  durationMs: number;
}
```

### 2. `agents/src/lib/anvil-repl/repl-runner.ts`

The `AnvilReplRunner` class:
- `extractCode(command: string): string | null` — parses `anvil-repl` command to extract code body
  - Supports heredoc: `anvil-repl <<'ANVIL_REPL'\n...\nANVIL_REPL`
  - Supports quoted string: `anvil-repl "code"` or `anvil-repl 'code'`
- `execute(code: string, context: ReplContext): Promise<ReplResult>` — strips types via `ts.transpileModule()`, creates `AsyncFunction`, runs it with injected `anvil` SDK, captures result
- `formatResult(result: ReplResult): string` — formats for deny reason output

Code execution pattern:
```typescript
import ts from "typescript";

// Strip types (no-op for plain JS)
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
});

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const fn = new AsyncFunction('anvil', outputText);
const result = await fn(sdk);
```

### 3. `agents/src/hooks/repl-hook.ts`

Similar to `comment-resolution-hook.ts`:
- Match `Bash` tool calls where command starts with `anvil-repl`
- Extract code via `AnvilReplRunner.extractCode()`
- Execute via `AnvilReplRunner.execute()`
- Return deny with `formatResult()` as reason

Dependencies injected via factory function:
```typescript
interface ReplHookDeps {
  context: ReplContext;
  emitEvent: (name: string, payload: Record<string, unknown>) => void;
  toolUseId?: string;  // for parent-child mapping later
}
```

### 4. `agents/src/runners/shared.ts`

Add the repl hook to PreToolUse chain, **before** the comment resolution hook (line ~531):
```typescript
// REPL hook — intercepts anvil-repl Bash calls
{
  matcher: "Bash" as const,
  hooks: [
    createReplHook({
      context: { threadId, repoId, worktreeId, workingDir, permissionModeId, anvilDir },
      emitEvent,
    }),
  ],
},
```

### 5. `agents/src/lib/anvil-repl/index.ts`

Barrel export for `AnvilReplRunner`, types, and hook factory.

## Code Extraction Patterns

The heredoc pattern is preferred (handles multi-line code cleanly):
```bash
anvil-repl <<'ANVIL_REPL'
const x = 1 + 1;
return x;
ANVIL_REPL
```

Also support single-line quoted:
```bash
anvil-repl "return 42"
```

Regex for heredoc extraction:
```
/anvil-repl\s+<<['"]?(\w+)['"]?\n([\s\S]*?)\n\1/
```

Regex for quoted extraction:
```
/anvil-repl\s+["']([\s\S]*?)["']/
```

## Validation

After this phase, the following should work:
- Agent calls `anvil-repl "return 42"` → gets `anvil-repl result: 42` back
- Agent calls `anvil-repl "anvil.log('hello'); return 'done'"` → gets `anvil-repl result: "done"` with log captured
- Invalid code → gets clear error message
- Non-anvil-repl bash commands pass through unchanged
