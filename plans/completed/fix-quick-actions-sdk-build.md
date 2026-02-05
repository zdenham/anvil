# Fix Quick Actions SDK Build - Ambient Types Approach

## Problem

When running `pnpm build` in the quick-actions directory, the build fails because `@mort/sdk` cannot be resolved at runtime during manifest generation.

## Root Cause

The current design requires action files to `import { defineAction } from '@mort/sdk'`. This creates a module resolution problem:
- TypeScript compilation works (via `tsconfig.json` paths)
- esbuild marks `@mort/sdk` as external (correct - SDK is injected at runtime)
- Manifest generation imports the built JS files, which still contain `import { defineAction } from "@mort/sdk"`
- Node/tsx cannot resolve `@mort/sdk` because it doesn't exist as a real module

## Solution: Remove the Import Entirely

The `defineAction` function is an identity function - it just returns what you pass it. Its only purpose is providing type inference. We can achieve the same DX with **ambient type declarations** and eliminate the import entirely.

### New Action File Format

**Before:**
```typescript
import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'archive',
  title: 'Archive',
  contexts: ['thread'],
  execute(context, sdk) {
    sdk.threads.archive(context.threadId);
  }
});
```

**After:**
```typescript
export default {
  id: 'archive',
  title: 'Archive',
  contexts: ['thread'],
  execute(context, sdk) {
    sdk.threads.archive(context.threadId);
  }
} satisfies QuickActionDefinition;
```

The `satisfies` keyword provides full type checking and inference without needing an import.

### Implementation Steps

#### 1. Update `mort-types/sdk.d.ts` to be ambient

Convert from a module declaration to a global ambient declaration:

```typescript
// mort-types/sdk.d.ts

// Make types globally available (no import needed)
declare global {
  interface QuickActionExecutionContext {
    contextType: 'thread' | 'plan' | 'empty';
    threadId?: string;
    planId?: string;
    // ... rest of interface
  }

  interface MortSDK {
    git: GitService;
    threads: ThreadService;
    // ... rest of interface
  }

  interface QuickActionDefinition {
    id: string;
    title: string;
    description?: string;
    contexts: ('thread' | 'plan' | 'empty' | 'all')[];
    execute: (context: QuickActionExecutionContext, sdk: MortSDK) => Promise<void> | void;
  }

  // ... other interfaces
}

export {}; // Makes this a module (required for declare global)
```

#### 2. Update `tsconfig.json` to include ambient types

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "mort-types/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Remove the `paths` config since we no longer need `@mort/sdk` resolution.

#### 3. Update all action files

Remove the import and add `satisfies`:

```typescript
// src/actions/archive.ts
export default {
  id: 'archive',
  title: 'Archive',
  description: 'Complete and file away',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.archive(context.threadId);
    } else if (context.contextType === 'plan' && context.planId) {
      await sdk.plans.archive(context.planId);
    }
  },
} satisfies QuickActionDefinition;
```

#### 4. Update `build.ts` - simplify esbuild config

Remove the `external: ['@mort/sdk']` since there's nothing to externalize:

```typescript
await esbuild.build({
  entryPoints: [path.join(actionsDir, file)],
  outdir: path.join(outDir, 'actions'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: false,
});
```

#### 5. Update `core/sdk/types.ts` - remove `defineAction`

Remove the `defineAction` function since it's no longer needed:

```typescript
// Remove this:
// export function defineAction(def: QuickActionDefinition): QuickActionDefinition {
//   return def;
// }
```

#### 6. Update template README

Update documentation to show the new pattern without imports.

### Files to Modify

| File | Change |
|------|--------|
| `core/sdk/template/mort-types/sdk.d.ts` | Convert to ambient global declarations |
| `core/sdk/template/tsconfig.json` | Remove paths, include mort-types |
| `core/sdk/template/src/actions/*.ts` | Remove import, add `satisfies` |
| `core/sdk/template/build.ts` | Remove `external: ['@mort/sdk']` |
| `core/sdk/types.ts` | Remove `defineAction` function |
| `core/sdk/template/README.md` | Update examples |

### Benefits

1. **No module resolution issues** - nothing to resolve at build or runtime
2. **Same type safety** - `satisfies` provides full type checking and inference
3. **Simpler mental model** - just export an object, types are ambient
4. **Faster builds** - no external module handling needed
5. **Works everywhere** - node, tsx, bun, deno - no runtime quirks

### Build-time Validation

TypeScript already validates the shape at compile time. The `satisfies` keyword ensures:
- `id` is a string
- `title` is a string
- `contexts` contains valid values
- `execute` has the correct signature

If any of these are wrong, `tsc` fails the build. The runner also does runtime validation as a safety net.

### Migration for Existing User Projects

Users with existing quick action projects will need to:
1. Update their action files (remove import, add `satisfies`)
2. Their `tsconfig.json` will be updated when they sync the template

This is a breaking change but the migration is mechanical and straightforward.
