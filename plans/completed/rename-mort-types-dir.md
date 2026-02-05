# Plan: Rename `.mort` to `mort-types` in Quick Actions Projects

## Problem

The quick actions project at `~/.mort/quick-actions/` contains a `.mort` subdirectory for SDK type definitions. This is confusing because:
- The parent data directory is also called `.mort` (e.g., `~/.mort`)
- The naming collision makes it unclear which `.mort` is being referenced
- Users may confuse the types directory with the main data directory

## Solution

Rename the `.mort` subdirectory within quick actions projects to `mort-types/`. This makes the purpose clearer and avoids confusion with the main `.mort` data directory.

**Before:**
```
~/.mort/
└── quick-actions/
    └── .mort/           <-- confusing
        ├── sdk.d.ts
        └── version.json
```

**After:**
```
~/.mort/
└── quick-actions/
    └── mort-types/      <-- clear purpose
        ├── sdk.d.ts
        └── version.json
```

## Files to Change

### 1. Template Files

**`core/sdk/template/tsconfig.json`** (line 14)
- Change: `"./.mort/sdk.d.ts"` → `"./mort-types/sdk.d.ts"`

**`core/sdk/template/.mort/`** (directory)
- Rename directory: `.mort/` → `mort-types/`
- Contents remain the same (sdk.d.ts, version.json)

### 2. Migration Code

**`migrations/src/migrations/001-quick-actions-project.ts`**
- Line 22: Change constant `MORT_TYPES_DIR = '.mort'` → `MORT_TYPES_DIR = 'mort-types'`
- Line 74: Update comment "Create .mort directory..." → "Create mort-types directory..."
- Line 81: Update comment "Copy SDK types to .mort directory" → "Copy SDK types to mort-types directory"
- Line 102: Update comment "Ensure .mort directory exists" → "Ensure mort-types directory exists"

### 3. Frontend Initialization

**`src/lib/quick-actions-init.ts`**
- Line 27: Change constant `MORT_TYPES_DIR = '.mort'` → `MORT_TYPES_DIR = 'mort-types'`
- Line 121: Update comment "Create .mort directory..." → "Create mort-types directory..."
- Line 128: Update comment "Copy SDK types to .mort directory..." → "Copy SDK types to mort-types directory..."
- Line 209: Update comment "Ensure .mort directory exists" → "Ensure mort-types directory exists"

### 4. Documentation (if present)

Check and update any README or documentation that references the `.mort` subdirectory within quick actions:
- `core/sdk/template/README.md` (if it exists and mentions `.mort`)

## Implementation Steps

1. **Rename template directory**
   - `git mv core/sdk/template/.mort core/sdk/template/mort-types`

2. **Update tsconfig.json path alias**
   - Edit `core/sdk/template/tsconfig.json`
   - Change path from `./.mort/sdk.d.ts` to `./mort-types/sdk.d.ts`

3. **Update migration constant and comments**
   - Edit `migrations/src/migrations/001-quick-actions-project.ts`
   - Update `MORT_TYPES_DIR` constant
   - Update related comments

4. **Update frontend init constant and comments**
   - Edit `src/lib/quick-actions-init.ts`
   - Update `MORT_TYPES_DIR` constant
   - Update related comments

5. **Verify build**
   - Run build to ensure no broken references
   - Check that TypeScript path resolution still works

## Verification

After implementation:
1. Delete existing `~/.mort-dev/quick-actions/` directory (or your test directory)
2. Restart the app to trigger project initialization
3. Verify the new `mort-types/` directory is created with `sdk.d.ts` and `version.json`
4. Verify TypeScript can resolve `@mort/sdk` imports in the template
5. Run the quick actions build to ensure actions compile correctly

## Notes

- No backwards compatibility needed per user request
- The original `.mort` naming was chosen to be "safe from pnpm install" (hidden directory) - `mort-types/` is also safe since it's not a standard npm convention
- The SDK types mechanism (DD #4, #22) remains unchanged - only the directory name changes
