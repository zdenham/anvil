# Breadcrumb Tool Improvements

Running list of feedback items and bugs for the breadcrumb skill system.

## Feedback Items

### 1. `run_in_background` denial not working for anvil-repl

**Observed**: Thread `31e1729e` invoked `anvil-repl` twice — first with `run_in_background: true`, then again without. Both ended with `status: "error"` and generic "Tool execution was interrupted" — no repl-hook denial message recorded.

**Research findings** (2026-03-15):

| Question | Answer | Source |
| --- | --- | --- |
| Do PreToolUse hooks fire for `run_in_background: true`? | **Yes** — SDK dispatches background execution *after* hook loop completes | SDK source + spike confirmation |
| Does SDK callback `permissionDecision: "deny"` block `run_in_background` Bash? | **Yes** — confirmed by live spike (all 5 assertions pass) | Spike: `bg-deny.integration.test.ts` |
| Does `bypassPermissions` affect hook deny? | Hooks fire, but allow-list can skip hooks entirely | [#22018](https://github.com/anthropics/claude-code/issues/22018), [#13214](https://github.com/anthropics/claude-code/issues/13214) |
| Do subagent tool calls trigger parent hooks? | **No** — confirmed security gap | [#34692](https://github.com/anthropics/claude-code/issues/34692), [#21460](https://github.com/anthropics/claude-code/issues/21460) |

> **Note**: GitHub issues [#26923](https://github.com/anthropics/claude-code/issues/26923) and [#34240](https://github.com/anthropics/claude-code/issues/34240) report `permissionDecision: "deny"` not being enforced. However, those issues involve **shell command hooks** using `exit 2`, not **SDK callback hooks** using the `reason` + `hookSpecificOutput` return format. Our spike confirms the SDK callback path works correctly.

**Spike results** (2026-03-15):

| Assertion | Result |
| --- | --- |
| 1\. Hook fires for `run_in_background: true` | PASS — `{ type: "hook_fired", bg: true }` logged |
| 2\. Deny returned | PASS — `{ type: "deny_returned" }` logged |
| 3\. BG_CANARY not in any PostToolUse result | PASS — `bgToolExecuted: false` |
| 4\. FG_CANARY in PostToolUse result | PASS — `fgToolExecuted: true` |
| 5\. Final flags consistent | PASS — all flags match expectations |

**Conclusion**: The repl-hook's deny pattern (`reason` + `hookSpecificOutput` with `permissionDecision: "deny"`) **does work** for `run_in_background: true` Bash calls. The thread `31e1729e` failure was caused by something else — likely an abort signal or context exhaustion that interrupted the tool before the hook had a chance to fire, or the command wasn't recognized as anvil-repl by `runner.extractCode()`.

**No hook fix needed** — the existing code at `agents/src/hooks/repl-hook.ts:44-61` is correct and functional. The skill prompt changes (item #2) are still valuable as defense-in-depth.

**Tool state update path for hook denials**:

The Anthropic API requires every `tool_use` to have a corresponding `tool_result`. When a PreToolUse hook denies with `reason`, the SDK creates a synthetic `tool_result` (with `is_error: true`) and emits it as a `user` message in the stream. This means tool states ARE properly updated for denials:

1. Assistant emits `tool_use` → `MessageHandler` calls `markToolRunning(toolUseId, toolName)` → status: `"running"`
2. PreToolUse hook returns deny with `reason`
3. SDK creates synthetic `tool_result` user message with `is_error: true` and the `reason` as content
4. `MessageHandler.handleUser` (message-handler.ts:208-218) sees `parent_tool_use_id` → calls `markToolComplete(toolUseId, reason, true)` → status: `"error"`
5. `PostToolUse` does **NOT** fire for denied tools (confirmed by spike: `bgToolExecuted: false`)

So the UI will correctly show the denied tool as failed with the denial reason text. No additional state management changes are needed.

> **Note on thread** `31e1729e`: If the denial had fired, the tool state would show `status: "error"` with the repl-hook's denial message. Instead, both tools showed `status: "error"` with generic "Tool execution was interrupted" — this confirms the denial never fired in that thread. The most likely explanation is an abort signal or context exhaustion that killed the tool before the hook ran, or the command format didn't match `extractCode()`.

### 2. Skill prompts should explicitly forbid `run_in_background` for anvil-repl

**Problem**: Neither `breadcrumb-loop/SKILL.md` nor `orchestrate/SKILL.md` instructs the model to avoid `run_in_background`. The hook works, but defense-in-depth means the model shouldn't attempt it at all.

**Files to change**:

- `plugins/anvil/skills/breadcrumb-loop/SKILL.md` — add warning before the `## Loop` section
- `plugins/anvil/skills/orchestrate/SKILL.md` — add warning in the `## Notes` section

**Exact additions**:

In `breadcrumb-loop/SKILL.md`, add before `## Loop`:

```markdown
## Important

**Do NOT use `run_in_background: true`** when invoking `anvil-repl`. The REPL manages long-running execution internally via child agent processes. Always run it in the foreground.
```

In `orchestrate/SKILL.md`, add as the first bullet in `## Notes`:

```markdown
- **Do NOT use `run_in_background: true`** when invoking `anvil-repl`. The REPL manages long-running execution internally. Always run in the foreground.
```

### 3. Breadcrumb folder should use `-breadcrumb-log` suffix

**Problem**: The breadcrumb directory at `plans/breadcrumbs/<task-slug>/` doesn't make it obvious that a folder is a breadcrumb trail vs a regular plan.

**Fix**: Use the suffix `-breadcrumb-log` so directories are clearly identifiable: `plans/<task-slug>-breadcrumb-log/`.

**Files to change**:

`breadcrumb-loop/SKILL.md` — 3 changes:

1. Step 2: `plans/breadcrumbs/<task-slug>/` → `plans/<task-slug>-breadcrumb-log/`
2. Loop code: `const DIR = "plans/breadcrumbs/<task-slug>"` → `const DIR = "plans/<task-slug>-breadcrumb-log"`
3. After the Loop section: update the progress file path reference

`breadcrumb/SKILL.md` — 1 change:

1. Example: `/breadcrumb plans/my-task 3` → `/breadcrumb plans/my-task-breadcrumb-log 3`

Note: `breadcrumb/SKILL.md` receives the directory path as an argument, so it doesn't hardcode the naming convention — only the example needs updating.

## Phases

- [x] Research SDK behavior and GitHub issues for `run_in_background` + hooks

- [x] Live spike: confirm repl-hook deny blocks `run_in_background: true` Bash calls

- [x] Add `run_in_background` prohibition to breadcrumb-loop and orchestrate skill prompts

- [x] Implement `-breadcrumb-log` suffix for breadcrumb folder naming in both skill files

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Spike: `run_in_background` Deny Enforcement

### Goal

Confirm whether the repl-hook's `reason` + `permissionDecision: "deny"` return pattern actually prevents a Bash tool call with `run_in_background: true` from executing.

### Files

- Runner: `agents/src/experimental/bg-deny-runner.ts`
- Test: `agents/src/experimental/__tests__/bg-deny.integration.test.ts`

### Result: ALL PASS

The deny **works correctly**. The SDK callback hook pattern (`reason` + `hookSpecificOutput`) reliably blocks Bash tool execution with `run_in_background: true`. The command does not execute, the denial reason is sent back to the model, and the model correctly moves on to the foreground command.

Key observations:

- Hook fires immediately for the background Bash call
- The model receives the denial and acknowledges it: *"The background command was blocked by a PreToolUse hook"*
- Foreground Bash calls are unaffected (allow path works)
- Total test time: \~12s (fast — no long delays needed)

### Gotcha: CLAUDECODE env var

The SDK spawns a `claude` subprocess which refuses to start inside another claude session. Runners must `delete process.env.CLAUDECODE` before importing the SDK. Tests must strip `CLAUDECODE` from the env when spawning the runner subprocess.

## Related Files

| File | Relevance |
| --- | --- |
| `agents/src/hooks/repl-hook.ts` | The `run_in_background` deny guard (lines 44-61) — **confirmed working** |
| `agents/src/runners/shared.ts` | Hook registration (lines 560-582) — correctly registered |
| `agents/src/runners/message-handler.ts` | Tool result handling (line 218) — correctly calls `markToolComplete` for tool_results |
| `plugins/anvil/skills/breadcrumb-loop/SKILL.md` | Needs `run_in_background` warning + folder naming update |
| `plugins/anvil/skills/breadcrumb/SKILL.md` | Needs folder naming example update |
| `plugins/anvil/skills/orchestrate/SKILL.md` | Needs `run_in_background` warning |
| `agents/src/experimental/bg-deny-runner.ts` | Spike runner — confirmed deny works |
| `agents/src/experimental/__tests__/bg-deny.integration.test.ts` | Spike test — all 5 assertions pass |
