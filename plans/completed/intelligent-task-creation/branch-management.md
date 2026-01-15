# Branch Management

## Naming Convention

Branch names are **slugified from the task title**:

```
task/<slugified-title>
```

Examples:

- Title: "Fix authentication bug" → `task/fix-authentication-bug`
- Title: "Investigate API performance" → `task/investigate-api-performance`
- Title: "Add dark mode toggle" → `task/add-dark-mode-toggle`

## Slug Generation Rules

1. Convert to lowercase
2. Replace spaces and special characters with hyphens
3. Remove consecutive hyphens
4. Trim hyphens from start/end
5. Truncate to 50 characters (preserving word boundaries)

## Conflict Resolution

When a slug conflicts with an existing branch or task:

```
kebab-name-[n]
```

Where `n` starts at 1 and increments:

- `fix-auth-bug` (first)
- `fix-auth-bug-1` (conflict)
- `fix-auth-bug-2` (another conflict)

**Both task slug and branch name must be unique.** The CLI command handles this automatically.

## Branch Behavior by Action

| Action                       | Branch Operation                                      |
| ---------------------------- | ----------------------------------------------------- |
| Create new task              | Create and checkout `task/<slug>` from current branch |
| Associate with existing task | Checkout existing `task/<slug>` branch                |
| Create subtask               | Stay on parent task's branch (inherit)                |
| Handle directly (no task)    | Stay on current branch                                |

## Edge Cases

1. **Uncommitted changes**: Warn user before switching branches if working directory is dirty
2. **Branch doesn't exist**: When associating with existing task whose branch was deleted, recreate from main
3. **Main branch protection**: Never create task branches directly on main; always branch off

## Slug Utilities

See [implementation/data-model.md](./implementation/data-model.md) for the `slugify` and `resolveSlugConflict` utilities.
