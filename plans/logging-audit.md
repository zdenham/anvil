# Logging Audit: Sensitive Data & Noise Reduction

## Summary

Full audit of logging across the codebase (\~1,032 logger calls). Two categories of issues found:

1. **Sensitive data exposure** — unfiltered stderr, stack traces, file paths, and user content being logged
2. **Log noise** — hot-path debug logging, fragmented startup logs, inconsistent log levels, and leftover test debugging

No API keys or credentials are being logged directly (good). But several paths allow arbitrary process output into logs unfiltered.

---

## Phases

- [x] Fix sensitive data logging issues (HIGH priority)

- [x] Reduce log noise and fix log levels (MEDIUM priority)

- [x] Clean up test logging and console usage (LOW priority)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Sensitive Data Fixes

### HIGH — Unfiltered process stderr/stdout

| File | Line(s) | Issue |
| --- | --- | --- |
| `src/lib/agent-service.ts` | \~911, \~1091 | Agent stderr logged raw: `logger.error("[simple-agent] stderr:", event.payload.data)` — could contain user code output, secrets from subprocess |
| `src/lib/quick-actions-build.ts` | \~65 | Build stderr/stdout logged unfiltered: `logger.error('[quick-actions-build] Build failed', { stderr, stdout })` — build output can contain env vars, paths |
| `src/lib/quick-action-executor.ts` | \~193 | Each stderr line logged individually: `logger.error('[quick-action-executor] stderr:', line)` — user-provided quick actions can print anything |

**Fix**: Truncate all stderr/stdout to a max length (e.g. 500 chars). Don't log full build output — log a summary like "Build failed (exit code X, stderr length Y)". For agent stderr, log only a truncated preview.

### MEDIUM — Stack traces and error objects

