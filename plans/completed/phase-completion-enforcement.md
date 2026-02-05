# Phase Completion Enforcement

## Problem Statement

Agents are sometimes forgetting to mark phases as complete in plans as they finish work. Additionally, phases are sometimes:
1. Not implementable by the agent (e.g., manual testing, deployment)
2. Outside the scope of the plan (e.g., future work, nice-to-haves)

This leads to stale phase tracking and reduces the usefulness of the feature.

## Phases

- [x] Update plan prompt with stronger phase completion guidance

---

## Solution

Enhanced `PLAN_CONVENTIONS` in `agents/src/agent-types/shared-prompts.ts` with:

1. **Clear criteria for what makes a good phase** - Must be implementable by the agent within the session, no external dependencies
2. **Explicit examples of bad phases** - Deploy to production, get code review, manual QA, future considerations
3. **Strong completion requirements** - Must mark phases complete immediately, not at the end
4. **Pre-finish checklist** - Verify all phases marked complete or removed before stopping

## Files Modified

| File | Change |
|------|--------|
| `agents/src/agent-types/shared-prompts.ts` | Enhanced `PLAN_CONVENTIONS` with detailed phase guidelines |
