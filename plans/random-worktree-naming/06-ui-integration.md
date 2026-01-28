# Sub-Plan 06: UI Integration

## Overview
Update the worktree creation UI to use auto-generated random names instead of requiring user input.

## Dependencies
- **01-random-name-library.md** - Needs `generateUniqueWorktreeName` function
- **05-frontend-event-handling.md** - Should be in place to handle rename events

## Steps

### Step 1: Find Worktree Creation UI

Locate where worktrees are created. Likely candidates:
- `src/components/main-window/worktrees-page.tsx` (deleted according to git status)
- `src/components/spotlight/spotlight.tsx`
- Some command palette action
- A modal or form component

Use grep to find:
```bash
grep -r "worktreeService.create" src/
grep -r "createWorktree" src/
```

### Step 2: Update Creation Flow

**Before (user provides name):**
```typescript
const name = await promptForWorktreeName();
await worktreeService.create(repoId, name);
```

**After (auto-generate name):**
```typescript
import { generateUniqueWorktreeName } from '@/lib/random-name';

// Get existing worktree names to avoid conflicts
const existingWorktrees = await worktreeService.list(repoId);
const existingNames = new Set(existingWorktrees.map(w => w.name));

// Generate unique random name
const name = generateUniqueWorktreeName(existingNames);

// Create with auto-generated name
await worktreeService.create(repoId, name);
```

### Step 3: Add isAutoNamed Flag (Optional)

If tracking auto-named worktrees is desired, update the worktree schema:

**File:** `core/types/repositories.ts`

Add to WorktreeState schema:
```typescript
isAutoNamed: z.boolean().optional().default(true),
```

Then in the creation flow:
```typescript
await worktreeService.create(repoId, name, { isAutoNamed: true });
```

### Step 4: Allow Optional User Override

If the UI previously had a name input, consider keeping it as optional:

```typescript
// If user provides a name, use it; otherwise auto-generate
const name = userProvidedName || generateUniqueWorktreeName(existingNames);
const isAutoNamed = !userProvidedName;

await worktreeService.create(repoId, name, { isAutoNamed });
```

### Step 5: Update Any Name Display UI

If there's UI that shows "Enter worktree name" prompts, update the UX:
- Remove required name field
- Or change to optional with placeholder showing the auto-generated name
- Show that name will be auto-updated after first prompt

## Verification
1. Worktree creation works without user name input
2. Generated names are unique (no conflicts)
3. Generated names are valid format (alphanumeric + hyphen)
4. Optional: User can still provide custom name if desired
5. UI gracefully handles name changes after LLM naming

## Output
- Modified worktree creation component(s)
- Optional: Modified `core/types/repositories.ts`
