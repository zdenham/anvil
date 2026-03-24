# Breadcrumb v2 (green-mosquito) — Deep Dive

Deep dive analysis of the second breadcrumb-loop run for the sidecar refactor.

**Worktree:** `green-mosquito` (`/Users/zac/.anvil/repositories/anvil/green-mosquito`)
**Branch:** Detached HEAD at `f985437`
**Iterations:** 11 breadcrumb checkpoints (001–011)

---

## Philosophy

Iterative with self-correction. Green-mosquito went deeper than any other implementation — it discovered a critical event system breakage mid-flight (iteration 008) and fixed it rather than punting. It achieved a full `pnpm tauri build` producing a production DMG, not just `cargo check`.

---

## Key Stats

| Metric | Value |
|--------|-------|
| Total TS source files | 19 (+ 2 test files) |
| Total lines (app code) | ~2,593 |
| Test lines | 383 (2 files) |
| Breadcrumb iterations | 11 |
| Git commits | 20+ |
| Dispatch commands | ~91 |
| Integration tests | 14 passing |

---

## Unique Decisions

1. **Event system migration** — Only implementation to discover that `EventBroadcaster` was dead (zero subscribers) and fix it by migrating to Tauri-native `app.emit()` + `@tauri-apps/api/event`
2. **Production build verified** — Full `pnpm tauri build` → DMG bundle, not just `cargo check`
3. **File-based lock manager** — Dedicated `lock-manager.ts` (71 lines) with 30-minute expiry, vs azure-herring's in-memory counter
4. **Separate `AgentProcessManager` class** (143 lines) — Encapsulates spawn/cancel/escalation lifecycle with SIGTERM → 5s → SIGKILL pattern
5. **Three-function dispatch split** — `dispatch-git.ts` and `dispatch-misc.ts` each split across 3 functions (Part1/Part2/Part3) to stay under line limits
6. **Vitest test suite** — Added `vitest.config.ts` to sidecar workspace, 2 test files covering dispatch + agent hub round-trip
7. **Web build verification script** — `scripts/verify-web-build.sh` for FR6 structural validation
8. **`mime-types` package** — Uses npm `mime-types` library vs azure-herring's hand-rolled `mime.ts`

---

## Strengths

- **Most complete implementation** — All 7 acceptance criteria verified with programmatic checks
- **Self-correcting** — Discovered broken event routing at iteration 008 and spent 3 iterations fixing it properly
- **Has tests** — 14 integration tests (command dispatch + agent hub round-trip), only shared with cc-teams among all implementations
- **Production-verified** — Full DMG bundle build passes
- **Better process management** — Graceful cancel with SIGTERM → timeout → SIGKILL escalation
- **Cleaner dependency set** — Removed unused chokidar and proper-lockfile during implementation
- **Strict TypeScript** — `strict: true`, no `any` types, `noUncheckedIndexedAccess`

---

## Weaknesses

1. **Large files exceed 250-line convention:**
   - `dispatch-git.ts` — 416 lines (split into 3 functions as workaround)
   - `dispatch-misc.ts` — 376 lines (same pattern)
   - Arbitrary Part1/Part2/Part3 split harms readability

2. **`execSync` still blocks event loop:**
   - `dispatch-misc.ts:335` — shell PATH initialization blocks up to 30s
   - `dispatch-misc.ts:264,285` — `searchThreads` uses `execFileSync` inside an async function

3. **14+ silent catch blocks** — errors swallowed without logging throughout dispatch modules

4. **Path traversal in `/files` endpoint** — `path.resolve()` alone doesn't prevent `../../etc/passwd`

5. **No Zod validation at WS boundary** — all args are `Record<string, unknown>`, cast at runtime

6. **Unbounded state growth:**
   - `logBuffer` grows indefinitely (no max size)
   - `diagnosticConfig` accepts arbitrary keys via `Object.assign`

7. **`console.log` instead of structured logger** — per project convention should use `@/lib/logger-client`

8. **dispatch-misc.ts is a catch-all** — handles 12+ conceptual domains (paths, threads, repos, search, identity, locks, shell, logging, diagnostics, agents)

---

## File Structure

```
sidecar/
├── src/
│   ├── server.ts              (109)  Entry point, Express + WS
│   ├── types.ts                (52)  Protocol definitions
│   ├── state.ts                (50)  Shared state interface
│   ├── dispatch.ts             (37)  Router
│   ├── ws-handler.ts           (74)  WS connection handler
│   ├── push.ts                 (40)  Event broadcaster
│   ├── helpers.ts              (27)  Arg extraction
│   ├── dispatch/
│   │   ├── dispatch-fs.ts     (248)  Filesystem ops
│   │   ├── dispatch-git.ts    (416)  Git operations
│   │   ├── dispatch-misc.ts   (376)  Misc catch-all
│   │   ├── dispatch-worktree.ts(294) Worktree management
│   │   ├── dispatch-agent.ts   (33)  Agent dispatch
│   │   ├── git-helpers.ts      (32)  Git exec utility
│   │   └── paths.ts            (41)  Path resolution
│   ├── managers/
│   │   ├── agent-hub.ts       (167)  WS relay for agents
│   │   ├── agent-process-manager.ts(143) Subprocess lifecycle
│   │   └── lock-manager.ts     (71)  File-based locks
│   └── __tests__/
│       ├── command-dispatch.test.ts  (183)
│       └── agent-hub-roundtrip.test.ts(200)
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```
