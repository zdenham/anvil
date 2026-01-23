# Investigation: "@" Results Tray Breakage in Spotlight Component

## Summary

The "@" file trigger in the spotlight results tray stopped working after recent refactoring changes. This document details the investigation findings and identifies the root cause.

## Key Finding: Multi-Repository Support Broke Single-Repo Assumption

The most likely root cause is in how `triggerContext.rootPath` is determined in `spotlight.tsx`.

### The Problem

In `src/components/spotlight/spotlight.tsx` (lines 1046-1048):

```typescript
triggerContext={{
  rootPath: controllerRef.current.getDefaultRepository()?.sourcePath ?? null,
}}
```

The `getDefaultRepository()` method returns a repository **only if exactly one repository exists**. When:
- **No repositories are configured**: Returns `null`
- **Multiple repositories exist**: Returns `null` (introduced by multi-repo support)
- **Exactly one repository exists**: Returns that repository

### The Cascade Effect

When `rootPath` is `null`, the file handler in `src/lib/triggers/handlers/file-handler.ts` (lines 22-24) bails out immediately:

```typescript
if (!context.rootPath) {
  return [];
}
```

This means the "@" trigger returns **empty results** and the results tray shows nothing.

## Timeline of Changes

| Commit | Message | Impact |
|--------|---------|--------|
| `611736d` | "big refactor coming" | Previous working version |
| `2b808a7` | "its working" | Major refactoring: task→thread terminology, multi-repo support, worktree state changes |
| `117bb83` | "fix nasty memory leak" | Only touched test files, no spotlight changes |

## Related Changes in the Refactoring

### 1. Type Renames (task → thread)

**File**: `src/components/spotlight/types.ts`
- `TaskResult` → `ThreadCreationResult`
- `SpotlightResult` union: `{ type: "task" }` → `{ type: "thread" }`

### 2. Worktree Info Structure Changes

**File**: `src/components/spotlight/results-tray.tsx`
- Old: `availableWorktrees: WorktreeState[]`
- New: `repoWorktrees: RepoWorktree[]` with additional `repoCount` field

### 3. Display Results Mapping

**File**: `src/components/spotlight/spotlight.tsx` (lines 395-400)
```typescript
const displayResults: SpotlightResult[] = triggerState.isActive
  ? triggerState.results.map((r) => ({
      type: "file" as const,
      data: { path: r.description, insertText: r.insertText },
    }))
  : results;
```

This mapping appears correct for converting trigger results to spotlight results.

## Code Locations to Examine

1. **Primary Issue**: `src/components/spotlight/spotlight.tsx:1046-1048`
   - `triggerContext.rootPath` assignment

2. **File Handler Bail-Out**: `src/lib/triggers/handlers/file-handler.ts:22-24`
   - Returns empty array when no rootPath

3. **Display Results Mapping**: `src/components/spotlight/spotlight.tsx:395-400`
   - Trigger state to SpotlightResult conversion

4. **Trigger Search Input**: `src/components/reusable/trigger-search-input.tsx`
   - State change callback propagation

## Recommended Fix: Use MRU Worktree + Repository

The fix should use the **Most Recently Used (MRU) worktree's repository** to determine `rootPath`. This aligns with user intent - when typing "@" to insert a file reference, the user most likely wants files from the repository they were most recently working in.

### Implementation

Update `src/components/spotlight/spotlight.tsx` to use the MRU worktree:

```typescript
triggerContext={{
  rootPath: controllerRef.current.getMruWorktree()?.sourcePath ?? null,
}}
```

Or if accessing via repository:

```typescript
const mruWorktree = controllerRef.current.getMruWorktree();
const mruRepo = mruWorktree
  ? controllerRef.current.getRepositoryForWorktree(mruWorktree)
  : null;

triggerContext={{
  rootPath: mruRepo?.sourcePath ?? null,
}}
```

### Why MRU?

1. **User Intent**: The file the user wants to reference is most likely in the repo they were just working in
2. **Consistency**: Aligns with other MRU-based behaviors in the app (e.g., worktree selection)
3. **Multi-Repo Friendly**: Works correctly regardless of how many repositories are configured
4. **No Ambiguity**: Clear, deterministic behavior based on user's recent activity

### Files to Update

1. **`src/components/spotlight/spotlight.tsx`**: Update `triggerContext.rootPath` assignment to use MRU worktree/repo
2. Ensure `controllerRef.current` has access to MRU worktree state (may already exist)

## Verification Steps

1. Configure multiple repositories
2. Work in repo A, then switch to spotlight and type "@" - should show files from repo A
3. Work in repo B, then switch to spotlight and type "@" - should show files from repo B
4. With no repositories configured - should gracefully show no results
