/**
 * Shared prompt sections for DRY agent system prompts.
 */

export const SUB_AGENT_POLICY = `## Sub-Agent Execution Policy

IMPORTANT: Do not use \`run_in_background: true\` when invoking the Task tool unless the user explicitly requests background execution.

For parallel work, launch multiple Task tools in a single message - these run concurrently while maintaining full streaming visibility for the user.

Background agents (\`run_in_background: true\`) should only be used when the user explicitly requests phrases like "run in background", "fire and forget", or "don't wait for it".`;

export const PLAN_CONVENTIONS = `## Plan File Conventions

- Folder-based plans: use \`readme.md\` as parent, siblings as children
- Single-file plans: place directly in \`plans/\` directory
- Naming: kebab-case (e.g., \`user-auth.md\`)
- Create parent plans before children

### Phase Tracking

**RULE: Update plan phases immediately.** After completing each phase, mark it \`[x]\` BEFORE starting the next phase. Never batch phase updates.

Define phases within a dedicated \`## Phases\` section (required for detection).
**CRITICAL**: Always include the instruction comment after the phase list - sub-agents may not have access to these conventions.

\`\`\`markdown
## Phases

- [ ] Research and design
- [ ] Implement core functionality
- [ ] Add tests
- [x] Code review (completed)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
\`\`\`

- The section must be delimited by the next \`##\` heading or \`---\` horizontal rule
- Mark phases complete with \`[x]\` as work progresses
- Keep phases at the top level (not nested under other list items)
- Use clear, actionable phase descriptions
- **Always include the HTML comment instruction** - it's visible to agents but not rendered in markdown viewers

#### Phase Completion Requirements

**CRITICAL: You MUST mark phases complete as you finish them.**

- Update the plan file IMMEDIATELY after completing each phase
- Do NOT wait until the end to mark multiple phases complete
- Do NOT stop working with incomplete phases unless blocked
- If a phase cannot be completed, remove it with a note or complete it before finishing

**Before you finish working on a plan, verify:**
1. All phases are marked \`[x]\` complete
2. Any phases you couldn't complete have been removed or explained
3. The phase list accurately reflects the work done

#### What Makes a Good Phase

**Phases MUST be:** implementable in this session, within scope, concrete and verifiable.

**Phases MUST NOT include:** deployment, manual testing, human approval steps, or vague future work.

**Good phases:**
- [ ] Add validation to user input form
- [ ] Write unit tests for validation logic

**Bad phases:**
- [ ] Deploy to production ← requires external action
- [ ] Consider adding caching later ← vague future work

#### Delegating to Sub-Agents

When using the Task tool to delegate work on a plan to a sub-agent, **always include explicit instructions** about marking phases complete. Sub-agents do not have access to these conventions.

Include in your Task prompt:
- The path to the plan file
- Which phase(s) they are responsible for
- Explicit instruction: "After completing each phase, update the plan file to mark it complete with \`[x]\`"

Example Task prompt:
\`\`\`
Implement the validation logic defined in plans/user-auth.md phase 2.
After completing the phase, update the plan file to mark phase 2 complete with [x].
\`\`\``;

/**
 * Helper to compose prompt sections with proper spacing.
 */
export function composePrompt(...sections: string[]): string {
  return sections.filter(Boolean).join("\n\n");
}
