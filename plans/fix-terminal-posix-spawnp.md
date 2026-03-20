# Fix: Terminal fails with `posix_spawnp failed` (production only)

## Problem

Opening a new terminal in **production builds** fails with:

```
[ERROR] [TerminalService] Failed to create terminal {"error":{}}
[ERROR] [MainWindowLayout] Failed to create terminal: Error: posix_spawnp failed.
```

This does **not** reproduce in development.

## Root Cause

`node-pty` v1.0.0 ships a prebuilt `spawn-helper` binary at:

```
sidecar/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
```

This binary is called by node-pty to execute `posix_spawnp`. In production, the file loses its **execute bit** during Tauri's resource bundling — Tauri copies resources into the `.app` bundle but does not preserve Unix file permissions. When node-pty tries to exec this helper, the OS refuses.

The signing step in `scripts/internal-build.sh` (line 152) correctly identifies and codesigns `spawn-helper`, but this happens **before** `pnpm build` / `tauri build` — so the bundling step that strips permissions comes *after* signing.

## Fix: Runtime chmod before loading node-pty

Since the permission stripping happens during Tauri bundling (which we don't control), the fix must happen at **runtime**. Before `require("node-pty")` in `terminal-manager.ts`, chmod the spawn-helper to be executable.

```ts
import { chmodSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// Tauri resource bundling strips the execute bit from native binaries.
// Ensure spawn-helper is executable before node-pty tries to use it.
const helperDir = join(
  dirname(require.resolve("node-pty/package.json")),
  "prebuilds",
  `${process.platform}-${process.arch}`,
);
const helperPath = join(helperDir, "spawn-helper");
if (existsSync(helperPath)) {
  chmodSync(helperPath, 0o755);
}
```

This runs once per `spawn()` call — `chmodSync` is a no-op-cost syscall when permissions already match, and it's idempotent.

### Why not fix the build script instead?

Adding `chmod +x` in `internal-build.sh` after signing but before `tauri build` won't help — Tauri's resource copying is what strips permissions. We'd need to `chmod` *inside* the built `.app` bundle after Tauri finishes, which is fragile and couples us to Tauri's internal bundle layout. The runtime fix is more robust.

### Why not a postinstall script?

`postinstall` in `sidecar/package.json` only runs during `pnpm install` — it never executes in production where there's no package manager.

## Phases

- [x] Add runtime chmod in `terminal-manager.ts` — before `require("node-pty")`, resolve and chmod `spawn-helper` to 0o755

- [ ] Verify the fix works in a production build

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Additional Context

- `spawn-helper` is a Mach-O arm64 binary (69KB) used by node-pty on macOS to perform the actual `posix_spawnp` syscall
- The empty error object `{"error":{}}` in the logs is because native errors don't serialize to JSON well — consider improving error logging in the catch block (out of scope for this fix)
- `internal-build.sh:152` already finds and codesigns `spawn-helper` — the signing itself is fine, the permission loss happens downstream during Tauri resource bundling
- node-pty v1.0.0 uses prebuilds (no `node-gyp` compile step), so `binding.gyp` install hooks that might have set permissions in older versions no longer run