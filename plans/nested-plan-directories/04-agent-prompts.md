# Agent Prompts - Plan Conventions

## Overview

Update the agent system prompt to guide proper plan file organization when creating nested plans.

**Dependencies**: None
**Parallel with**: 01-data-layer, 02-tree-state

---

## Implementation

### 1. Locate System Prompt

Find the agent system prompt definition. Likely locations:
- `agents/src/prompts/simple-agent.ts`
- `src/agents/prompts.ts`
- Similar path containing system prompt templates

### 2. Add Plan Conventions Section

Add the following section to the agent system prompt:

```markdown
## Plan File Conventions

When creating or organizing plan files:

1. **Folder-based plans**: When a plan needs to be broken down into multiple files, create a folder structure:
   - Use `readme.md` as the main/overview plan in the folder
   - Child plans go in the same folder alongside the readme.md
   - Example structure:
     ```
     plans/
       auth/
         readme.md      <- Main auth plan (parent)
         login.md       <- Child plan
         oauth.md       <- Child plan
     ```

2. **Single-file plans**: For simpler plans that don't need breakdown:
   - Place directly in the plans directory: `plans/my-feature.md`

3. **Nesting deeper**: For complex features with sub-features:
   ```
   plans/
     auth/
       readme.md           <- Main auth plan
       login/
         readme.md         <- Main login plan (child of auth)
         password-reset.md <- Child of login
       oauth/
         readme.md         <- Main oauth plan (child of auth)
         google.md         <- Child of oauth
   ```

4. **Naming**: Use kebab-case for plan filenames (e.g., `user-authentication.md`)

5. **Creating nested plans**: When creating a nested plan structure, create parent plans first:
   - ✅ First create `plans/auth/readme.md`, then `plans/auth/login.md`
   - ❌ Don't create `plans/auth/login.md` without a parent plan existing

   If you need to create a deeply nested plan, create the hierarchy top-down:
   1. `plans/auth/readme.md` (main auth plan)
   2. `plans/auth/oauth/readme.md` (oauth sub-plan)
   3. `plans/auth/oauth/google.md` (specific implementation)
```

### 3. Integration Points

Ensure the prompt section is included in:
- Plan creation context (when agent is asked to create a plan)
- Plan editing context (when agent modifies plan structure)
- General agent system prompt (for awareness during all interactions)

---

## Checklist

- [ ] Locate agent system prompt file
- [ ] Add "Plan File Conventions" section to prompt
- [ ] Verify prompt is loaded in relevant agent contexts
- [ ] Test that agent follows conventions when creating nested plans
