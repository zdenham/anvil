# Plan: End-of-Run Validation Hooks

## Goal

Add validation at the end of agent runs to keep agents going until completion criteria are met:
1. **All agents**: Must request human review before completing
2. **Planning agent**: Task must be appropriately named (not "draft" or generic) and properly slugified

---

## Feasibility Analysis

**Yes, this is possible using the SDK's native `Stop` hook.**

The Claude Agent SDK provides a `Stop` hook that fires when the agent tries to stop. Hooks can return:
- `continue: boolean` - Whether the agent should continue (default: true)
- `systemMessage: string` - Message injected into the conversation for Claude to see

This means we can:
1. Run validators in the `Stop` hook
2. If validation fails, return `{ continue: true, systemMessage: "You must..." }`
3. The SDK natively continues the conversation with the validation prompt

**No need to call `query()` again** - the SDK handles continuation internally.

---

## Alternatives Considered

| Pattern | Why not |
|---------|---------|
| Prompt instructions only | Agent may ignore; no enforcement |
| PostToolUse hook | Wrong timing - runs per-tool, not at end |
| Re-calling query() | Ugly; manual message management |

---

## Implementation

### Step 1: Validator Types

**File:** `agents/src/validators/types.ts`

```typescript
export interface ValidationResult {
  valid: boolean;
  /** System message to inject if validation fails */
  systemMessage?: string;
}

export interface ValidationContext {
  agentType: string;
  taskId: string | null;
  anvilDir: string;
  cwd: string;
}

export interface AgentValidator {
  /** Human-readable name for logging */
  name: string;
  /** Which agent types this validator applies to (empty = all) */
  agentTypes?: string[];
  /** Run validation, return result */
  validate(context: ValidationContext): Promise<ValidationResult>;
}
```

### Step 2: Human Review Validator

**File:** `agents/src/validators/human-review.ts`

Checks that the task has `pendingReview` set (meaning agent called `anvil request-human`).

```typescript
import type { AgentValidator, ValidationContext, ValidationResult } from "./types.js";
import { NodePersistence } from "../lib/persistence-node.js";

export const humanReviewValidator: AgentValidator = {
  name: "human-review",
  // Applies to all agents

  async validate(context: ValidationContext): Promise<ValidationResult> {
    // Skip if no task (ephemeral conversation)
    if (!context.taskId) {
      return { valid: true };
    }

    const persistence = new NodePersistence(context.anvilDir);
    const task = await persistence.getTask(context.taskId);

    if (!task) {
      return { valid: true };
    }

    if (task.pendingReview) {
      return { valid: true };
    }

    return {
      valid: false,
      systemMessage: `VALIDATION FAILED: You must request human review before completing. Use the \`anvil request-human\` command to request review of your work. This is required for all agents.`,
    };
  },
};
```

### Step 3: Planning Naming Validator

**File:** `agents/src/validators/planning-naming.ts`

Checks that planning agent has:
1. Renamed the task from "draft" to something descriptive
2. Title generates a valid slug

```typescript
import type { AgentValidator, ValidationContext, ValidationResult } from "./types.js";
import { NodePersistence } from "../lib/persistence-node.js";

// Bad title patterns - too generic
const BAD_TITLE_PATTERNS = [
  /^draft$/i,
  /^untitled$/i,
  /^new task$/i,
  /^task$/i,
  /^work$/i,
  /^todo$/i,
  /^fix$/i,
  /^update$/i,
  /^change$/i,
  /^implement$/i,
];

export const planningNamingValidator: AgentValidator = {
  name: "planning-naming",
  agentTypes: ["planning"],

  async validate(context: ValidationContext): Promise<ValidationResult> {
    if (!context.taskId) {
      return { valid: true };
    }

    const persistence = new NodePersistence(context.anvilDir);
    const task = await persistence.getTask(context.taskId);

    if (!task) {
      return { valid: true };
    }

    const title = task.title.trim();

    // Check for bad title patterns
    for (const pattern of BAD_TITLE_PATTERNS) {
      if (pattern.test(title)) {
        return {
          valid: false,
          systemMessage: `VALIDATION FAILED: The task title "${title}" is too generic. You must rename the task to something descriptive using \`anvil tasks rename --id=${context.taskId} --title="Descriptive title here"\`. Good titles describe what the task accomplishes, e.g., "Add dark mode toggle to settings" or "Fix race condition in auth flow".`,
        };
      }
    }

    // Check minimum length
    if (title.length < 10) {
      return {
        valid: false,
        systemMessage: `VALIDATION FAILED: The task title "${title}" is too short. You must rename with a more descriptive title (at least 10 characters) using \`anvil tasks rename --id=${context.taskId} --title="Descriptive title here"\`.`,
      };
    }

    // Check slug is valid
    const slug = task.slug;
    if (!slug || slug.length < 3) {
      return {
        valid: false,
        systemMessage: `VALIDATION FAILED: The task slug "${slug}" is too short. The title "${title}" doesn't generate a good slug. You must rename with a title containing meaningful words using \`anvil tasks rename --id=${context.taskId} --title="Descriptive title here"\`.`,
      };
    }

    return { valid: true };
  },
};
```

### Step 4: Validator Registry

**File:** `agents/src/validators/index.ts`

```typescript
import type { AgentValidator, ValidationContext, ValidationResult } from "./types.js";
import { humanReviewValidator } from "./human-review.js";
import { planningNamingValidator } from "./planning-naming.js";

