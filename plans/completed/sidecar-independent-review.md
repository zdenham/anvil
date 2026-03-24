# Sidecar Implementation: Independent Review

Independent re-analysis of all 5 worktrees by separate Opus sub-agents, each examining code without access to the original comparison. This document critiques the determinations in `sidecar-implementation-comparison.md`.

## Independent Scores

| Component | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| A. Server | 7 | 8 | 8 | 7 | 8 |
| B. Dispatch | 8 | 9 | 8 | 8 | 8 |
| C. Managers | 7 | 8 | 7 | 8 | 8 |
| D. Web Build | 7 | 7 | 7 | 6 | **9** |
| E. Shims | 8 | 8 | 8 | 7 | **9** |
| F. Hub Client | 7 | **9** | **9** | 8 | **9** |
| G. Rust | 8 | 8 | 8 | 6 | 8 |
| H. Tracking | 6 | 6 | 6 | 7 | **9** |
| **Average** | **7.25** | **7.9** | **7.6** | **7.1** | **8.5** |

## Original Scores (for reference)

| Component | baseline | cc-teams | vanilla-orchestrate | decompose | breadcrumb-loop |
| --- | --- | --- | --- | --- | --- |
| A. Server | 8.7 | 8.7 | 8.7 | 8.7 | 8.7 |
| B. Dispatch | 8.3 | 8.3 | 8.0 | 7.7 | 9.0 |
| C. Managers | 7.7 | 8.7 | 9.0 | 9.0 | 9.0 |
| D. Web Build | 8.7 | 7.7 | 8.0 | 9.0 | 8.3 |
| E. Shims | 8.3 | 8.0 | 8.0 | 9.7 | 8.3 |
| F. Hub Client | 9.3 | 9.0 | 9.0 | 9.0 | 9.0 |
| G. Rust | 8.7 | 8.7 | 8.3 | 9.0 | 9.3 |
| H. Tracking | 8.5 | 7.0 | 9.0 | 8.5 | 10.0 |
| **Average** | **8.5** | **8.3** | **8.5** | **8.8** | **8.9** |

---

## Ranking Comparison

| Rank | Original | Independent |
| --- | --- | --- |
| **1** | breadcrumb-loop (8.9) | breadcrumb-loop (8.5) |
| **2** | decompose (8.8) | cc-teams (7.9) |
| **3** | baseline (8.5) | vanilla-orchestrate (7.6) |
| **4** | vanilla-orchestrate (8.5) | baseline (7.25) |
| **5** | cc-teams (8.3) | decompose (7.1) |

**breadcrumb-loop holds #1** in both analyses. The major ranking shift: **decompose drops from #2 to #5**, and **cc-teams rises from #5 to #2**.

---

## Critique of Original Analysis

### 1. Scores were uniformly inflated by ~1.0-1.5 points

The original analysis scored everything in the 7.7-10.0 range. The independent agents, reading actual code and finding real bugs, consistently scored 1-1.5 points lower. An 8.7 average for sidecar servers across all 5 implementations is implausible — they have genuine differences in I/O model, error handling, and shutdown behavior that the original analysis acknowledged in prose but didn't reflect in scores.

### 2. All servers scored identically (8.7) — lazy evaluation

The original gave every server an identical 8.7/10 despite noting substantive differences:
- decompose uses `execSync` (blocks event loop) — the original called this out but didn't penalize it
- baseline has no SIGKILL escalation — noted but not penalized
- cc-teams has overly permissive CORS (`*`) — noted but not penalized

If you note a flaw in prose but don't adjust the score, the score is wrong.

### 3. decompose was massively overrated (8.8 → 7.1)

The original analysis missed or underweighted critical issues:

**Showstopper bug: Port-file hash mismatch.** The Rust `sidecar.rs` uses `DefaultHasher` (SipHash) while the Node.js `server.ts` uses SHA-256 to compute the port-file hash. They will **never produce the same hash** for the same project root. The Rust side polls for 15 seconds, times out, and kills the running sidecar. The comment in the Rust code even says "Use SHA-256 to match the sidecar's crypto.createHash" but then uses `DefaultHasher` instead. This makes the entire Tauri-sidecar integration non-functional. The original analysis scored decompose's Rust changes at **9.0** and listed **zero blockers** for this dimension.

