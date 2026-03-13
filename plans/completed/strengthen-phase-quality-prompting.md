# Strengthen Phase Quality Prompting

Agents create phases requiring manual verification or human approval. Fix with minimal prompting.

## Change

In `agents/src/agent-types/shared-prompts.ts` → `PLAN_CONVENTIONS`, add a single rule to the "What Makes a Good Phase" section:

> **Every phase must be something the agent can implement AND verify itself.** No manual testing, human approval, or external action steps.

That's it — one line of reinforcement in the right place.

## Phases

- [x] Add agent-verifiable rule to PLAN_CONVENTIONS

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update immediately - do not batch. Every phase must be something YOU can implement and verify in this session. Delete any phase that requires manual testing, human approval, or external action. --&gt;

---