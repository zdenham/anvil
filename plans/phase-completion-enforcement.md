# Phase Completion Enforcement

## Problem Statement

Agents are sometimes forgetting to mark phases as complete in plans as they finish work. Additionally, phases are sometimes:
1. Not implementable by the agent (e.g., manual testing, deployment)
2. Outside the scope of the plan (e.g., future work, nice-to-haves)

This leads to stale phase tracking and reduces the usefulness of the feature.

## Phases

- [ ] Update plan prompt with stronger phase completion guidance
- [ ] Implement SubagentStop phase validation hook
- [ ] Add phase guidelines to prompt (scope + implementability)

---

## Investigation Findings

### SDK Hook Return Format (from `end-of-run-validation-hooks.md`)

The Claude Agent SDK's `Stop` hook (and other hooks) supports returning:
- `{ continue: true, systemMessage: "..." }` - Continue the conversation with an injected system message
- `{}` or nothing - Allow the agent to stop

**This is the key mechanism**: returning `continue: true` with a `systemMessage` keeps the agent running and injects the validation failure message.

### SubagentStop Hook Input

The `SubagentStopHookInput` contains:
```typescript
type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStop';
  stop_hook_active: boolean;
  agent_id: string;
  agent_transcript_path: string;  // <-- Can read this to find mentioned .md files
};
```

**Important**: We can read the `agent_transcript_path` to scan user messages for mentioned markdown files.

### Detecting Plan-Related Agents

**Approach**: Check if any markdown file (`.md`) is mentioned in the user messages of the sub-agent's transcript. If so, the agent is likely working on a plan and should validate phase completion.

```typescript
function agentMentionsPlanFile(transcriptPath: string): boolean {
  const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));
  // Look for .md file references in user messages
  for (const msg of transcript.messages) {
    if (msg.type === "user" && typeof msg.message?.content === "string") {
      if (/\.md\b/i.test(msg.message.content)) {
        return true;
      }
    }
  }
  return false;
}
```

### Current Architecture

**Phase Tracking Flow:**
1. Plans are markdown files in `plans/*.md` with a `## Phases` section
2. `parsePhases()` in `agents/src/lib/phase-parser.ts` extracts completed/total counts
3. Phase info is stored in plan metadata at `~/.mort/plans/{planId}/metadata.json`
4. PostToolUse hook in `agents/src/runners/shared.ts` detects plan writes and parses phases

**Sub-agent Lifecycle:**
1. `SubagentStart` hook creates child thread with `status: "running"`
2. `SubagentStop` hook marks thread as `status: "completed"`
3. Stop hook fires when the Task tool completes (SDK-level callback)

**Existing Stop Hook Support:**
```typescript
// In AgentLoopOptions (shared.ts:276-277)
stopHook?: () => Promise<{ decision: "approve" } | { decision: "block"; reason: string }>;

// Wired into SDK hooks (shared.ts:648-650)
...(options.stopHook && {
  Stop: [{ hooks: [options.stopHook] }],
}),
```

The Stop hook infrastructure exists but is not currently used.

**Current Prompt Guidance:**
```markdown
### Phase Tracking

Define phases within a dedicated `## Phases` section (required for detection):

- The section must be delimited by the next `##` heading or `---` horizontal rule
- Mark phases complete with `[x]` as work progresses
- Keep phases at the top level (not nested under other list items)
- Use clear, actionable phase descriptions
```

## Proposed Solutions

### 1. Enhanced Plan Prompt Messaging

Update `PLAN_CONVENTIONS` in `agents/src/agent-types/shared-prompts.ts` to include stronger guidance:

```markdown
### Phase Tracking

Define phases within a dedicated `## Phases` section (required for detection):

#### Phase Guidelines

**Phases must be:**
- Implementable by the agent within this session
- Within scope of the plan's stated objective
- Concrete and verifiable (not vague or aspirational)

**Phases should NOT include:**
- Manual testing or deployment steps
- Future work or "nice-to-haves"
- Steps requiring external dependencies or approvals
- Research that won't be acted upon in this session

#### Completion Requirements

**IMPORTANT: Mark phases as complete progressively as work is done.**
- Update the plan file immediately after completing each phase
- Do not wait until the end to mark multiple phases complete
- If a phase cannot be completed, document why and consider removing it

#### Example Good Phases
- [ ] Add validation to user input form
- [ ] Write unit tests for validation logic
- [ ] Update error messages for clarity

#### Example Bad Phases (avoid these)
- [ ] Deploy to production (requires external action)
- [ ] Get code review approval (requires human)
- [ ] Consider adding caching later (future work, not actionable)
```

### 2. SubagentStop Phase Validation Hook

Implement validation in the `SubagentStop` hook that:
1. Checks if the agent's transcript mentions any `.md` files (plan indicator)
2. If so, scans for plan files in the working directory and validates phase completion
3. Returns `{ continue: true, systemMessage: "..." }` to keep the agent running if validation fails

**Implementation approach:**

```typescript
// In agents/src/runners/shared.ts SubagentStop hook

import { parsePhases } from "../lib/phase-parser.js";

// Helper: Check if agent transcript mentions markdown files
function agentMentionsPlanFile(transcriptPath: string): boolean {
  try {
    const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));
    for (const msg of transcript.messages ?? []) {
      if (msg.type === "user") {
        const content = typeof msg.message?.content === "string"
          ? msg.message.content
          : JSON.stringify(msg.message?.content ?? "");
        if (/\.md\b/i.test(content)) {
          return true;
        }
      }
    }
  } catch {
    // Transcript read failed, skip validation
  }
  return false;
}

