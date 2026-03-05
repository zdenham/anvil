# Phase Update Reminders

Agents frequently wait until the end of a session to batch-update plan phase checkmarks instead of marking each phase `[x]` immediately upon completion. This plan adds two reinforcement mechanisms to fix that behavior.

## Problem

Despite `PLAN_CONVENTIONS` in the system prompt instructing agents to update phases immediately, agents often defer phase updates to the end. The instructions are buried in a long prompt and easily deprioritized once the agent is deep in implementation work.

## Approach

Two complementary mechanisms:

### 1. PostToolUse `additionalContext` injection (primary mechanism)

The SDK's `PostToolUseHookSpecificOutput` supports an `additionalContext?: string` field that gets injected back into the conversation as context for the agent. We use this to inject a phase-update reminder after file-modifying tools when the thread is associated with a plan with incomplete phases.

**How it works:**
- In the PostToolUse hook in `agents/src/runners/shared.ts`, after processing file changes, check if the current thread has a plan with incomplete phases
- Track the plan's phase info in the closure (already parsed via `parsePhases()` at line ~922)
- When the agent edits/writes non-plan files AND the thread's plan has `phaseInfo.completed < phaseInfo.total`, return `additionalContext` with a short reminder
- Throttle to avoid spamming: only inject once every N tool uses (e.g., every 5 file-modifying tools), or after detecting the agent just completed a logical unit of work
- The reminder text is short and actionable: `"Reminder: If you've completed a plan phase, update the plan file now — mark it [x] before continuing."`

**Key files:**
- `agents/src/runners/shared.ts` — PostToolUse hook (line ~865)
- Phase info already tracked at line ~922 via `parsePhases()`

**Tradeoffs:**
- Pro: Fires at exactly the right time (during implementation work), doesn't depend on agent behavior
- Pro: `additionalContext` is a first-class SDK feature designed for this
- Con: Adds context tokens to every Nth tool use; mitigated by throttling and short message
- Con: Only fires when the agent modifies files; if the agent does a long chain of Bash commands without Edit/Write, no reminder fires. Acceptable since most implementation involves file edits.

### 2. Strengthen system prompt in `PLAN_CONVENTIONS` (secondary mechanism)

Update the `PLAN_CONVENTIONS` constant in `agents/src/agent-types/shared-prompts.ts` to make the phase-update instruction more prominent and harder to ignore.

**Changes:**
- Move the "Phase Completion Requirements" section higher (before "What Makes a Good Phase") so it's seen first
- Add a short, bold callout at the very top of the Phase Tracking section: a single sentence about updating phases immediately
- Trim the "What Makes a Good Phase" and "Bad phases" examples — they consume prompt space but are less important than the completion requirement

**Key files:**
- `agents/src/agent-types/shared-prompts.ts` — `PLAN_CONVENTIONS` constant

## Phases

- [x] Add PostToolUse `additionalContext` phase reminder injection in `shared.ts`
- [x] Strengthen `PLAN_CONVENTIONS` prompt in `shared-prompts.ts`
- [x] Add unit test for the reminder injection logic

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: PostToolUse additionalContext injection

In `agents/src/runners/shared.ts`, the PostToolUse hook already parses phases when a plan file is modified (line ~922). We need to:

1. Add a closure variable `currentPlanPhaseInfo: PhaseInfo | null` that persists across tool uses
2. Update it whenever `parsePhases()` runs on a plan file
3. Also initialize it at loop start if the thread already has a `planId` in metadata (for resumed sessions)
4. Add a counter `fileModToolsSinceLastReminder` to throttle
5. After the file-change tracking block (line ~988), if:
   - `currentPlanPhaseInfo` exists AND `completed < total`
   - Tool was a file-modifying tool on a non-plan file
   - `fileModToolsSinceLastReminder >= 5`

   Then return:
   ```typescript
   return {
     hookSpecificOutput: {
       hookEventName: "PostToolUse" as const,
       additionalContext: "Reminder: If you've completed a plan phase, update the plan file now — mark it [x] before continuing to the next phase.",
     },
   };
   ```
   And reset the counter.

### Phase 2: Strengthen system prompt

Restructure `PLAN_CONVENTIONS` to front-load the completion requirement:

```
### Phase Tracking

**RULE: Update plan phases immediately.** After completing each phase, edit the plan file
to mark it `[x]` BEFORE starting the next phase. Never batch phase updates.

Define phases within a dedicated `## Phases` section (required for detection).
...
```

Move "Phase Completion Requirements" to right after the format example, before "What Makes a Good Phase". Trim the bad-phase examples to 2 lines instead of 4.

### Phase 3: Unit test

Add a test in `agents/src/runners/__tests__/` that verifies:
- The PostToolUse hook returns `additionalContext` when phase info has incomplete phases and throttle threshold is met
- The hook does NOT return `additionalContext` when all phases are complete
- The throttle counter resets after a reminder fires
- The hook does NOT fire for plan file edits (only non-plan file edits)
