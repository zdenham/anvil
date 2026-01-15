# Sub-Plan 04: Agent Integration

## Overview
Update the agent runner infrastructure to accept and parse the `--agent-mode` CLI argument, making the mode available to the agent process.

## Dependencies
- **01-core-types.md** - Requires AgentMode type from `core/types/`

## Can Run In Parallel With
- **03-ui-components.md** - These can run in parallel as they don't share files
- After 01 completes, this can start immediately

## Scope
- Update RunnerConfig type to include agentMode
- Update CLI argument parsing in SimpleRunnerStrategy
- Update agent loop to use mode

## Files Involved

### Modified Files
| File | Change |
|------|--------|
| `agents/src/runners/types.ts` | Add agentMode to RunnerConfig |
| `agents/src/runners/simple-runner-strategy.ts` | Parse --agent-mode argument |
| `agents/src/runners/shared.ts` | Use mode in agent loop |

### Test Files
| File | Change |
|------|--------|
| `agents/src/runners/simple-runner-strategy.test.ts` | Add tests for --agent-mode parsing |

## Implementation Details

### Step 1: Update RunnerConfig Type

**File:** `agents/src/runners/types.ts`

Add to RunnerConfig interface:
```typescript
import type { AgentMode } from "@core/types/agent-mode.js";

// ... in interface RunnerConfig
/** Agent mode for tool execution */
agentMode?: AgentMode;
```

### Step 2: Parse Agent Mode in SimpleRunnerStrategy

**File:** `agents/src/runners/simple-runner-strategy.ts`

Add case in `parseArgs`:
```typescript
case "--agent-mode":
  config.agentMode = args[++i] as AgentMode;
  break;
```

### Step 3: Update Agent Loop

**File:** `agents/src/runners/shared.ts`

Use `config.agentMode ?? "normal"` in the query() call to determine permission behavior. The exact implementation depends on how permissions are currently handled in the agent loop.

## Tests Required

### simple-runner-strategy.test.ts
Add test cases:
- Test parsing `--agent-mode` argument with valid values
- Test default behavior when `--agent-mode` not provided
- Test all three mode values: "normal", "plan", "auto-accept"

```typescript
describe("parseArgs", () => {
  it("parses --agent-mode argument", () => {
    const strategy = new SimpleRunnerStrategy();
    const config = strategy.parseArgs([
      "--agent", "simple",
      "--task-id", "task-123",
      "--thread-id", "thread-456",
      "--cwd", "/tmp/test",
      "--mort-dir", "/tmp/mort",
      "--prompt", "test prompt",
      "--agent-mode", "auto-accept",
    ]);

    expect(config.agentMode).toBe("auto-accept");
  });

  it("defaults agentMode to undefined when not provided", () => {
    const strategy = new SimpleRunnerStrategy();
    const config = strategy.parseArgs([
      "--agent", "simple",
      "--task-id", "task-123",
      "--thread-id", "thread-456",
      "--cwd", "/tmp/test",
      "--mort-dir", "/tmp/mort",
      "--prompt", "test prompt",
    ]);

    expect(config.agentMode).toBeUndefined();
  });
});
```

## Verification
- [ ] `pnpm tsc --noEmit` passes in agents package
- [ ] Agent runner tests pass
- [ ] Agent can be spawned with --agent-mode argument

## Estimated Time
~30 minutes

## Notes
- The actual permission behavior enforcement in the agent loop may require additional investigation into the current permission handling code
- This sub-plan sets up the infrastructure; actual permission enforcement may need follow-up work

## Open Questions

### Permission Handling Investigation Required

Investigation is needed for how the agent loop handles permissions. Specifically:

1. **Where are permissions currently checked?**
   - Look for permission prompts or approval flows in the agent runner code
   - Check `agents/src/runners/shared.ts` for any existing permission gates

2. **How should each mode affect permissions?**
   - `normal`: Requires explicit approval for file edits (existing behavior?)
   - `plan`: Agent should describe planned actions without executing file modifications
   - `auto-accept`: Auto-approve file edits without user confirmation

3. **What is the permission flow for tool execution?**
   - Does the agent use a callback system for permissions?
   - Is there a permission service or UI confirmation dialog?
   - How do we distinguish between read-only and write operations?

4. **Where should mode be consumed?**
   - In the tool execution layer?
   - In the agent query/response handler?
   - In a permission middleware?

This investigation should be done during or after implementing the basic CLI argument parsing to inform the final permission integration strategy.
