# Unique Thread Naming Within Worktree

## Overview

Make thread names unique within a worktree for non-archived threads. When the thread naming service generates a name that already exists in the worktree, append a numeric suffix to make it unique.

## Current Behavior

1. Thread is created with no name
2. `initiateThreadNaming()` is called asynchronously (fire-and-forget)
3. `generateThreadName()` generates a name via LLM (or uses short prompt directly)
4. Thread metadata is updated on disk with the generated name
5. `THREAD_NAME_GENERATED` event is emitted
6. Frontend listener refreshes thread from disk

**Problem:** No uniqueness check exists. Multiple threads in the same worktree can have identical names.

## Proposed Solution

Add a uniqueness check after name generation but before persisting to disk. If a conflict exists, append a numeric suffix (e.g., "Fix login bug" → "Fix login bug 2").

### Key Design Decisions

1. **Case-insensitive matching** - "Fix Bug" and "fix bug" are considered duplicates
2. **Archived threads excluded** - Only check against non-archived threads in the worktree
3. **Suffix format** - Use ` 2`, ` 3`, etc. (space + number, no parentheses)
4. **Check location** - In `thread-naming-service.ts` after generation, before disk write

## Implementation

### Step 1: Add Helper to Query Existing Names

Create a helper function in the thread naming service to get existing thread names in a worktree.

**File:** `agents/src/services/thread-naming-service.ts`

```typescript
async function getExistingThreadNamesInWorktree(
  worktreeId: string,
  excludeThreadId: string
): Promise<Set<string>> {
  // Read thread metadata from disk for all threads in worktree
  // This needs to scan the threads directory since agent process
  // doesn't have access to the frontend's Zustand store
  const threadsDir = path.join(getMortPath(), 'threads');
  const threadIds = await fs.readdir(threadsDir).catch(() => []);

  const names = new Set<string>();

  for (const threadId of threadIds) {
    if (threadId === excludeThreadId) continue;

    const metadataPath = path.join(threadsDir, threadId, 'metadata.json');
    try {
      const content = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(content);

      // Only include threads from the same worktree that aren't archived
      if (metadata.worktreeId === worktreeId && metadata.name) {
        names.add(metadata.name.toLowerCase());
      }
    } catch {
      // Thread doesn't exist or metadata unreadable, skip
    }
  }

  return names;
}
```

### Step 2: Add Uniqueness Resolution Function

**File:** `agents/src/services/thread-naming-service.ts`

```typescript
function makeNameUnique(proposedName: string, existingNames: Set<string>): string {
  const lowerName = proposedName.toLowerCase();

  // If name is already unique, return as-is
  if (!existingNames.has(lowerName)) {
    return proposedName;
  }

  // Try appending numbers until we find a unique name
  let counter = 2;
  while (true) {
    const candidate = `${proposedName} ${counter}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    counter++;

    // Safety limit to prevent infinite loop
    if (counter > 100) {
      // Fallback: append timestamp
      return `${proposedName} ${Date.now()}`;
    }
  }
}
```

### Step 3: Integrate into Naming Flow

Modify `initiateThreadNaming()` to check for uniqueness before writing to disk.

**File:** `agents/src/services/thread-naming-service.ts`

```typescript
export async function initiateThreadNaming(
  threadId: string,
  worktreeId: string,  // NEW PARAMETER
  userPrompt: string,
  options?: ThreadNamingOptions
): Promise<void> {
  try {
    // Generate the name (existing logic)
    let name = await generateThreadName(userPrompt, options);

    // NEW: Ensure uniqueness within worktree
    const existingNames = await getExistingThreadNamesInWorktree(worktreeId, threadId);
    name = makeNameUnique(name, existingNames);

    // Update thread metadata (existing logic)
    await updateThreadName(threadId, name);

    // Emit event (existing logic)
    events.threadNameGenerated(threadId, name);
  } catch (error) {
    // Error handling (existing logic)
  }
}
```

### Step 4: Update Callers to Pass worktreeId

Update all calls to `initiateThreadNaming()` to include the worktreeId parameter.

**File:** `agents/src/runners/simple-runner-strategy.ts`

The thread metadata already contains `worktreeId`, so we need to pass it through:

```typescript
// In setup() method where initiateThreadNaming is called
initiateThreadNaming(
  thread.id,
  thread.worktreeId,  // Add this parameter
  userPrompt,
  { /* options */ }
);
```

## Files to Modify

1. **`agents/src/services/thread-naming-service.ts`**
   - Add `getExistingThreadNamesInWorktree()` function
   - Add `makeNameUnique()` function
   - Update `initiateThreadNaming()` signature and logic

2. **`agents/src/runners/simple-runner-strategy.ts`**
   - Update call to `initiateThreadNaming()` to pass `worktreeId`

## Testing

### Unit Tests

Add to `agents/src/services/__tests__/thread-naming-service.test.ts`:

```typescript
describe('makeNameUnique', () => {
  it('returns name unchanged if unique', () => {
    const existing = new Set(['fix bug', 'add feature']);
    expect(makeNameUnique('New Feature', existing)).toBe('New Feature');
  });

  it('appends 2 for first conflict', () => {
    const existing = new Set(['fix bug']);
    expect(makeNameUnique('Fix Bug', existing)).toBe('Fix Bug 2');
  });

  it('increments counter for multiple conflicts', () => {
    const existing = new Set(['fix bug', 'fix bug 2', 'fix bug 3']);
    expect(makeNameUnique('Fix Bug', existing)).toBe('Fix Bug 4');
  });

  it('handles case insensitive matching', () => {
    const existing = new Set(['fix bug']);
    expect(makeNameUnique('FIX BUG', existing)).toBe('FIX BUG 2');
  });
});
```

### Integration Test

Add to `agents/src/testing/__tests__/thread-naming.integration.test.ts`:

```typescript
describe('unique naming within worktree', () => {
  it('generates unique names for threads in same worktree', async () => {
    // Create first thread with prompt "Fix login"
    // Create second thread with same prompt "Fix login"
    // Verify second thread gets name "Fix login 2"
  });

  it('allows duplicate names across different worktrees', async () => {
    // Create thread in worktree A with prompt "Fix login"
    // Create thread in worktree B with same prompt "Fix login"
    // Both should have name "Fix login" (no suffix)
  });
});
```

## Edge Cases

1. **Thread being named has no worktreeId** - Shouldn't happen, but fall back to no uniqueness check
2. **Disk read errors** - Fail open (allow the name even if we can't read existing names)
3. **Race condition** - Two threads named simultaneously could both pass the check. Accept this as low-risk.
4. **Name exceeds 30 char limit after suffix** - Truncate base name to fit suffix within limit

## Migration

No migration needed. Existing duplicate names will remain, but new threads will get unique names going forward.

## Performance Considerations

- Reads all thread metadata from disk to check uniqueness
- This is acceptable because:
  - Naming is already async/fire-and-forget
  - Thread count per worktree is typically small (<100)
  - Only runs once per thread creation
- If performance becomes an issue, could add a lightweight index file
