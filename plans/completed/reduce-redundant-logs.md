# Reduce Redundant Logs

Full codebase audit of logging statements to improve signal-to-noise ratio. Logs should be high-signal — every log should provide information not already available from surrounding context.

## Phases

- [x] Remove `[FC-DEBUG]` and `[SKILL-DEBUG]` tagged debug logs (agents + frontend)
- [x] Remove TIMING-prefixed logs from components
- [x] Consolidate redundant entry/exit log pairs across all layers
- [x] Remove excessive progress-marker logs in linear functions
- [x] Fix console.log/console.error convention violations
- [x] Remove decorative separator logs and per-iteration loop logs

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Audit Summary

| Area | Total Logs | Redundant | Console Violations |
|------|-----------|-----------|-------------------|
| `agents/src/` | 96 | 12 | 1 |
| `core/` | 11 | 3 | 5 |
| `src-tauri/` (Rust) | 425 | 23 | 18 |
| `src/components/` | 161 | ~100 | 0 |
| `src/entities/` + `src/stores/` | 313 | 12 | 0 |
| `src/lib/` + `src/hooks/` + `server/` | 289 | 27 | 3 |
| **Total** | **~1295** | **~177** | **27** |

---

## Phase 1: Remove `[FC-DEBUG]` and `[SKILL-DEBUG]` Tagged Debug Logs

These are clearly development-time logs left in production code. All should be removed outright.

### agents/src/output.ts — `[FC-DEBUG]`
- **Line 151-156**: `logger.info("[FC-DEBUG] emitState called", {...})` — logs every state emission with file change count. Fires hundreds of times per run.
- **Line 269**: `logger.info("[FC-DEBUG] updateFileChange called", {...})` — logs every file change update call.
- **Line 278**: `logger.info("[FC-DEBUG] Updating existing file change at index ${idx}")` — per-update detail.
- **Line 281**: `logger.info("[FC-DEBUG] Adding new file change, new count will be ...")` — per-update detail.

### agents/src/runners/shared.ts — `[SKILL-DEBUG]`
- **Lines 1210-1230**: Six consecutive `logger.info("[SKILL-DEBUG] ...")` logs dumping plugin config, anvilDir, JSON paths, directory existence, and skills found on every run.

### agents/src/runners/shared.ts — Hook debug blocks (console.log)
- **Lines 729-735**: PreToolUse:Task hook debug block with `console.log` and JSON pretty-printing.
- **Lines 859-864**: PostToolUse hook debug block.
- **Lines 1149-1154**: PostToolUseFailure hook debug block.

### src/components/control-panel/changes-tab.tsx — `[FC-DEBUG]`
- **Lines 154-366**: 22 `logger.info("[FC-DEBUG] ...")` logs covering every render, every useMemo, every useEffect, every conditional branch. All should be removed.

### src/lib/annotated-file-builder.ts — `[FC-DEBUG]`
- **Line 170-174**: `buildAnnotatedFiles called` with detailed params.
- **Line 182**: `skipping binary file` (per-file).
- **Line 190-196**: `processing file` (per-file).
- **Line 200**: `no content for file` (per-file).
- **Line 210-215**: `built annotation` (per-file).
- **Line 220-223**: `returning` summary.
- **Action**: Remove per-file logs (182, 190, 200, 210). Keep entry+exit summary only if needed.

### src/lib/utils/thread-diff-generator.ts — `[FC-DEBUG]`
- **Lines 45-155**: Multiple `[FC-DEBUG]` logs throughout diff generation. Remove line 54 (redundant early exit) and line 138 (redundant with entry log). Consider removing all FC-DEBUG logs.

---

## Phase 2: Remove TIMING-Prefixed Logs from Components

These are performance measurement logs that should either be behind a debug flag or removed.

### src/components/content-pane/thread-content.tsx — `[ThreadContent:TIMING]`
- **Line 119**: `FIRST RENDER (sync)` — fires on every mount.
- **Line 135**: `activeState selector ran` — selector detail.
- **Line 275**: `messages useMemo - using INITIAL_PROMPT`.
- **Line 286**: `messages useMemo - appending OPTIMISTIC messages`.
- **Line 301**: `messages useMemo - using STORE messages`.
- **Line 308**: `messages useMemo - returning EMPTY array`.
- **Line 541**: `RENDER` with message counts — fires every render.
- **Action**: Remove all TIMING logs (10 total).