// Helper: Find and validate phases in plan files
function findIncompletePlanPhases(workingDir: string): { planPath: string; completed: number; total: number } | null {
  const plansDir = join(workingDir, "plans");
  if (!existsSync(plansDir)) return null;

  // Check all .md files in plans/ for incomplete phases
  const planFiles = readdirSync(plansDir).filter(f => f.endsWith(".md"));
  for (const file of planFiles) {
    const content = readFileSync(join(plansDir, file), "utf-8");
    const phases = parsePhases(content);
    if (phases && phases.total > 0 && phases.completed < phases.total) {
      return {
        planPath: `plans/${file}`,
        completed: phases.completed,
        total: phases.total
      };
    }
  }
  return null;
}

// In SubagentStop hook:
SubagentStop: [
  {
    hooks: [
      async (hookInput: unknown) => {
        const input = hookInput as SubagentStopHookInput;
        const agentId = input.agent_id;
        const transcriptPath = input.agent_transcript_path;

        // Phase validation: only if agent mentions .md files
        if (agentMentionsPlanFile(transcriptPath)) {
          const incomplete = findIncompletePlanPhases(context.workingDir);
          if (incomplete) {
            const remaining = incomplete.total - incomplete.completed;
            logger.warn(`[SubagentStop] Phase validation: ${incomplete.planPath} has ${remaining} incomplete phases`);
            return {
              continue: true,
              systemMessage: `PHASE COMPLETION REQUIRED: The plan "${incomplete.planPath}" has ${remaining} incomplete phase(s) (${incomplete.completed}/${incomplete.total} complete). Please mark completed phases with [x] or remove phases that are not applicable before finishing.`,
            };
          }
        }

        // ... existing completion logic (mark thread status, emit events, etc.)
        const childThreadId = agentIdToChildThreadId.get(agentId);
        if (childThreadId) {
          // ... existing code
        }

        return { continue: true };
      },
    ],
  },
],
```

**Key differences from original proposal:**

1. **Detection via transcript**: Uses `agent_transcript_path` to detect if `.md` files were mentioned, rather than relying on thread-plan association
2. **Direct plan scanning**: Scans `plans/` directory for incomplete phases instead of looking up thread metadata
3. **SDK-native continuation**: Uses `{ continue: true, systemMessage: "..." }` pattern from `end-of-run-validation-hooks.md`

**Safeguards:**
- Only activates if agent mentions `.md` files
- Graceful failure if transcript can't be read
- Clear message explains what's needed

### 3. Inline Plan Reminder

Add a reminder directly in plan files when they're created:

```markdown
## Phases

<!-- IMPORTANT: Mark phases complete with [x] progressively as work is done.
     Only include phases that are implementable within this session. -->

- [ ] Phase 1
- [ ] Phase 2

---
```

This makes the guidance visible in the plan itself, not just in the system prompt.

## Design Decisions

### Should we block stopping or just warn?

**Recommendation: Start with warning/injection, not hard blocking.**

Reasons:
1. Hard blocking could trap agents in loops if phases are genuinely impossible
2. The agent may have valid reasons to stop (error recovery, scope change)
3. A warning lets the agent decide while making the expectation clear

### How aggressive should phase validation be?

**Recommendation: Validate only when plan is explicitly associated with thread.**

The current system associates threads with plans via `planId` in thread metadata. Only validate when this association exists, not for all threads.

### What about partial completion?

**Recommendation: Allow completion with explanation.**

If an agent completes 3/5 phases and explains why the others aren't applicable, that's acceptable. The key is awareness and documentation, not rigid enforcement.

## Implementation Priority

1. **High Priority: Enhanced prompt messaging** - Low effort, immediate impact
2. **Medium Priority: Inline plan reminder** - Helps visibility, easy to add
3. **Lower Priority: Stop hook validation** - More complex, depends on SDK capabilities

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/agent-types/shared-prompts.ts` | Enhance `PLAN_CONVENTIONS` with phase guidelines |
| `agents/src/hooks/phase-completion-validator.ts` | New file for validation logic |
| `agents/src/runners/shared.ts` | Integrate validation into SubagentStop (if feasible) |

## Open Questions

1. ~~Does the SDK's SubagentStop hook support returning an injected message to prevent stop?~~
   **UNCLEAR** - The SDK types show `{ continue: true, systemMessage: "..." }` is valid, but there are NO tests proving this actually works. See "Blockers" below.

2. Should we track phase completion attempts (e.g., log when an agent stops with incomplete phases)?
   **Deferred** - Start with logging, consider metrics later.

3. ~~Should phase validation apply to top-level agents or only sub-agents?~~
   **Sub-agents only** - Top-level agents use the `Stop` hook via `stopHook` option. Sub-agents use `SubagentStop` hook.

## Blockers

### Stop Hook Not Verified to Work

**Critical finding**: The stop hook infrastructure is defined but **not tested**. Key issues:

1. **No harness tests exist** - The `agents/src/runners/shared.integration.test.ts` tests PostToolUse and PostToolUseFailure hooks but NOT Stop or SubagentStop blocking behavior.

2. **stopHook never passed** - In `agents/src/runner.ts`, `runAgentLoop` is called without a `stopHook` argument. The option exists but is unused.

3. **Decision not processed** - The `stopHook` type returns `{ decision: "approve" | "block" }` but there's no code that actually handles the "block" decision to stop the agent.

4. **Previous working commit unknown** - User mentioned there was a commit with a working harness test. Need to find this in git history to understand what actually worked.

### Next Steps Before Implementation

1. **Find the working commit** - Search git history for the harness test that verified stop hook functionality
2. **Understand SDK behavior** - Test whether `{ continue: true, systemMessage }` in SubagentStop actually keeps the agent running
3. **Write a harness test first** - Create a test that verifies the stop/continue behavior before building validation logic on top