**22 MB of committed build artifacts.** 2,704 files in `dist-web/` committed to git. The original noted "committed dist-web/ artifacts is a blocker" in the web build section, then still scored it **9.0** for web build. If you acknowledge something is a blocker, the score should reflect it.

**Sync I/O throughout.** `readFileSync`, `writeFileSync`, `readdirSync`, `statSync` in all 20 filesystem commands. `execSync` in git commands. In a single-threaded WS server, any slow file operation blocks ALL clients. The original noted this in the server section but scored dispatch at 7.7 (only 0.3 below others) and managers at 9.0.

**Shims scored 9.7 — highest of any component in any implementation.** Independent analysis found: missing `global-shortcut` shim, `path.join()` doesn't handle absolute paths correctly, `invoke()` throws (crashes instead of degrading). Score: 7/10.

### 4. cc-teams was underrated (8.3 → 7.9)

The original analysis penalized cc-teams heavily for:
- "Duplicate shim directories" — legitimate concern but not a blocker
- "Plan not updated" — process issue, not code quality
- "Over-deleted Rust files" — speculative; the deleted files may genuinely not be needed

Meanwhile, the independent analysis found:
- **Best dispatch architecture** of all 5 (9/10) — excellent modular decomposition, 86 of ~91 commands
- **Production-quality agent hub** (9/10) — pipeline stamping, sequence gap detection, 630+ lines of integration tests
- **Largest Rust simplification** — removed axum, portable-pty, tokio/rt-multi-thread, and 6 more crates

The original's #5 ranking was driven by hygiene issues. On actual code quality, cc-teams is #2.

### 5. "No blockers" claim for breadcrumb-loop was approximately correct

The independent analysis agrees: breadcrumb-loop has no showstopper bugs. Its issues are:
- `execFileSync` in `fsGitWorktreeAdd/Remove` blocks the event loop (up to 30s)
- No Zod validation at WS boundary (all commands use unsafe `args[key] as T` casts)
- Dead code across modules (hierarchy map, writeQueue/draining fields, backpressure events)
- `console.log` instead of logger

These are real issues but not blockers. The original's assessment holds here.

### 6. vanilla-orchestrate's fsRemove bug was correctly identified

The original flagged `fsRemove` using `rmdir` on non-empty directories. The independent analysis confirmed this and additionally found:
- Shutdown handler never calls manager cleanup methods (orphans PTY sessions, watchers, child processes)
- `misc.ts` at 542 lines violates the project's own <250-line guideline
- Utility code duplicated between `misc.ts` and `worktree.ts`
- No dev proxy for WS in dev mode

### 7. Process tracking scores were universally too generous

The original gave 7.0-10.0 for plan tracking. The independent analysis gave 6-9. Four of the five implementations are uncommitted WIP — that's a 6/10 at best, not 8.5-9.0. Only breadcrumb-loop (8 incremental commits, honest progress breadcrumbs) deserves a high tracking score.

---

## Bugs Found That Original Analysis Missed

| Implementation | Bug | Severity |
| --- | --- | --- |
| **decompose** | Port-file hash mismatch (SipHash vs SHA-256) — Tauri can never find sidecar | **Showstopper** |
| **decompose** | `sidecar.rs` blocks main thread for 15s during port-file polling | High |
| **decompose** | `fs_grep` iterates directories looking for literal filename, not glob | High |
| **decompose** | `child.pid!` non-null assertion — `spawn()` can return undefined pid | Medium |
| **baseline** | `agent_cancel` stale reference — SIGKILL can kill wrong process after threadId reuse | High |
| **baseline** | `wsInvoke` race condition — WS can close between readyState check and send() | High |
| **baseline** | Sidecar path resolution uses `data_dir().parent()` — fails in packaged builds | **Blocker** |
| **baseline** | Shutdown calls `process.exit(0)` without killing PTY/agent/watcher children | High |
| **cc-teams** | No sidecar readiness probe — Tauri connects before sidecar is listening | High |
| **cc-teams** | `dist-sidecar/` not in `.gitignore` | Medium |
| **vanilla-orchestrate** | Shutdown handler never calls `terminalManager.killAll()` / `watcherManager.closeAll()` | **Blocker** |
| **vanilla-orchestrate** | `anvilDir()`, `reposDir()`, `slugify()` copy-pasted between misc.ts and worktree.ts | Medium |
| **breadcrumb-loop** | `execFileSync` in `fsGitWorktreeAdd/Remove` blocks event loop up to 30s | High |
| **breadcrumb-loop** | `AgentHubManager.hierarchy` map populated but never read (dead code) | Low |
| **breadcrumb-loop** | `homeDir()` shim returns `"/"` instead of actual home directory | Medium |