### src/components/thread/thread-view.tsx — `[ThreadView:TIMING]`
- **Line 63**: `FIRST RENDER`.
- **Line 79**: `turns useMemo completed`.
- **Lines 91, 97, 105, 119**: Various rendering timing logs.
- **Action**: Remove all (4+ logs).

### src/components/main-window/main-window-layout.tsx — `[MainWindowLayout:TIMING]`
- **Line 247**: `Received set-content-pane-view event`.
- **Line 255**: `navigateToView completed`.
- **Action**: Remove both.

### src/stores/content-panes/service.ts — `[contentPanesService:TIMING]`
- **Lines 136-141**: `setPaneView START` with metadata.
- **Line 155**: `appData.writeJson completed in ${ms}ms`.
- **Lines 159-166**: `_applySetPaneView completed` with elapsed times.
- **Action**: Keep only the completion log (159-166) if timing data is still desired. Remove the other two.

---

## Phase 3: Consolidate Redundant Entry/Exit Log Pairs

Pattern: function logs "Starting X" then immediately logs "X completed" with no meaningful work between them.

### agents/src/runner.ts — loadPriorState (lines 41-99)
11 individual info/warn logs for loading each property (messages, sessionId, toolStates, lastCallUsage, cumulativeUsage, fileChanges). Each "Loaded X" log just confirms a field was deserialized.
- **Action**: Consolidate to 2-3 summary logs: "Loading prior state from ${path}", "Loaded prior state: ${messages.length} messages, ${Object.keys(toolStates).length} tool states", and the existing warn for missing file.

### agents/src/runners/shared.ts — runAgentLoop init (lines 427-436)
- Line 427: `Starting with ${priorMessages.length} prior messages`.
- Line 429: `Resuming SDK session: ${priorSessionId}`.
- Line 432: `Preserving ${Object.keys(priorToolStates).length} prior tool states`.
- Line 435: `Prior message roles: ${priorMessages.map(m => m.role).join(", ")}`.
- **Action**: Consolidate to one summary log. Remove line 435 entirely (message roles add no value).

### agents/src/runners/shared.ts — processPlanMentions (lines 307-331)
- Line 307: `Found ${mentions.length} plan mentions`.
- Line 322: `Created/found relation for ${relativePath}` (per-mention in loop).
- Line 331: `Plan not found for path: ${relativePath}` (per-mention in loop).
- **Action**: Keep line 307 summary. Remove per-iteration logs (322, 331) — the summary already tells you what was found.

### src/entities/plans/service.ts — CRUD operations
- Lines 207+219: `Creating plan` → `Successfully persisted plan`.
- Lines 249+262: `Updating plan` → `Successfully updated plan`.
- Lines 278+285: `Deleting plan` → `Successfully deleted plan`.
- **Action**: Remove the "Starting" log from each pair. Keep only the success/completion log.

### src/entities/plans/listeners.ts — Bookend logs
- Line 11: `Registering plan listeners...`
- Line 70: `Plan listeners initialized`.
- **Action**: Remove line 11. Keep line 70.

### src/entities/relations/listeners.ts — Bookend logs
- Line 16: `Setting up relation listeners...`
- Line 62: `Relation listeners initialized`.
- **Action**: Remove line 16. Keep line 62.

### src/entities/gateway-channels/webhook-helpers.ts
- Line 32: `Listing existing webhooks...`
- Line 34: `Found ${existing.length} existing webhook(s)`.
- **Action**: Remove line 32. Keep line 34 (the result).

### src/lib/app-data-store.ts — 6 entry/exit pairs
- Lines 61+64 (writeJson), 78+84 (readText), 142+145 (ensureDir), 263+266 (isGitRepo), 278+281 (absolutePathExists), 392+394 (saveSettings).
- **Action**: For each pair, remove the entry log. Keep only the result/success log.

### src/lib/hotkey-service.ts
- Line 11: `Registering hotkey: ${hotkey}` (entry).
- Line 14: `Hotkey registered successfully` (exit).
- Line 26-30: `saveHotkey called` with char codes (entry).
- Line 33: `saveHotkey completed successfully` (exit).
- **Action**: Remove entry logs (11, 26). Keep success/error logs.

