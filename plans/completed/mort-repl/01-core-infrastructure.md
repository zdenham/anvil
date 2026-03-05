# Phase 1: Core Infrastructure

Implement the hook interception and code execution pipeline. No spawning yet — just get `mort-repl "return 42"` working end-to-end.

**No new dependencies required.** Uses `typescript` (already in `agents/package.json`) for type stripping via `ts.transpileModule()`.

## Implementation

### 1. `agents/src/lib/mort-repl/types.ts`

```typescript
export interface ReplContext {
  threadId: string;
  repoId: string;
  worktreeId: string;
  workingDir: string;
  permissionModeId: string;
  mortDir: string;
}

export interface ReplResult {
  success: boolean;
  value: unknown;      // return value from the code
  logs: string[];      // mort.log() output
  error?: string;      // error message if success=false
  durationMs: number;
}
```

### 2. `agents/src/lib/mort-repl/repl-runner.ts`

The `MortReplRunner` class:
- `extractCode(command: string): string | null` — parses `mort-repl` command to extract code body
  - Supports heredoc: `mort-repl <<'MORT_REPL'\n...\nMORT_REPL`
  - Supports quoted string: `mort-repl "code"` or `mort-repl 'code'`
- `execute(code: string, context: ReplContext): Promise<ReplResult>` — strips types via `ts.transpileModule()`, creates `AsyncFunction`, runs it with injected `mort` SDK, captures result
- `formatResult(result: ReplResult): string` — formats for deny reason output

Code execution pattern:
```typescript
import ts from "typescript";

// Strip types (no-op for plain JS)
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
});

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const fn = new AsyncFunction('mort', outputText);
const result = await fn(sdk);
```

### 3. `agents/src/hooks/repl-hook.ts`

Similar to `comment-resolution-hook.ts`:
- Match `Bash` tool calls where command starts with `mort-repl`
- Extract code via `MortReplRunner.extractCode()`
- Execute via `MortReplRunner.execute()`
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
// REPL hook — intercepts mort-repl Bash calls
{
  matcher: "Bash" as const,
  hooks: [
    createReplHook({
      context: { threadId, repoId, worktreeId, workingDir, permissionModeId, mortDir },
      emitEvent,
    }),
  ],
},
```

### 5. `agents/src/lib/mort-repl/index.ts`

Barrel export for `MortReplRunner`, types, and hook factory.

## Code Extraction Patterns

The heredoc pattern is preferred (handles multi-line code cleanly):
```bash
mort-repl <<'MORT_REPL'
const x = 1 + 1;
return x;
MORT_REPL
```

Also support single-line quoted:
```bash
mort-repl "return 42"
```

Regex for heredoc extraction:
```
/mort-repl\s+<<['"]?(\w+)['"]?\n([\s\S]*?)\n\1/
```

Regex for quoted extraction:
```
/mort-repl\s+["']([\s\S]*?)["']/
```

## Validation

After this phase, the following should work:
- Agent calls `mort-repl "return 42"` → gets `mort-repl result: 42` back
- Agent calls `mort-repl "mort.log('hello'); return 'done'"` → gets `mort-repl result: "done"` with log captured
- Invalid code → gets clear error message
- Non-mort-repl bash commands pass through unchanged
