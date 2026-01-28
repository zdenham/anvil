# Sub-Plan 01: Random Name Library

## Overview
Add the `unique-names-generator` library and create a utility function for generating random worktree names.

## Dependencies
- None (can run in parallel with 02 and 03)

## Steps

### Step 1: Install Library
```bash
pnpm add unique-names-generator
```

### Step 2: Create Random Name Utility

**New File:** `src/lib/random-name.ts`

```typescript
import { uniqueNamesGenerator, adjectives, colors, animals } from 'unique-names-generator';

/**
 * Generate a random worktree name (max 10 characters).
 * Uses color-animal pattern for human-friendly names.
 * Examples: "red-fox", "blue-owl", "teal-cat"
 */
export function generateRandomWorktreeName(): string {
  // Use short dictionaries to stay under 10 chars
  return uniqueNamesGenerator({
    dictionaries: [colors, animals],
    separator: '-',
    length: 2,
    style: 'lowerCase',
  }).slice(0, 10);
}

/**
 * Generate a unique worktree name that doesn't conflict with existing names.
 * Appends numeric suffix if initial name conflicts.
 */
export function generateUniqueWorktreeName(existingNames: Set<string>): string {
  let name = generateRandomWorktreeName();
  let suffix = 1;

  while (existingNames.has(name)) {
    const base = name.slice(0, 7); // Leave room for suffix
    name = `${base}-${suffix}`;
    suffix++;
  }

  return name;
}
```

### Step 3: Add Type Declarations (if needed)

Check if `unique-names-generator` has types. If not, create:

**File:** `src/types/unique-names-generator.d.ts`

```typescript
declare module 'unique-names-generator' {
  export interface Config {
    dictionaries: string[][];
    separator?: string;
    length?: number;
    style?: 'lowerCase' | 'upperCase' | 'capital';
  }
  export function uniqueNamesGenerator(config: Config): string;
  export const adjectives: string[];
  export const colors: string[];
  export const animals: string[];
}
```

## Verification
1. Library installs without errors
2. `generateRandomWorktreeName()` returns valid names (lowercase, alphanumeric + hyphen, ≤10 chars)
3. `generateUniqueWorktreeName()` avoids conflicts correctly

## Output
- `src/lib/random-name.ts` - New utility file
- Updated `package.json` and `pnpm-lock.yaml`
