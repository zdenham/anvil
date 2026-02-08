# Recursive Bash Sub-Agents

## Overview

The Claude Agent SDK limits sub-agents to one level of nesting. This plan implements an alternative approach: spawning sub-agents via the Bash tool by running the agent runner directly as a Node.js process.

This enables:
- Unlimited nesting depth
- Same behavior as SDK Task tool (final message returned as result)
- Full access to all tools in sub-agents
- Thread tracking in UI (sub-agents appear in thread list with parent-child hierarchy)

## Phases

- [x] Remove `MORT_RUNNER_PATH` env var - derive path from `import.meta.url` instead
- [x] Inject parent context into system prompt as template variables
- [x] Add `--parent-thread-id` CLI arg and store in thread metadata
- [x] Update `RECURSIVE_SUBAGENT` prompt to use injected template variables
- [ ] Test recursive spawning (2-3 levels deep)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture

### How It Works

1. Parent agent uses Bash tool to run: `node "{{runnerPath}}" --prompt "task" --parent-thread-id "{{threadId}}" ...`
2. Sub-agent executes with full tool access
3. Sub-agent's messages go to stdout (UI sees them as a separate thread)
4. Sub-agent's final assistant message is marked with `subagent_result` type
5. Parent receives the final message text as the Bash tool result

### Key Insight: Context Already Available

The parent agent process already has all the values needed to spawn sub-agents:
- `repoId`, `worktreeId`, `threadId`, `mortDir`, `cwd` - all passed via CLI args
- `runnerPath` - derivable from `import.meta.url` (the runner knows its own location)

**No new environment variables are needed.** Instead, the runner injects these values into the system prompt as template variables (e.g., `{{repoId}}`), making them directly usable by the agent.

### Template Variables (Injected by Runner)

| Variable | Source | Description |
|----------|--------|-------------|
| `{{runnerPath}}` | `import.meta.url` | Absolute path to `runner.js` |
| `{{repoId}}` | CLI `--repo-id` | Repository UUID |
| `{{worktreeId}}` | CLI `--worktree-id` | Worktree UUID |
| `{{threadId}}` | CLI `--thread-id` | Current thread UUID (becomes parent for sub-agents) |
| `{{mortDir}}` | CLI `--mort-dir` | Path to `~/.mort` data directory |
| `{{cwd}}` | CLI `--cwd` | Working directory |

### Command Format (Template in System Prompt)

```bash
node "{{runnerPath}}" \
  --repo-id "{{repoId}}" \
  --worktree-id "{{worktreeId}}" \
  --thread-id "$(uuidgen | tr '[:upper:]' '[:lower:]')" \
  --parent-thread-id "{{threadId}}" \
  --cwd "$PWD" \
  --mort-dir "{{mortDir}}" \
  --prompt "Task description for sub-agent"
```

The agent copies this template, changing only:
- `--prompt` (the task to delegate)
- Optionally `--cwd` if the sub-agent should work in a different directory

### Output Protocol

**Sub-agent stdout** contains JSON lines with type field:
- `{"type":"state",...}` - Thread state updates (for UI)
- `{"type":"event",...}` - Events like `thread:created`
- `{"type":"log",...}` - Log messages
- `{"type":"subagent_result","text":"..."}` - Final result (emitted at completion)

**Message forwarding**: Each sub-agent writes to stdout with its own thread ID. Since they're separate processes, the UI automatically associates messages with the correct thread - no explicit forwarding needed.

**Extracting the result**: Parent finds the line with `"type":"subagent_result"` and parses the `text` field.

---

## Implementation Details

### Phase 1: Remove MORT_RUNNER_PATH Env Var

**File**: `agents/src/runner.ts`

The runner can derive its own path:
```typescript
import { fileURLToPath } from "url";
const runnerPath = fileURLToPath(import.meta.url);
```

Pass this to the prompt template system.

**File**: `src/lib/agent-service.ts`

Remove `MORT_RUNNER_PATH` from env vars - no longer needed.

### Phase 2: Inject Context into System Prompt

**File**: `agents/src/runners/shared.ts`

In `runAgentLoop`, replace template variables in the appended prompt:
- `{{runnerPath}}` → derived from `import.meta.url`
- `{{repoId}}`, `{{worktreeId}}`, `{{threadId}}`, `{{mortDir}}`, `{{cwd}}` → from `RunnerConfig`

### Phase 3: Add Parent Thread ID Support

**File**: `agents/src/runners/types.ts`

Add to `RunnerConfig`:
```typescript
parentThreadId?: string;
```

**File**: `agents/src/runners/simple-runner-strategy.ts`

1. Parse `--parent-thread-id` in `parseArgs()`
2. In `setup()`, write `parentThreadId` to thread metadata if provided
3. UI can use this for parent-child thread hierarchy

### Phase 4: Update System Prompt

**File**: `agents/src/agent-types/shared-prompts.ts`

Update `RECURSIVE_SUBAGENT` to use template variables:

```markdown
## Recursive Sub-Agents (Bash-based)

Spawn sub-agents for tasks that benefit from dedicated context.

### Command Template

\`\`\`bash
node "{{runnerPath}}" \
  --repo-id "{{repoId}}" \
  --worktree-id "{{worktreeId}}" \
  --thread-id "$(uuidgen | tr '[:upper:]' '[:lower:]')" \
  --parent-thread-id "{{threadId}}" \
  --cwd "$PWD" \
  --mort-dir "{{mortDir}}" \
  --prompt "Your task description"
\`\`\`

### Getting the Result

The output contains many JSON lines. Find the one with `"type":"subagent_result"` and parse its `text` field - that's the sub-agent's final response.
```

### Phase 5: Testing

Test scenarios:
1. Single sub-agent spawn and result capture
2. Two levels of nesting (agent → sub-agent → sub-sub-agent)
3. Parallel sub-agent spawning (multiple Bash calls)
4. Error handling (sub-agent fails)
5. Parent-child relationship visible in UI

---

## Files Modified

| File | Change | Status |
|------|--------|--------|
| `agents/src/runner.ts` | Derive and export `runnerPath` | ✅ |
| `agents/src/runners/shared.ts` | Inject template variables into prompt | ✅ |
| `agents/src/runners/types.ts` | Add `parentThreadId` to `RunnerConfig` | ✅ |
| `agents/src/runners/simple-runner-strategy.ts` | Parse `--parent-thread-id`, write to metadata | ✅ |
| `agents/src/agent-types/shared-prompts.ts` | Update to use `{{var}}` template syntax | ✅ |
| `src/lib/agent-service.ts` | Remove `MORT_RUNNER_PATH` env var | ✅ |
| `agents/src/output.ts` | (Keep existing `subagent_result` marker) | ✅ |

---

## What's Already Done

- `subagent_result` marker emission in `output.ts` - correctly implemented
- Thread metadata creation in `SimpleRunnerStrategy.setup()` - already handles UI visibility
- Basic `RECURSIVE_SUBAGENT` prompt exists (needs template var update)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Infinite recursion | Document depth limit recommendation (3-4 levels) |
| Resource exhaustion | Each sub-agent is a separate process; OS limits apply |
| Output too large | Bash tool already truncates at 30K chars |
| Timeout | Bash tool has 10min max; document this limit |

---

## Success Criteria

- [ ] Agent can spawn sub-agent via Bash and receive result
- [ ] Sub-agent's final message is cleanly extracted via `subagent_result`
- [ ] Sub-agents appear in UI thread list with parent-child relationship
- [ ] 3-level nesting works correctly
- [ ] No env vars needed - all context injected via template variables
