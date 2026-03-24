# Help Documentation

**File:** `agents/src/cli/anvil.ts`
**Parallel:** Yes (no dependencies)

## Problem

- `anvil` (bare) errors instead of showing help
- No `--help` flags supported
- No help for subcommands

## Solution

### Step 1: Add `showHelp()` function

```typescript
function showHelp(): void {
  console.log(`anvil - Task management CLI for Anvil

USAGE:
  anvil <command> [subcommand] [options]

COMMANDS:
  tasks list              List all tasks
  tasks get               Get task details
  tasks rename            Rename a task (updates title and slug)
  tasks update            Update task properties
  tasks delete            Delete a task
  tasks associate         Associate a thread with a task
  tasks disassociate      Remove thread association

Run 'anvil tasks <subcommand> --help' for detailed help on each command.`);
}
```

### Step 2: Add `showTasksHelp()` function

```typescript
function showTasksHelp(): void {
  console.log(`anvil tasks - Task management commands

SUBCOMMANDS:
  list          List all tasks (--json for JSON output)
  get           Get task by --id or --slug
  rename        Rename task: --id, --title
  update        Update task: --id, --status, --type, --parent-id, --tags, --repo
  delete        Delete task: --id
  associate     Link thread: --task (slug), --thread
  disassociate  Unlink thread: --task-id, --thread

OPTIONS:
  --json        Output as JSON (all commands)
  --help        Show help for command`);
}
```

### Step 3: Add per-command help

```typescript
const COMMAND_HELP: Record<string, string> = {
  list: `anvil tasks list - List all tasks

OPTIONS:
  --json    Output as JSON`,

  get: `anvil tasks get - Get task details

OPTIONS:
  --id      Task ID
  --slug    Task slug (alternative to --id)
  --json    Output as JSON`,

  rename: `anvil tasks rename - Rename a task

OPTIONS:
  --id      Task ID (required)
  --title   New title (required)
  --json    Output as JSON`,

  update: `anvil tasks update - Update task properties

OPTIONS:
  --id          Task ID (required)
  --status      New status (draft|backlog|todo|in-progress|done|pending|in_progress|paused|completed|merged|cancelled)
  --type        Task type (work|investigate)
  --title       New title
  --parent-id   Parent task ID (empty to unset)
  --tags        Comma-separated tags
  --repo        Repository name
  --json        Output as JSON`,

  delete: `anvil tasks delete - Delete a task

OPTIONS:
  --id      Task ID (required)`,

  associate: `anvil tasks associate - Associate thread with task

OPTIONS:
  --task    Task slug (required)
  --thread  Thread ID (required)`,

  disassociate: `anvil tasks disassociate - Remove thread association

OPTIONS:
  --task-id  Task ID (required)
  --thread   Thread ID (required)`,
};

function showCommandHelp(cmd: string): void {
  console.log(COMMAND_HELP[cmd] || `No help available for '${cmd}'`);
}
```

### Step 4: Update main router

```typescript
// At start of main()
if (!command || command === "help" || command === "--help") {
  showHelp();
  process.exit(0);
}

// In tasks command handler
if (!subcommand || subcommand === "--help") {
  showTasksHelp();
  process.exit(0);
}

// In each subcommand, check for --help
if (args.includes("--help")) {
  showCommandHelp(subcommand);
  process.exit(0);
}
```

## Verification

```bash
anvil                     # Shows help, exits 0
anvil help                # Shows help, exits 0
anvil --help              # Shows help, exits 0
anvil tasks               # Shows tasks help, exits 0
anvil tasks --help        # Shows tasks help, exits 0
anvil tasks update --help # Shows update help, exits 0
```
