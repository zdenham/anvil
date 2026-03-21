# Fix: `require is not defined` in terminal-manager.ts

## Problem

When creating a Claude TUI session (or any terminal), the sidecar crashes with:

```
[ERROR] [TerminalService] Failed to create terminal {"error":{}}
[ERROR] [thread-creation-service] Failed to spawn Claude TUI … "require is not defined"
```

## Root Cause

`sidecar/src/managers/terminal-manager.ts` lines 18-36 use bare `require()` and `require.resolve()`:

```ts
// line 24
const helperPath = join(dirname(require.resolve("node-pty/package.json")), ...);
// line 34
nodePty = require("node-pty") as typeof import("node-pty");
```

The sidecar package is `"type": "module"` (ESM). In production, `tsup` bundles everything and injects a banner:

```js
import { createRequire } from "module"; const require = createRequire(import.meta.url);
```

But in **dev mode**, the sidecar runs via `tsx watch src/server.ts` — which executes source files directly without the tsup banner. Since ESM has no global `require`, the call fails.

## Fix

Replace the bare `require`/`require.resolve` calls in `terminal-manager.ts` with an explicit `createRequire` at the top of the file:

```ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
```

This makes the file self-contained — it works both when tsx runs the source directly (dev) and when tsup bundles it (prod). The tsup banner becomes redundant for this file but harmless.

### Alternatively (ESM-pure approach)

Replace `require("node-pty")` with a dynamic `import()` and `require.resolve` with `import.meta.resolve` + `fileURLToPath`. This is more idiomatic but requires making `getNodePty()` async, which ripples into `TerminalManager.spawn()` becoming async. The `createRequire` approach is simpler and lower-risk.

## Phases

- [x] Add `import { createRequire } from "node:module"` and `const require = createRequire(import.meta.url)` to `sidecar/src/managers/terminal-manager.ts`, replacing the bare `require` usage
- [x] Verify the sidecar still builds (`cd sidecar && pnpm build`)
- [ ] Smoke test: start dev mode and create a TUI thread to confirm the error is gone

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Change

| File | Change |
|------|--------|
| `sidecar/src/managers/terminal-manager.ts` | Add `createRequire` import + local `require` constant |

## Risk

Low — `createRequire` is a stable Node.js API. The tsup banner already uses the exact same pattern, so this just makes the source file work independently of the bundler.
