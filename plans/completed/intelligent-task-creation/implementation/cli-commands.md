# CLI Commands for Task Management

The router sub-agent performs writes **exclusively via CLI commands**. This provides a clean interface and audit trail.

## Commands

Implement in `src-tauri/src/cli/tasks.rs`:

| Command                     | Description             | Output                                                    |
| --------------------------- | ----------------------- | --------------------------------------------------------- |
| `mort tasks list`           | List all tasks          | JSON array of tasks                                       |
| `mort tasks show <slug>`    | Show task details       | JSON task object                                          |
| `mort tasks search <query>` | Search tasks by content | JSON array of matches                                     |
| `mort tasks create`         | Create new task         | `{ "taskId": "...", "slug": "...", "branchName": "..." }` |
| `mort tasks create-subtask` | Create subtask          | `{ "taskId": "...", "slug": "...", "parentId": "..." }`   |
| `mort tasks associate`      | Link thread to task     | `{ "success": true, "taskId": "..." }`                    |

## Create Command Options

```bash
mort tasks create \
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
