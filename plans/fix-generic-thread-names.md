# Fix Generic Thread Names

## Problem

Thread names like "implement this plan" or "work on the plan" are useless — they're identical across threads and carry no distinguishing information. The current system prompt is mostly good (it preserves the user's voice and action words), but it doesn't guard against cases where the user's words are entirely generic.

## Phases

- [x] Add a generic-name guard to the SYSTEM_PROMPT in `agents/src/services/thread-naming-service.ts`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Before (current prompt, lines 4-22)

```typescript
const SYSTEM_PROMPT = `You are a thread naming assistant. Generate a short name for a conversation thread based on the user's initial message.

Rules:
- Maximum 30 characters
- Use the user's actual words as much as possible - don't abstract or summarize
- Extract the most distinctive/memorable phrase from their message
- Keep their original phrasing and word choice
- Lowercase is fine, match the user's style
- No quotes or special characters
- Use natural spaces, not kebab-case
- If the message is a question, preserve key question words
- Prefer specific details over generic descriptions

Examples:
- "Can you help me fix the login bug?" → "fix the login bug"
- "What's the best way to implement caching?" → "implement caching"
- "I need to refactor the auth system" → "refactor the auth system"

Respond with ONLY the thread name, nothing else.`;
```

## After (proposed)

```typescript
const SYSTEM_PROMPT = `You are a thread naming assistant. Generate a short name for a conversation thread based on the user's initial message.

Rules:
- Maximum 30 characters
- Use the user's actual words as much as possible - don't abstract or summarize
- Extract the most distinctive/memorable phrase from their message
- Keep their original phrasing and word choice
- Lowercase is fine, match the user's style
- No quotes or special characters
- Use natural spaces, not kebab-case
- If the message is a question, preserve key question words
- Prefer specific details over generic descriptions
- If the message is too vague to extract a distinctive name (e.g. "implement this plan", "work on this"), look for any concrete nouns — file names, feature names, component names — and use those instead

Examples:
- "Can you help me fix the login bug?" → "fix the login bug"
- "What's the best way to implement caching?" → "implement caching"
- "I need to refactor the auth system" → "refactor the auth system"
- "Implement this plan for user auth" → "implement user auth"
- "Work on the thread naming improvements" → "thread naming improvements"

Respond with ONLY the thread name, nothing else.`;
```

## What changed

One new rule and two new examples — everything else is identical.

1. **New rule (last bullet):** Tells the model to look for concrete nouns when the message is vague, rather than just echoing generic verbs like "implement this plan"
2. **New example:** `"Implement this plan for user auth"` → `"implement user auth"` — shows that the action verb is kept but the meaningless "this plan" is dropped in favor of the specific subject
3. **New example:** `"Work on the thread naming improvements"` → `"thread naming improvements"` — shows extracting the specific topic even from a "work on" phrasing

This preserves the existing behavior for all specific messages (the user's voice and action words are still echoed) and only changes behavior for the degenerate case where the message contains nothing distinctive.
