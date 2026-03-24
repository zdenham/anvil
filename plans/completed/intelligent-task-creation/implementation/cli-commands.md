# CLI Commands for Task Management

The router sub-agent performs writes **exclusively via CLI commands**. This provides a clean interface and audit trail.

## Commands

Implement in `src-tauri/src/cli/tasks.rs`:

| Command                     | Description             | Output                                                    |
| --------------------------- | ----------------------- | --------------------------------------------------------- |
| `anvil tasks list`           | List all tasks          | JSON array of tasks                                       |
| `anvil tasks show <slug>`    | Show task details       | JSON task object                                          |
| `anvil tasks search <query>` | Search tasks by content | JSON array of matches                                     |
| `anvil tasks create`         | Create new task         | `{ "taskId": "...", "slug": "...", "branchName": "..." }` |
| `anvil tasks create-subtask` | Create subtask          | `{ "taskId": "...", "slug": "...", "parentId": "..." }`   |
| `anvil tasks associate`      | Link thread to task     | `{ "success": true, "taskId": "..." }`                    |

## Create Command Options

```bash
anvil tasks create \
  --title="Fix authentication bug" \
  --description="Users can't log in after password reset" \
  --tags=bug,auth \
  --type=work|investigate
```

## Output Format

All commands output JSON for easy parsing by the router agent.

## Files to Modify

- `src-tauri/src/cli/tasks.rs` - **NEW** - CLI commands implementation
- `src-tauri/src/cli/mod.rs` - Register tasks subcommand
