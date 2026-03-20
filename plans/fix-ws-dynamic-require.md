# Fix ws dynamic require error in agents bundle

## Problem

`ws` is a CommonJS package that calls `require("events")`, `require("stream")`, etc. When tsup bundles it into ESM output, those `require()` calls go through a CJS compatibility shim that throws because `require` isn't defined in ESM modules.

## Solution

Mark `ws` as external alongside `@anthropic-ai/claude-agent-sdk` — don't bundle it. `ws` is a small CJS package (\~50KB) that depends on Node.js built-ins and doesn't benefit from bundling.

Remove the `createRequire` banner shim (it works but papers over the root cause).

## Phases

- [x] Update `noExternal` regex in `agents/tsup.config.ts` to exclude `ws`

- [x] Remove the `createRequire` banner shim

- [x] Rebuild and verify `ws` is no longer inlined in the bundle

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Changes

### `agents/tsup.config.ts`

Update the `noExternal` regex from:

```ts
noExternal: [/^(?!@anthropic-ai\/claude-agent-sdk)/],
```

To:

```ts
noExternal: [/^(?!@anthropic-ai\/claude-agent-sdk|ws$)/],
```

And remove the banner:

```ts
// DELETE these lines:
banner: {
  js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
},
```

### Verification

After rebuild, confirm:

1. `agents/dist/runner.js` does NOT contain `__require("events")`
2. `agents/dist/runner.js` has `import ... from "ws"` (external import)
3. No `createRequire` shim in the output
4. The agent process starts without the "Dynamic require" error