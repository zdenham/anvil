# Mort Quick Actions

This directory contains your custom quick actions for Mort.

## Quick Start

1. Create a new file in `src/actions/` (e.g., `my-action.ts`)
2. Run `npm run build` to compile
3. Click "Refresh Actions" in Mort settings

## Writing an Action

```typescript
export default {
  id: 'my-action',           // Unique identifier (slug)
  title: 'My Action',        // Display name
  description: 'Optional description',
  contexts: ['thread'],      // Where to show: 'thread', 'plan', 'empty', or 'all'

  async execute(context, sdk) {
    // Your code here
    // context: information about current view
    // sdk: Mort services (git, threads, plans, ui, log)

    await sdk.ui.showToast('Hello!', 'success');
  },
} satisfies QuickActionDefinition;
```

Types are ambient (globally available) - no imports needed. The `satisfies` keyword provides full type checking.

## Available SDK Services

### `sdk.threads`
- `get(threadId)` - Get thread info
- `list()` - List all threads
- `archive(threadId)` - Archive a thread
- `markRead(threadId)` / `markUnread(threadId)`

### `sdk.plans`
- `get(planId)` - Get plan info
- `list()` - List all plans
- `archive(planId)` - Archive a plan

### `sdk.ui`
- `showToast(message, type)` - Show notification
- `navigateToThread(threadId)` - Navigate to thread
- `navigateToPlan(planId)` - Navigate to plan
- `navigateToNextUnread()` - Go to next unread item
- `setInputContent(content)` - Set input field content
- `focusInput()` - Focus the input field

### `sdk.git`
- `getCurrentBranch(path)` - Get current branch
- `getDefaultBranch(path)` - Get main/master branch
- `listBranches(path)` - List all branches

### `sdk.log`
- `info(message, data)` / `warn()` / `error()` / `debug()`

## Context Object

The `context` parameter tells you where the action was invoked:

```typescript
interface QuickActionExecutionContext {
  contextType: 'thread' | 'plan' | 'empty';
  threadId?: string;      // Set when contextType is 'thread'
  planId?: string;        // Set when contextType is 'plan'
  repository: { id, name, path } | null;
  worktree: { id, path, branch } | null;
}
```

## Tips

- Actions have a 30-second timeout
- Use `sdk.log` for debugging (appears in Mort's logs)
- Test with the example action first
- Run `npm run watch` for auto-rebuild during development
