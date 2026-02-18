# Sub-Plan 01: Permission Evaluator (Agent-Side)

**Depends on:** `00-shared-contract.md`
**Parallel with:** `02-permission-hook.md`, `03-permission-ui.md`

Pure logic, no I/O, no frontend — this is the rules engine that decides allow/deny/ask for each tool call.

## Phases

- [x] Implement `PermissionEvaluator` class
- [x] Write unit tests for evaluator

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Implement `PermissionEvaluator`

Create `agents/src/lib/permission-evaluator.ts` (~80 lines).

### Class interface

```typescript
import type {
  PermissionConfig,
  PermissionModeDefinition,
  PermissionRule,
  EvaluatorDecision,
} from "@core/types/permissions.js";

export interface EvaluatorResult {
  decision: EvaluatorDecision;
  reason: string;
}

export class PermissionEvaluator {
  private overrides: PermissionRule[];
  private mode: PermissionModeDefinition;
  private workingDirectory: string;

  constructor(config: PermissionConfig);

  /** Swap the active mode mid-run. Override rules are unaffected. */
  setMode(mode: PermissionModeDefinition): void;

  /** Get the current mode ID */
  getModeId(): PermissionModeId;

  /** Evaluate a tool call against overrides → mode rules → default */
  evaluate(toolName: string, toolInput: unknown): EvaluatorResult;
}
```

### Path normalization

Extract `file_path` from `toolInput` and normalize to relative:

```typescript
function normalizeToRelativePath(absolutePath: string, workingDirectory: string): string {
  if (absolutePath.startsWith(workingDirectory)) {
    return absolutePath.slice(workingDirectory.length).replace(/^\//, "");
  }
  return absolutePath; // outside working directory — return as-is
}
```

### Field extraction from toolInput

```typescript
function extractFilePath(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const obj = toolInput as Record<string, unknown>;
  if (typeof obj.file_path === "string") return obj.file_path;
  if (typeof obj.path === "string") return obj.path;       // Glob tool
  if (typeof obj.pattern === "string") return obj.pattern;  // fallback for Glob
  return undefined;
}

function extractCommand(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const obj = toolInput as Record<string, unknown>;
  return typeof obj.command === "string" ? obj.command : undefined;
}
```

### Rule matching

```typescript
function matchesRule(
  rule: PermissionRule,
  toolName: string,
  filePath: string | undefined,
  command: string | undefined,
): boolean {
  // Tool name must match
  if (!new RegExp(rule.toolPattern).test(toolName)) return false;

  // If rule has pathPattern, filePath must exist and match
  if (rule.pathPattern !== undefined) {
    if (filePath === undefined) return false;
    if (!new RegExp(rule.pathPattern).test(filePath)) return false;
  }

  // If rule has commandPattern, command must exist and match
  if (rule.commandPattern !== undefined) {
    if (command === undefined) return false;
    if (!new RegExp(rule.commandPattern).test(command)) return false;
  }

  return true;
}
```

### Evaluation order

1. Global overrides (first match wins)
2. Mode rules (first match wins)
3. Mode default decision

### Global overrides

Define alongside the evaluator (or import from permissions types):

```typescript
export const GLOBAL_OVERRIDES: PermissionRule[] = [
  {
    toolPattern: "^Bash$",
    commandPattern: "rm\\s+(-rf|--force).*\\.git",
    decision: "deny",
    reason: "Cannot delete .git directory",
  },
  {
    toolPattern: "^(Write|Edit)$",
    pathPattern: "\\.env",
    decision: "deny",
    reason: "Cannot modify .env files",
  },
];
```

## Phase 2: Unit tests

Create `agents/src/lib/__tests__/permission-evaluator.test.ts`.

### Test cases

**Rule matching:**
- Plan mode: Read tool → allow
- Plan mode: Write to `plans/readme.md` → allow
- Plan mode: Write to `src/app.tsx` → deny with reason
- Implement mode: Write to anything → allow
- Approve mode: Write to anything → ask
- Approve mode: Read tool → allow

**Path normalization:**
- Absolute path `/Users/zac/project/src/foo.ts` with workingDir `/Users/zac/project` → `src/foo.ts`
- Path already relative → returned as-is
- Path outside working directory → returned as-is

**Overrides take precedence:**
- Implement mode + `.env` write → deny (override wins over mode default "allow")
- Implement mode + `rm -rf .git` → deny

**Mode switching:**
- Start in Plan mode, `setMode(IMPLEMENT_MODE)`, re-evaluate same tool → different result
- `getModeId()` returns correct ID after switch

**Edge cases:**
- Tool input with no `file_path` (e.g., WebSearch) → pathPattern rules don't match, falls through
- Tool input with `null` → doesn't crash
- Unknown tool name → hits default decision

### Run verification

```bash
cd agents && pnpm test -- --run permission-evaluator
```

## Files

| File | Changes |
|------|---------|
| `agents/src/lib/permission-evaluator.ts` | **New** — ~80 lines |
| `agents/src/lib/__tests__/permission-evaluator.test.ts` | **New** — ~120 lines |