### src/lib/state-recovery.ts
- Line 84: `Stopped recovery polling for thread ${threadId}` (info).
- Line 95: `Stopped polling for thread ${threadId}` (debug — redundant).
- **Action**: Remove line 95.

---

## Phase 4: Remove Excessive Progress-Marker Logs in Linear Functions

Functions that narrate every step of an obviously sequential operation.

### agents/src/runner.ts — Signal handler (lines 236-253)
Five logs for one shutdown sequence: "already shutting down", "AbortController present", "Calling abort()", "abort() called", "No abort controller".
- **Action**: Keep only the initial signal receipt log and the "No abort controller" fallback. Remove the three intermediate logs (242, 246, 248).

### agents/src/runner.ts — line 165
`Created AbortController, pid=${process.pid}` — framework-level noise.
- **Action**: Remove.

### agents/src/runners/shared.ts — Signal handler (lines 241-253)
Duplicate of runner.ts signal handler logs. Same event logged in both places.
- **Action**: Keep signal handling logs in ONE location only (runner.ts). Remove from shared.ts.

### agents/src/runners/shared.ts — line 116
`emitEvent: name="${name}" payload=${JSON.stringify(payload)}` — logs every single event with full payload.
- **Action**: Remove. Keep the warn at line 122 (hub not connected) only.

### agents/src/runners/shared.ts — line 474-475
`System prompt: ${systemPrompt.length} chars, cwd=${context.workingDir}`.
- **Action**: Remove. Prompt length is deterministic noise.

### src/components/error-panel.tsx — 13 logger.log calls
Lines 15, 18, 22, 26, 29, 38, 44, 51, 54, 60, 63, 67, 73. Logs module load, every render, every useEffect, every event, every cleanup, every state check, every click.
- **Action**: Remove ALL `logger.log` calls. Keep only `logger.error` on line 33.

### src/components/clipboard/clipboard-manager.tsx — 5 logs
Lines 48, 54, 61, 105, 123. Logs every function call, completion, event receipt, focus change.
- **Action**: Keep only line 54 (stale request — signals race condition). Remove lines 48, 61, 105, 123.

### src/components/main-window/main-window-layout.tsx
- Lines 295, 329, 356, 391, 402: Navigation and creation success logs.
- **Action**: Remove success-path logs. Keep only error logs.

### src/lib/agent-service.ts — spawnSimpleAgent (lines 606-920)
~50 log statements for a single spawn operation including: separator frames (606, 608, 865-872), redundant prep+result pairs (619+623, 633+636, 640+645, 701+706, 732+740, 778+786), per-detail logs (748, 754, 810, 844).
- **Action**: Consolidate to ~10-12 logs: entry with params, validation result, paths resolved, pre-spawn summary, spawn result, process closed.

### src/lib/agent-service.ts — resumeSimpleAgent (lines 931-1070)
Separator framing (931-933), redundant prep logs (942, 945 before result at 950).
- **Action**: Remove separators and prep logs. Keep result logs.

### src/lib/use-file-contents.ts — 15+ debug logs (lines 43-180)
Extreme over-logging: separator banners, per-file load logs, per-file success logs, cleanup logs. All for a single React hook.
- **Action**: Remove all except error logs (lines 62, 143, 172). Optionally keep one summary log at start.

### src/entities/repositories/service.ts — Hydration verbosity (lines 91-157)
Per-repo intermediate logs during initialization.
- **Action**: Keep start log (91) and completion summary (157). Remove per-repo intermediate logs (101, 112, 142, 151) and redundant path logs (92, 96).

### src/components/spotlight/spotlight.tsx — Build refresh (25+ logs)
Decorative border logs, per-step progress with stdout/stderr dumps, redundant exit code echoing.
- **Action**: Keep high-level progress per step and errors. Remove decorative borders, stdout/stderr dumps, and "completed successfully" logs.

### src/components/onboarding/OnboardingFlow.tsx — Duplicated setup (12 logs)
Lines 97-117 and 166-186 contain identical logging for Enter key vs handleNext button paths.
- **Action**: Deduplicate into a shared helper function.

### src-tauri/src/clipboard.rs — paste functions
- `paste_to_active_app`: Lines 21, 64, 68 (starting, posting events, completed). Keep only entry (21).
- `paste_clipboard_entry`: Lines 173, 185, 197, 207. Keep only entry with ID (173).

