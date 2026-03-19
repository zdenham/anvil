# vanilla-orchestrate (magenta-blackbird)

**Philosophy:** Pragmatic port of Rust logic. Keeps Rust commands as fallback.

## Unique Decisions

- **Rust commands kept as fallback** — all original Rust handlers remain, sidecar is additive
- **Dev mode via** `npx tsx` — runs TypeScript directly in dev (no build step needed)
- **Dual Rust hub** — keeps Unix socket hub in Rust alongside WS hub in sidecar
- **File-based LockManager** — writes `.lock` files with `.lock.meta` timestamps (vs in-memory)
- `misc.ts` **at 543 lines** — largest single file across all implementations

## Strengths

- Safest migration path (Rust fallback if sidecar fails)
- Clean manager classes with proper lifecycle
- File-based locks survive sidecar restart

## Weaknesses

- `fsRemove` uses `rmdir` on non-empty directories (bug)
- Shutdown handler never calls `terminalManager.killAll()` / `watcherManager.closeAll()` (orphans processes)
- `misc.ts` at 543 lines violates &lt;250-line guideline
- Utility code duplicated between `misc.ts` and `worktree.ts`
- No dev proxy for WS in dev mode
- console.error logging (not structured)