export * from "./types.js";

const validators: AgentValidator[] = [
  planningNamingValidator,  // Run first - planning-specific
  humanReviewValidator,      // Run last - applies to all
];

/**
 * Run all applicable validators for the given context.
 * Returns first failing validation, or { valid: true } if all pass.
 */
export async function runValidators(
  context: ValidationContext
): Promise<ValidationResult> {
  for (const validator of validators) {
    // Skip validators not applicable to this agent type
    if (
      validator.agentTypes &&
      validator.agentTypes.length > 0 &&
      !validator.agentTypes.includes(context.agentType)
    ) {
      continue;
    }

    console.error(`[validator] Running ${validator.name} for ${context.agentType}`);
    const result = await validator.validate(context);

    if (!result.valid) {
      console.error(`[validator] ${validator.name} FAILED`);
      return result;
    }

    console.error(`[validator] ${validator.name} PASSED`);
  }

  return { valid: true };
}
```

### Step 5: Add Stop Hook to Runner

**File:** `agents/src/runner.ts`

Add the Stop hook alongside the existing PostToolUse hook (around line 415):

```typescript
import { runValidators } from "./validators/index.js";

// ... in main()

const MAX_VALIDATION_ATTEMPTS = 3;
let validationAttempts = 0;

// ... existing code ...

const result = query({
  prompt: args.prompt,
  options: {
    cwd: args.cwd,
    additionalDirectories: [args.anvilDir],
    model: agentConfig.model ?? "claude-opus-4-5-20251101",
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: appendedPrompt,
    },
    tools: agentConfig.tools,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    includePartialMessages: false,
    ...(priorMessages.length > 0 && { messages: priorMessages }),

    hooks: {
      // Existing PostToolUse hook
      PostToolUse: [
        {
          hooks: [
            async (hookInput, toolUseID) => {
              // ... existing PostToolUse logic ...
              return { continue: true };
            },
          ],
        },
      ],

      // NEW: Stop hook for end-of-run validation
      Stop: [
        {
          hooks: [
            async (input, toolUseID, { signal }) => {
              validationAttempts++;

              if (validationAttempts > MAX_VALIDATION_ATTEMPTS) {
                console.error(`[Stop] Max validation attempts (${MAX_VALIDATION_ATTEMPTS}) reached, allowing stop`);
                return {};
              }

              console.error(`[Stop] Running validators (attempt ${validationAttempts})`);

              const result = await runValidators({
                agentType: args.agentType,
                taskId: args.taskId,
                anvilDir: args.anvilDir,
                cwd: args.cwd,
              });

              if (result.valid) {
                console.error(`[Stop] All validators passed, allowing stop`);
                return {};
              }

              console.error(`[Stop] Validation failed, continuing conversation`);
              return {
                continue: true,
                systemMessage: result.systemMessage,
              };
            },
          ],
        },
      ],
    },
  },
});

// Rest of the message handling loop stays the same
for await (const message of result) {
  // ... existing message handling ...
}
```

---

## Testing

- [ ] Planning agent with generic title → validation fails → agent renames → passes
- [ ] Agent without human review → validation fails → agent calls `anvil request-human` → passes
- [ ] No taskId (ephemeral) → validators skip → passes immediately
- [ ] Max attempts (3) reached → allows stop with warning
- [ ] Agent already compliant → passes on first attempt

---

## Files

| File | Action |
|------|--------|
| `agents/src/validators/types.ts` | Create |
| `agents/src/validators/human-review.ts` | Create |
| `agents/src/validators/planning-naming.ts` | Create |
| `agents/src/validators/index.ts` | Create |
| `agents/src/runner.ts` | Add Stop hook |

---

## Future

- content.md validation (ensure planning agent wrote to it)
- Configurable validators per agent type
- Validation metrics (retry counts, common failures)