| File | Line(s) | Issue |
| --- | --- | --- |
| `sidecar/src/server.ts` | \~198, \~206 | Full stack traces in uncaught exception handlers: `log.error(\`\[fatal\] uncaughtException: ${err.stack}\`)\` |
| 50+ locations across codebase | various | Error objects logged directly without filtering: `logger.error("...", error)` — Error objects may contain internal paths and verbose stacks |

**Fix**: Log `error.message` and `error.code` only. For fatal handlers, truncate stack to first 3 frames max. Consider a utility like `sanitizeError(err)` that extracts only safe fields.

### MEDIUM — System info disclosure

| File | Line(s) | Issue |
| --- | --- | --- |
| `src/lib/agent-service.ts` | \~511 | Full shell PATH logged: `logger.info(\`\[agent\] Captured shell PATH: ${cachedShellPath}\`)\` |
| `src/entities/repositories/service.ts` | \~212, \~275-286 | Absolute file paths logged in info messages |

**Fix**: Remove the PATH log entirely (or downgrade to debug). For file paths, log only the basename or relative path from the project root, not absolute paths containing the user's home directory.

### MEDIUM — User content in logs

| File | Line(s) | Issue |
| --- | --- | --- |
| `src/components/thread/live-ask-user-question.tsx` | \~76-77, \~125-126 | Tool inputs logged on validation failure: `logger.warn("Invalid toolInput", { toolInput })` — could contain user questions |

**Fix**: Log only the validation error, not the input content. E.g. `logger.warn("Invalid toolInput in question request")` without the payload.

---

## Phase 2: Noise Reduction

### HIGH NOISE — Hot-path debug logging

These fire on every thread/plan/relation change and create log spam:

| File | Lines | Pattern |
| --- | --- | --- |
| `src/entities/relations/listeners.ts` | 17, 22, 27, 36, 41 | `logger.debug()` on every THREAD_UPDATED, PLAN_UPDATED, RELATION_CREATED, THREAD_ARCHIVED, PLAN_ARCHIVED event |
| `src/entities/relations/service.ts` | 137, 151, 272, 313 | `logger.debug()` on every archive/refresh operation |
| `agents/src/runners/shared.ts` | \~1499 | `logger.debug(\`\[runner\] Message: type=${message.type}\`)\` — fires on **every** incoming message |
| `src/stores/pane-layout/service.ts` | 82, 90, 129, 266 | `logger.debug()` on every tab open, layout split |
| `src/stores/pane-layout/terminal-panel-service.ts` | 48, 124 | `logger.debug()` on every terminal open/split |

**Fix**: Remove most of these entirely. The relation listener debug logs and per-message runner logs are the worst offenders. If kept, gate behind `process.env.DEBUG` or a verbose flag. The `Message: type=` log in the agent loop should be removed or changed to trace level.

### MEDIUM NOISE — Fragmented startup logging

| File | Lines | Pattern |
| --- | --- | --- |
| `src/App.tsx` | 30-76 | 10 individual `logger.info()` calls for performance timings during startup |

**Fix**: Collect all timings in an object and emit a single `logger.info("[startup] timings", { ... })` at the end.

### MEDIUM NOISE — Verbose sequential operation logs

| File | Lines | Pattern |
| --- | --- | --- |
| `src/entities/gateway-channels/webhook-helpers.ts` | 21-46 | 5 sequential info logs for a single webhook setup operation |
| `agents/src/runners/shared.ts` | 131, 171, 245, 250, 313, 433 | Multiple info-level logs that should be debug |

**Fix**: Consolidate webhook logs into a single info log on completion. Downgrade runner operational logs to debug.

### LOW VALUE — Initialization confirmations

| File | Lines | Pattern |
| --- | --- | --- |
| `src/entities/relations/listeners.ts` | 59, 113 | "Listeners initialized" messages |
| Multiple window entry files | various | "Module loading...", "Bootstrap starting...", "Bootstrap complete" |
| `src/entities/relations/service.ts` | 239, 262 | "Starting hydration...", "Complete. Loaded N relations" |

**Fix**: Remove initialization confirmation logs. They add no value after initial development. If needed for debugging, use debug level.

### Inconsistent log levels

| Pattern | Files | Fix |
| --- | --- | --- |
| `logger.log()` instead of `logger.info()` | \~16 instances across `src/` | Change to `logger.info()` or `logger.debug()` |

---

## Phase 3: Test & Console Cleanup

### Leftover test debugging

| File | Lines | Issue |
| --- | --- | --- |
| `src/components/thread/__tests__/replay-debug.ui.test.tsx` | 20-47 | Multiple `console.log()` calls for debugging |
| `agents/src/runners/thread-history.test.ts` | 243-257 | Test logging |
| Multiple test files in `agents/src/testing/__tests__/` | various | `JSON.stringify(output.messages)` logging full conversations |

**Fix**: Remove all `console.log` from test files. If test output is needed, use proper test reporter or assertions.

### Console usage in production code

| File | Lines | Issue |
| --- | --- | --- |
| `src/components/control-panel-header.tsx` | \~185-187 | `console.log()` for cancel button click |
| `src/components/spotlight.tsx` | \~159 | `console.log()` |
| `src/components/thread/thread-input.tsx` | \~61, 70, 80 | Mix of `logger.log` and `console.log` |
| `migrations/src/runner.ts` | 55-63 | `console.log/warn/error` instead of logger |

**Fix**: Replace all `console.log` in production code with `logger.debug()` or remove. Migration runner should use a proper logger.

### Rust test eprintln

| File | Lines | Issue |
| --- | --- | --- |
| `src-tauri/src/accessibility/system_spotlight.rs` | 125, 132 | `eprintln!()` in tests |

**Fix**: Low priority, but replace with `tracing::debug!` or remove.

---

## Infrastructure Gaps

These aren't code changes but worth noting:

1. **No log rotation on disk files** — `structured.jsonl` and `sidecar.log` grow unbounded. Consider adding rotation (e.g. 50MB max, keep 3 files) or a periodic cleanup.
2. **No redaction layer** — There's no centralized sanitization for secrets in logs. Consider adding a redaction utility that strips patterns like API keys, bearer tokens, and home directory paths before writing to disk or sending to the log server.
3. **No explicit log level configuration** — The Rust side hardcodes `"debug,ureq=off,rustls=off,h2=off"`. There's no way for users or developers to set a runtime log level (e.g. via env var like `ANVIL_LOG_LEVEL`).