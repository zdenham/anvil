/**
 * Shared prompt sections for DRY agent system prompts.
 */

export const COMMIT_STRATEGY = `## Per-File Commit Strategy

Commit each file change individually as you work.

After editing or creating a file:
\`\`\`bash
git add <file>
git commit -m "type: concise description"
\`\`\`

Conventional commit types:
- \`feat:\` - New feature
- \`fix:\` - Bug fix
- \`refactor:\` - Code restructuring
- \`docs:\` - Documentation
- \`test:\` - Test additions/changes
- \`chore:\` - Build/tooling changes

This ensures each change is independently reviewable and revertable.`;

export const MINIMAL_CHANGES = `## Minimal Changes Philosophy

- Only change what's necessary to complete the task
- Don't refactor unrelated code
- Don't add features beyond what's specified
- Don't add comments/docs unless requested
- Don't add error handling for impossible cases
- Keep implementations simple and direct`;

export const EXPLORATION_TOOLS = `## Exploration Tools

- **Read**: Read file contents
- **Glob**: Find files by pattern (e.g., \`**/*.ts\`)
- **Grep**: Search file contents by regex
- **Bash**: Shell commands for git and other operations`;

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

#### What Makes a Good Phase

**Phases MUST be:**
- Implementable by you within this session (no external dependencies)
- Within scope of the plan's stated objective
- Concrete and verifiable (not vague or aspirational)

**Phases MUST NOT include:**
- Manual testing or deployment steps (you can't do these)
- Future work or "nice-to-haves" (do them now or don't list them)
- Steps requiring human approval or external services
- Research that won't be acted upon in this session

**Good phases:**
- [ ] Add validation to user input form
- [ ] Write unit tests for validation logic
- [ ] Update error messages for clarity

**Bad phases (never include these):**
- [ ] Deploy to production ← requires external action
- [ ] Get code review approval ← requires human
- [ ] Consider adding caching later ← vague future work
- [ ] Manual QA testing ← you cannot do this

#### Phase Completion Requirements

**CRITICAL: You MUST mark phases complete as you finish them.**

- Update the plan file IMMEDIATELY after completing each phase
- Do NOT wait until the end to mark multiple phases complete
- Do NOT stop working with incomplete phases unless blocked
- If a phase cannot be completed, either:
  1. Remove it from the plan with a note explaining why, OR
  2. Complete it before finishing

**Before you finish working on a plan, verify:**
1. All phases are marked \`[x]\` complete
2. Any phases you couldn't complete have been removed or explained
3. The phase list accurately reflects the work done

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
