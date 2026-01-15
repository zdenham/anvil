/**
 * Shared prompt sections for DRY agent system prompts.
 * Template variables: {{taskId}}, {{branchName}}, {{threadId}}
 * Commands: `mort` CLI is available in PATH (set by runner)
 */

export const TASK_CONTEXT = `## Current Task Context

Task ID: {{taskId}}
Branch: {{branchName}}

Use \`mort tasks get --id={{taskId}}\` to fetch current task state.`;

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

export const MORT_CLI_CORE = `## Mort CLI Reference

\`\`\`bash
# Get task details
mort tasks get --id=<task-id>
mort tasks get --slug=<task-slug>

# Update task status
mort tasks update --id=<task-id> --status=<status>
# Status: draft|backlog|todo|in-progress|in-review|done|cancelled

# List tasks
mort tasks list
mort tasks list | grep '<pattern>'

# All commands support --json for programmatic output
\`\`\``;

export const MORT_CLI_TASK_MANAGEMENT = `### Task Management

\`\`\`bash
# Rename task (updates title AND regenerates slug)
mort tasks rename --id=<task-id> --title="<new-title>"

# Update task properties
mort tasks update --id=<task-id> --parent-id=<parent-task-id>
\`\`\``;

export const DIRECTORY_STRUCTURE = `## Directory Structure

Mort uses a centralized data directory separate from your code repository:

\`\`\`
{{mortDir}}/                  # Task management data (NOT in your repo)
├── tasks/
│   └── {slug}/
│       ├── metadata.json     # Task metadata
│       └── content.md        # Implementation plan (you write this)
└── threads/
    └── {thread-id}/
        ├── metadata.json
        └── state.json
\`\`\`

**Important**: The \`{{mortDir}}/\` directory is distinct from the code repository. Task data lives here, while code changes happen in the repository working directory.`;

export const EXPLORATION_TOOLS = `## Exploration Tools

- **Read**: Read file contents
- **Glob**: Find files by pattern (e.g., \`**/*.ts\`)
- **Grep**: Search file contents by regex
- **Bash**: Shell commands (use \`mort\` for task operations)`;

export const HUMAN_REVIEW_TOOL = `## Human Review Tool

Request review using:
\`\`\`bash
mort request-human --task={{taskId}} --thread={{threadId}} \\
  --markdown "## Your review content" \\
  --default "Proceed" \\
  --on-approve <agentType> \\
  --on-feedback <agentType>
\`\`\`

**Required flags:**
- \`--thread\`: The current thread ID (identifies which agent thread made the request)
- \`--on-approve\`: Agent to spawn when user approves (presses Enter)
- \`--on-feedback\`: Agent to spawn when user provides feedback text

**Available agent types:**

| Agent | Purpose | Use when... |
|-------|---------|-------------|
| \`research\` | Task routing & planning | Need to refine requirements, break down work, or re-plan |
| \`execution\` | Code implementation | Ready to write code, or need to fix/revise implementation |
| \`merge\` | Git merge/PR creation | User approved, ready to integrate into target branch |

**Common patterns:**
- Research completing plan: \`--on-approve execution --on-feedback research\`
- Execution ready for review: \`--on-approve merge --on-feedback execution\`
- Merge completing: \`--on-approve merge --on-feedback merge\` (user completes task via UI)`;

/**
 * Helper to compose prompt sections with proper spacing.
 */
export function composePrompt(...sections: string[]): string {
  return sections.filter(Boolean).join("\n\n");
}
