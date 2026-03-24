# QA Agent Implementation Plan

## Overview

Add a new "QA agent" to the agent workflow that verifies completed work through programmatic testing and manual testing guidance. The agent fits between Review and Merge in the workflow:

```
Planning → Execution → Review → QA → Merge
```

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/agent-types/qa.ts` | **New file** - QA agent definition |
| `agents/src/agent-types/index.ts` | Register qa agent |
| `agents/src/agent-types/shared-prompts.ts` | Add qa to HUMAN_REVIEW_TOOL table |
| `agents/src/cli/anvil.ts` | Add "qa" to VALID_AGENT_TYPES |
| `agents/src/agent-types/review.ts` | Update routing: review → qa instead of review → merge |

## Implementation Steps

### Step 1: Create `agents/src/agent-types/qa.ts`

Create new file with:

```typescript
import type { AgentConfig } from "./index.js";
import {
  TASK_CONTEXT,
  ANVIL_CLI_CORE,
  EXPLORATION_TOOLS,
  HUMAN_REVIEW_TOOL,
  composePrompt,
} from "./shared-prompts.js";
```

**Prompt sections to define:**

1. **ROLE** - QA agent's purpose:
   - Set up dev environment autonomously
   - Run programmatic tests first (test suite, typecheck, lint, build)
   - Provide manual testing instructions when programmatic tests are insufficient
   - Report findings and request human review

2. **CAPABILITIES** - Tools available:
   - Read, Glob, Grep for exploration
   - Bash for running tests, installing deps, starting dev servers
   - Full shell PATH available (npm, yarn, pnpm, cargo, pip, etc.)

3. **WORKFLOW** - The core testing flow:
   ```
   Phase 1: Discovery & Setup
   ├── Read task plan from content.md
   ├── Detect project type (package.json, Cargo.toml, etc.)
   ├── Install dependencies
   └── Handle setup failures (request human help if needed)

   Phase 2: Programmatic Testing
   ├── Discover available test commands
   ├── Run: test suite, typecheck, lint, build
   └── Document all results

   Phase 3: Assess Coverage
   ├── What acceptance criteria are covered by tests?
   ├── What requires manual verification?
   └── If all pass and sufficient coverage → report success

   Phase 4: Manual Testing Instructions (if needed)
   ├── Dev server startup commands
   ├── Step-by-step testing instructions
   ├── Expected vs actual behavior
   └── Cleanup instructions

   Phase 5: Report & Request Human Review
   ```

4. **TESTING_CHECKLIST** - What to verify:
   - Unit tests pass
   - Type checking passes
   - Linting passes
   - Build succeeds
   - Manual testing items (UI, visual, interactive)

5. **DEV_SERVER_PATTERNS** - How to start dev servers:
   - Use `run_in_background: true` for long-running servers
   - Provide the URL to access the app
   - Check for "ready" messages

6. **REPORT_FORMAT** - Structure for QA report:
   ```markdown
   ## QA Report for [Task Title]

   ### Environment Setup
   - Project type: [Node.js/Python/Rust/etc.]
   - Dependencies: [Installed successfully / Failed]
   - Build: [Success / Failed]

   ### Programmatic Test Results
   | Test | Command | Result |
   |------|---------|--------|
   | Unit Tests | `npm test` | PASS/FAIL |
   | Type Check | `npm run typecheck` | PASS/FAIL |
   | Lint | `npm run lint` | PASS/FAIL |
   | Build | `npm run build` | PASS/FAIL |

   ### Manual Testing Required
   [Step-by-step instructions if needed]

   ### Recommendation
   - READY FOR MERGE
   - NEEDS FIXES
   - NEEDS MANUAL VERIFICATION
   ```

7. **GUIDELINES** - Behavior rules:
   - Try automated first, then manual
   - Document failures with exact error messages
   - Request human help when setup fails
   - Always end with human review request

**Export the config:**

```typescript
export const qa: AgentConfig = {
  name: "QA",
  description: "Verifies completed work through programmatic and manual testing",
  model: "claude-opus-4-5-20251101",
  tools: { type: "preset", preset: "claude_code" },
  appendedPrompt: composePrompt(
    ROLE,
    TASK_CONTEXT,
    CAPABILITIES,
    WORKFLOW,
    TESTING_CHECKLIST,
    DEV_SERVER_PATTERNS,
    REPORT_FORMAT,
    ANVIL_CLI_CORE,
    EXPLORATION_TOOLS,
    HUMAN_REVIEW_TOOL,
    GUIDELINES
  ),
};
```

### Step 2: Register in `agents/src/agent-types/index.ts`

```typescript
import { qa } from "./qa.js";

const agents: Record<string, AgentConfig> = {
  planning,
  execution,
  review,
  merge,
  qa,  // Add this
};
```

### Step 3: Update `agents/src/agent-types/shared-prompts.ts`

Add qa to the HUMAN_REVIEW_TOOL agent table:

```typescript
| \`qa\` | Testing & verification | Review approved, needs QA before merge |
```

Update common patterns:
```typescript
- Review approving work: `--on-approve qa --on-feedback execution`
- QA passing: `--on-approve merge --on-feedback execution`
```

### Step 4: Update `agents/src/cli/anvil.ts`

Line 60:
```typescript
const VALID_AGENT_TYPES = ["planning", "execution", "review", "merge", "qa"] as const;
```

### Step 5: Update `agents/src/agent-types/review.ts`

Update the GUIDELINES section routing pattern so review sends to qa instead of merge:

```typescript
- Review approving work: `--on-approve qa --on-feedback execution`
```

## Key Design Decisions

1. **Autonomy-first philosophy**: The agent tries to set up everything and run programmatic tests before asking for human help

2. **Environment setup**: Detects project type and runs appropriate install commands:
   - Node.js: `npm ci` / `yarn install` / `pnpm install`
   - Python: `pip install -e .` / `poetry install`
   - Rust: `cargo build`

3. **Programmatic tests first**: Always runs available automated tests before suggesting manual testing

4. **Structured reporting**: Uses a consistent report format so humans can quickly understand QA status

5. **Clear escalation**: Requests human help with specific errors when setup fails, rather than proceeding with broken environment

## Testing the Implementation

After implementing, verify:
1. `pnpm typecheck` passes in agents/
2. Running a task through the full workflow routes correctly: planning → execution → review → qa → merge
3. QA agent correctly detects project type and runs tests
4. Manual testing instructions are clear and actionable when needed