### src-tauri/src/worktree_commands.rs — delete worktree
- Lines 116, 119, 146, 154, 161. Keep 116 (entry) and 154 (success). Remove 119, 146, 161.

### src-tauri/src/lib.rs — hotkey registration
- `register_hotkey_internal`: Lines 211, 219, 223, 238, 247, 263. Keep 211 (entry) and 263 (success). Remove 219, 223, 238, 247.
- `save_hotkey`: Lines 285, 292, 294, 297. Keep 285 (entry) and 297 (result). Remove 292, 294.
- `show_main_window`: Lines 338, 344, 353, 356, 384. Keep 338 (entry). Remove 344, 353, 356, 384.

### src-tauri/src/paths.rs — Shell PATH initialization
- Separator lines (76-78, 167-169, 212-214): Remove all decorative separators.
- Lines 135+142+157: "Captured PATH" + "Updated SHELL_PATH" + "Marked initialized". Keep 135 only.

### src-tauri/src/panels.rs — Control panel
- Lines 878+884: "Storing..." + "Stored". Remove both, keep 875 (entry with context).
- Lines 892-909: Seven sequential progress logs. Consolidate to one.
- Spotlight resize (383-414): Three logs for one resize. Keep one consolidated log.

---

## Phase 5: Fix Console Violations

### agents/ — console.log → logger
- `agents/src/lib/persistence-node.ts:28`: `console.warn(...)` → `logger.warn(...)`.
- `agents/src/runners/shared.ts:729-735, 859-864, 1149-1154`: Remove `console.log` debug blocks entirely (covered in Phase 1).

### core/ — console.warn → logger
- `core/lib/anvil-dir.ts:11`: `console.warn("[getAnvilDir] ...")` → `logger.warn(...)`. Also consider removing entirely (redundant fallback log for expected behavior).

### src/ — console.error → logger
- `src/lib/event-bridge.ts:122, 129, 136`: `console.error(...)` → `logger.error(...)` (in dev-only guard).
- `src/hooks/use-window-drag.ts:100`: `console.error(...)` → `logger.error(...)`.

### src-tauri/ — eprintln! → tracing macros (core code only)
- `src-tauri/src/logging/config.rs:42-45`: `eprintln!` → `tracing::warn!`.
- `src-tauri/src/logging/log_server.rs:85, 145, 159`: `eprintln!` → `tracing::error!`/`tracing::info!`.
- `src-tauri/src/logging/mod.rs:407, 415`: `eprintln!` → `tracing::warn!`.
- Note: `eprintln!` in test binaries (`anvil-test/`) and accessibility debug functions is acceptable.

---

## Phase 6: Remove Decorative Separator Logs and Per-Iteration Loop Logs

### Separator logs to remove
- `src-tauri/src/paths.rs`: Lines 76-78 (START), 167-169 (SUCCESS), 212-214 (FAILED) — decorative `═══` separators.
- `src/lib/agent-service.ts`: Lines 606, 608, 865-872 (spawnSimpleAgent separators), 931-933 (resumeSimpleAgent separators).
- `src/components/spotlight/spotlight.tsx`: `=== REFRESH START ===` and similar border logs.

### Per-iteration loop logs to remove
- `agents/src/runners/shared.ts:322, 331`: Per-plan-mention logs inside loop.
- `src/lib/annotated-file-builder.ts:182, 190, 200, 210`: Per-file processing logs.
- `src/entities/repositories/service.ts:101, 112, 142, 151`: Per-repo hydration logs.
- `src/lib/use-file-contents.ts:79, 85, 89-92, 99-103, 109-114, 118-122, 124-130, 135-139`: Per-file load logs.

---

## Logs to Keep (Do Not Remove)

These provide genuine debug value at system boundaries, error conditions, or capture data not available elsewhere:

- **All `logger.error` / `logger.warn`** for genuinely unexpected conditions
- **Connection lifecycle**: Hub connect/disconnect, socket server startup, agent connections
- **Process lifecycle**: Agent spawn success/failure, exit codes, terminal process exit
- **User actions**: Permission responses, mode changes, cancel received
- **System boundaries**: App initialization completions with counts, migration results
- **Data validation**: Sequence gaps, schema failures, corrupted state warnings
- **PR/webhook lifecycle**: Auto-address spawns, webhook creation results
- **Error recovery**: Fallback paths, stale request detection, race condition guards
