# Agent Prompts - Plan Conventions

## Overview

Add a brief prompt section for plan file organization conventions.

**Dependencies**: None
**Parallel with**: 01-data-layer, 02-tree-state

---

## Implementation

### 1. Add to shared-prompts.ts

In `agents/src/agent-types/shared-prompts.ts`, add:

```typescript
export const PLAN_CONVENTIONS = `## Plan File Conventions

- Folder-based plans: use \`readme.md\` as parent, siblings as children
- Single-file plans: place directly in \`plans/\` directory
- Naming: kebab-case (e.g., \`user-auth.md\`)
- Create parent plans before children`;
```

### 2. Include in simple agent

In `agents/src/agent-types/simple.ts`, use `composePrompt()` to append the section to the agent's `appendedPrompt`.

---

## Checklist

- [ ] Add `PLAN_CONVENTIONS` to `shared-prompts.ts`
- [ ] Include in simple agent via `composePrompt()`
