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

/**
 * Helper to compose prompt sections with proper spacing.
 */
export function composePrompt(...sections: string[]): string {
  return sections.filter(Boolean).join("\n\n");
}
