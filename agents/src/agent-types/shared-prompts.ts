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

Define phases within a dedicated \`## Phases\` section (required for detection):

\`\`\`markdown
## Phases

- [ ] Research and design
- [ ] Implement core functionality
- [ ] Add tests
- [ ] Documentation
- [x] Code review (completed)

---
\`\`\`

- The section must be delimited by the next \`##\` heading or \`---\` horizontal rule
- Mark phases complete with \`[x]\` as work progresses
- Keep phases at the top level (not nested under other list items)
- Use clear, actionable phase descriptions`;

/**
 * Helper to compose prompt sections with proper spacing.
 */
export function composePrompt(...sections: string[]): string {
  return sections.filter(Boolean).join("\n\n");
}