---

## Shared Weaknesses Across All 5

Every implementation has these problems:

1. **Sync I/O somewhere.** All 5 use synchronous file or process operations in at least some command handlers, blocking the event loop in a concurrent WS server. decompose and cc-teams are worst; breadcrumb-loop and baseline are more selective.

2. **No Zod validation at the WS boundary.** All commands use unsafe type casts (`args[key] as T` or `extractString`). Despite the project convention of "Zod at boundaries," none of the implementations validate incoming command arguments.

3. **Unbounded write queues.** All agent hub client implementations can grow their write queue without limit under sustained backpressure. No max queue size or message dropping strategy.

4. **No sidecar health check after spawn.** None of the Rust sidecar lifecycle implementations verify the sidecar is actually healthy after spawn (decompose polls for a port file but with the wrong hash). A sidecar that starts but fails to bind its port will go undetected.

---

## Revised Recommendation

**breadcrumb-loop remains the clear winner.** Both analyses agree on #1, and for the same reasons: no showstopper bugs, best git hygiene, strongest overall code quality, proper `.gitignore`.

**decompose drops from #2 to #5.** The showstopper hash mismatch bug, 22 MB committed artifacts, sync I/O throughout, and blocking sidecar spawn make it the weakest implementation despite having the most sophisticated individual components (dialog shims, web entry). The original analysis's #2 ranking was wrong — it acknowledged blockers in prose but didn't reflect them in scores.

**cc-teams rises to #2.** The original penalized it for process issues (plan not updated, uncommitted WIP) but its actual code — dispatch architecture, agent hub, Rust cleanup — is the second-strongest after breadcrumb-loop.

### Revised Final Ranking

| Rank | Branch | Score | Delta from Original |
| --- | --- | --- | --- |
| **1** | **breadcrumb-loop** | 8.5 | — (was #1 at 8.9) |
| **2** | **cc-teams** | 7.9 | +3 (was #5 at 8.3) |
| **3** | **vanilla-orchestrate** | 7.6 | -1 (was #4 at 8.5) |
| **4** | **baseline** | 7.25 | -1 (was #3 at 8.5) |
| **5** | **decompose** | 7.1 | -3 (was #2 at 8.8) |

### Cherry-pick reassessment

The original recommended cherry-picking from decompose. Given the bugs found, this still makes sense for specific components but with caveats:

| Source | Component | Original Recommendation | Revised Assessment |
| --- | --- | --- | --- |
| decompose | plugin-dialog.ts browser fallbacks | Keep | **Still the best dialog shim** — browser file picker + prompt is genuinely good UX |
| decompose | web-entry.tsx frame rate monitoring | Keep | Fine, but fix `__PROJECT_ROOT__` baked-in path first |
| decompose | dispatch.ts registry pattern | Keep | The `registerDispatcher` pattern is clean, but has prefix collision risk |
| decompose | shell.ts ID-based process tracking | Keep | Good pattern for cleanup on shutdown |
| cc-teams | Agent hub integration tests | **New** | **630+ lines of hub tests not in any other branch** — significant testing advantage |
| cc-teams | Modular dispatch architecture | **New** | 4-file split with proper separation is cleaner than breadcrumb-loop's |
| vanilla-orchestrate | ws-connection.ts backpressure | Keep | bufferedAmount polling is more robust |
| baseline | hub client stats tracking | Deprioritize | Score gap too large to justify cherry-pick complexity |

### Conclusion

The original analysis suffered from **score inflation** and **insufficient bug detection**. It correctly identified breadcrumb-loop as #1 but overrated decompose by not penalizing acknowledged blockers. The independent review finds a wider quality gap between implementations than the original's tight 8.3-8.9 range suggested — the actual spread is 7.1-8.5.
