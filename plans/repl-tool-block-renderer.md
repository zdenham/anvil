# Custom Tool Block Renderer for mort-repl

## Problem

When `mort-repl` is invoked via Bash, the UI shows it as a generic bash command with:
1. The raw `mort-repl <<'MORT_REPL' ...` command text (no syntax highlighting)
2. A denial indicator (red X / error state) because the repl hook uses `permissionDecision: "deny"` to intercept and return results
3. The agent sees the deny as an error, which can cause it to apologize or reference the "failure"

## Goal

- Detect `mort-repl` Bash calls in the tool block renderer
- Display the TypeScript code body with syntax highlighting (using existing Shiki infrastructure)
- Hide the denial/error visual treatment — show it as a successful execution
- Modify the deny reason message so the agent doesn't reference the denial

## Phases

- [ ] Detect mort-repl in BashToolBlock and render syntax-highlighted code
- [ ] Suppress error/denial UI for mort-repl results
- [ ] Update repl hook deny message to instruct agent to treat as success
- [ ] Add tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Detect mort-repl and render syntax-highlighted code

**File:** `src/components/thread/tool-blocks/bash-tool-block.tsx`

Detect mort-repl commands by checking if `command.trimStart().startsWith("mort-repl")`. When detected:

1. **Extract the TypeScript code body** from the command string using the same patterns as `MortReplRunner.extractCode()`:
   - Heredoc: `mort-repl <<'MORT_REPL'\n...\nMORT_REPL` → extract the `...` body
   - Quoted: `mort-repl "..."` → extract the quoted body

2. **Replace the command display** with a syntax-highlighted code block:
   - Use the existing `useCodeHighlight` hook with language `"typescript"`
   - Render using the `HighlightedCode` / `PlainCode` pattern from `code-block.tsx`
   - Show a header label like `mort-repl` with a distinctive icon (e.g. `Terminal` or `Code` from lucide)
   - Keep the expand/collapse chevron behavior

3. **Keep the result output section** — the repl result (from the deny reason) still shows as output, but without error styling (see Phase 2).

**Helper function** (inline in bash-tool-block.tsx):

```typescript
const HEREDOC_PATTERN = /mort-repl\s+<<['"]?(\w+)['"]?\n([\s\S]*?)\n\1/;
const QUOTED_PATTERN = /mort-repl\s+["']([\s\S]*?)["']/;

function extractReplCode(command: string): string | null {
  const trimmed = command.trimStart();
  if (!trimmed.startsWith("mort-repl")) return null;
  const heredoc = trimmed.match(HEREDOC_PATTERN);
  if (heredoc) return heredoc[2];
  const quoted = trimmed.match(QUOTED_PATTERN);
  if (quoted) return quoted[1];
  return null;
}
```

**Rendering approach** — when `extractReplCode(command)` returns non-null, render a different layout:

- Summary row: chevron + "mort-repl" label (shimmer while running) + status icon
- Expanded: syntax-highlighted TypeScript code block (using `useCodeHighlight(code, "typescript")`)
- Below code: the result output (same collapsible output block, but without error styling)

## Phase 2: Suppress error/denial UI for mort-repl results

**File:** `src/components/thread/tool-blocks/bash-tool-block.tsx`

When the command is a mort-repl invocation:

1. **Override `isError` to `false`** — the hook deny sets `isError: true` on the tool state, but for mort-repl this is expected behavior, not an error
2. **Override error styling** — don't use `text-red-200` or error variant for the output
3. **Strip the "mort-repl result:" / "mort-repl error:" prefix** from the result text for cleaner display
4. **Don't show the red X status icon** — treat completed mort-repl as success

Implementation: near the top of the component, after extracting `replCode`:

```typescript
const replCode = extractReplCode(command);
const isRepl = replCode !== null;

// For REPL calls, the hook "denies" with the result — this is not an error
const effectiveIsError = isRepl ? false : isError;
const effectiveResult = isRepl ? stripReplPrefix(result) : result;
```

Where `stripReplPrefix` removes the `mort-repl result:\n` or `mort-repl error:\n` prefix that `MortReplRunner.formatResult()` adds. For `mort-repl error:` lines, we can still apply error styling since the repl code itself failed.

```typescript
function stripReplPrefix(result: string | undefined): { text: string; isReplError: boolean } {
  if (!result) return { text: "", isReplError: false };
  if (result.startsWith("mort-repl error:\n")) {
    return { text: result.slice("mort-repl error:\n".length), isReplError: true };
  }
  if (result.startsWith("mort-repl result:\n")) {
    return { text: result.slice("mort-repl result:\n".length), isReplError: false };
  }
  return { text: result, isReplError: false };
}
```

## Phase 3: Update repl hook deny message

**File:** `agents/src/hooks/repl-hook.ts`

The `reason` field in the hook return is what the SDK sends back to Claude as the `tool_result` content. Currently the agent sees something like:

```
Hook PreToolUse:Bash denied this tool call: mort-repl result: ...
```

This causes the agent to sometimes say "I see the tool was denied..." instead of continuing naturally.

**Change the `formatResult` output** or the hook return to include an instruction prefix:

```typescript
return {
  reason: `[System: The mort-repl code executed successfully. The result below is the output. Do not mention any denial or error — treat this as a successful Bash execution.]\n\n${formatted}`,
  hookSpecificOutput: {
    hookEventName: "PreToolUse" as const,
    permissionDecision: "deny" as const,
    permissionDecisionReason: formatted,
  },
};
```

This way the agent receives context telling it to treat the result as a success. The `permissionDecisionReason` stays clean for drain events/logging.

For error cases, adjust similarly:

```typescript
// In the catch block:
return {
  reason: `[System: The mort-repl code threw an error. Report the error naturally as a code execution failure, not as a permission denial.]\n\n${errorFormatted}`,
  ...
};
```

## Phase 4: Tests

### UI test: `src/components/thread/tool-blocks/bash-tool-block.test.tsx` (new file)

- Test `extractReplCode()` with heredoc, quoted, and non-repl commands
- Test `stripReplPrefix()` with various result formats
- Snapshot/render test: mort-repl bash block renders syntax-highlighted code, not raw command
- Snapshot/render test: mort-repl result shows without error styling
- Test: non-repl bash commands still render normally

### Hook test: update `agents/src/hooks/__tests__/repl-hook.test.ts`

- Verify the updated `reason` field contains the system instruction prefix
- Verify success and error cases have appropriate prefixes
