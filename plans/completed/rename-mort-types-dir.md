# Plan: Rename `.anvil` to `anvil-types` in Quick Actions Projects

## Problem

The quick actions project at `~/.anvil/quick-actions/` contains a `.anvil` subdirectory for SDK type definitions. This is confusing because:
- The parent data directory is also called `.anvil` (e.g., `~/.anvil`)
- The naming collision makes it unclear which `.anvil` is being referenced
- Users may confuse the types directory with the main data directory

## Solution

Rename the `.anvil` subdirectory within quick actions projects to `anvil-types/`. This makes the purpose clearer and avoids confusion with the main `.anvil` data directory.

**Before:**
```
~/.anvil/
└── quick-actions/
    └── .anvil/           <-- confusing
        ├── sdk.d.ts
        └── version.json
```

**After:**
```
~/.anvil/
└── quick-actions/
    └── anvil-types/      <-- clear purpose
        ├── sdk.d.ts
        └── version.json
```

## Files to Change

### 1. Template Files

**`core/sdk/template/tsconfig.json`** (line 14)
- Change: `"./.anvil/sdk.d.ts"` → `"./anvil-types/sdk.d.ts"`

**`core/sdk/template/.anvil/`** (directory)
- Rename directory: `.anvil/` → `anvil-types/`
- Contents remain the same (sdk.d.ts, version.json)

### 2. Migration Code

**`migrations/src/migrations/001-quick-actions-project.ts`**
- Line 22: Change constant `ANVIL_TYPES_DIR = '.anvil'` → `ANVIL_TYPES_DIR = 'anvil-types'`
- Line 74: Update comment "Create .anvil directory..." → "Create anvil-types directory..."
- Line 81: Update comment "Copy SDK types to .anvil directory" → "Copy SDK types to anvil-types directory"
- Line 102: Update comment "Ensure .anvil directory exists" → "Ensure anvil-types directory exists"

### 3. Frontend Initialization

**`src/lib/quick-actions-init.ts`**
- Line 27: Change constant `ANVIL_TYPES_DIR = '.anvil'` → `ANVIL_TYPES_DIR = 'anvil-types'`
- Line 121: Update comment "Create .anvil directory..." → "Create anvil-types directory..."
- Line 128: Update comment "Copy SDK types to .anvil directory..." → "Copy SDK types to anvil-types directory..."
- Line 209: Update comment "Ensure .anvil directory exists" → "Ensure anvil-types directory exists"

### 4. Documentation (if present)

Check and update any README or documentation that references the `.anvil` subdirectory within quick actions:
- `core/sdk/template/README.md` (if it exists and mentions `.anvil`)

## Implementation Steps

1. **Rename template directory**
   - `git mv core/sdk/template/.anvil core/sdk/template/anvil-types`

2. **Update tsconfig.json path alias**
   - Edit `core/sdk/template/tsconfig.json`
   - Change path from `./.anvil/sdk.d.ts` to `./anvil-types/sdk.d.ts`

3. **Update migration constant and comments**
   - Edit `migrations/src/migrations/001-quick-actions-project.ts`
   - Update `ANVIL_TYPES_DIR` constant
   - Update related comments

4. **Update frontend init constant and comments**
   - Edit `src/lib/quick-actions-init.ts`
   - Update `ANVIL_TYPES_DIR` constant
   - Update related comments

5. **Verify build**
   - Run build to ensure no broken references
   - Check that TypeScript path resolution still works

## Verification

After implementation:
1. Delete existing `~/.anvil-dev/quick-actions/` directory (or your test directory)
2. Restart the app to trigger project initialization
3. Verify the new `anvil-types/` directory is created with `sdk.d.ts` and `version.json`
4. Verify TypeScript can resolve `@anvil/sdk` imports in the template
5. Run the quick actions build to ensure actions compile correctly

## Notes

- No backwards compatibility needed per user request
- The original `.anvil` naming was chosen to be "safe from pnpm install" (hidden directory) - `anvil-types/` is also safe since it's not a standard npm convention
- The SDK types mechanism (DD #4, #22) remains unchanged - only the directory name changes
