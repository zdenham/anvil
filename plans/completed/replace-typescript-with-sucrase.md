# Replace TypeScript with Sucrase for REPL Type-Stripping

## Problem

The `mort-repl` uses `ts.transpileModule()` to strip TypeScript type annotations from agent-written REPL code. This has two issues:

1. **Broken in production** — `typescript` is marked as `external` in tsup.config.ts (because it uses dynamic `require("fs")` that breaks ESM bundling), but it's **not included** in the Tauri bundle resources (`tauri.conf.json` only bundles `@anthropic-ai/**/*` from node_modules)
2. **Massive dependency** — TypeScript is 23MB in node_modules, just to strip type annotations

## Solution: Sucrase

[Sucrase](https://github.com/alangpierce/sucrase) is a pure-JS TypeScript transpiler (~1.1MB unpacked) that:

- **Can be bundled inline** by tsup — no dynamic `require("fs")`, no native binaries. This means it gets compiled directly into `runner.js`, eliminating the need for it in `node_modules` at all
- **Fixes production** — once bundled into runner.js, no separate package needed in Tauri resources
- **20x faster** than TypeScript's transpileModule
- **Purpose-built** for stripping type annotations from modern JS (exactly our use case — ESNext target, no downleveling)

### Why not other alternatives?

| Library | Size | Bundleable? | Notes |
|---------|------|------------|-------|
| `typescript` (current) | 23MB | No (dynamic `require("fs")`) | Broken in production |
| `esbuild` | 10MB | No (native binary) | Platform-specific |
| `ts-blank-space` | ~50KB code | No — **depends on `typescript`** | Still needs the 23MB dep |
| `sucrase` | ~1.1MB | **Yes** (pure JS) | Self-contained parser |
| `swc` / `amaro` | ~5MB | No (native binary) | Platform-specific |

## Phases

- [x] Replace typescript with sucrase in repl-runner.ts
- [x] Update tsup.config.ts to remove typescript from externals
- [x] Update package.json dependencies
- [x] Verify tests pass

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: Replace typescript with sucrase in repl-runner.ts

**File:** `agents/src/lib/mort-repl/repl-runner.ts`

Before:
```typescript
import ts from "typescript";

transpile(code: string): string {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  });
  return result.outputText;
}
```

After:
```typescript
import { transform } from "sucrase";

transpile(code: string): string {
  const result = transform(code, {
    transforms: ["typescript"],
  });
  return result.code;
}
```

### Phase 2: Update tsup.config.ts

Remove `typescript` from the external list since sucrase can be bundled:

```typescript
noExternal: [/^(?!@anthropic-ai\/claude-agent-sdk)/],
external: [],  // or just remove the external line
```

Keep only the SDK as external (it still needs its CLI executable and ripgrep binaries).

### Phase 3: Update package.json

```bash
cd agents && pnpm remove typescript  # remove from dependencies (keep as devDependency)
cd agents && pnpm add sucrase
```

Note: `typescript` should remain as a devDependency for type-checking during development. Only the runtime dependency is removed.

### Phase 4: Verify

- Run existing REPL tests: `cd agents && pnpm test`
- Verify the transpile spike tests still pass
- Build with tsup and confirm no external dependency on typescript in the output
