# Fast Mode Toggle

Enable users to toggle fast mode (2.5x faster Opus 4.6 output at 6x cost) with a lightning bolt toggle button in the thread input status bar.

## Background

### How Fast Mode Works (confirmed via official docs, 2026-03-03)

**API level** ([platform.claude.com/docs](https://platform.claude.com/docs/en/docs/build-with-claude/fast-mode)):
- Requires **both** beta header `anthropic-beta: fast-mode-2026-02-01` **and** `speed: "fast"` in the request body
- Response `usage` includes a `speed` field: `"fast"` or `"standard"`
- Fast mode has **separate rate limits** from standard Opus — 429 with `retry-after` header when exhausted
- Switching between fast and standard **breaks prompt caching** (different speed = cache miss)

**Claude Code CLI level** ([code.claude.com/docs](https://code.claude.com/docs/en/fast-mode)):
- `/fast` command toggles fast mode on/off per session
- `"fastMode": true` in `.claude/settings.json` **IS the on/off state** — it persists the toggle across sessions
- The SDK reads this setting and handles passing `speed: "fast"` to the API internally
- Org admins can gate access via `CLAUDE_CODE_DISABLE_FAST_MODE=1` or console settings
- Org admins can require per-session opt-in with `"fastModePerSessionOptIn": true`
- When fast mode hits rate limits, it **automatically falls back** to standard speed and reports `fast_mode_state: 'cooldown'`

**Agent SDK** (v0.2.63):
- `FastModeState` type: `'off' | 'cooldown' | 'on'`
- `fast_mode_state` field on `SessionInfo`, `PartialResult`, `FinalResult`, `SessionState` — read-only reporting, not an input
- The SDK manages activation internally: reads `"fastMode"` from settings, passes `speed: "fast"` to API, reports state back

**Current state of our codebase:**
- SDK version: `0.2.59` (needs upgrade to `0.2.63` for `fast_mode_state` reporting)
- Beta header already passed: `betas: ["fast-mode-2026-02-01"]` in `shared.ts:1188`
- `.claude/settings.json` already contains `"fastMode": true`
- **Risk:** After SDK upgrade, fast mode will activate immediately since the setting is already true. Need to set it to `false` before or alongside the upgrade.

### Toggle mechanism

Writing `"fastMode": true/false` to `.claude/settings.json` is the official toggle mechanism. The SDK picks this up on the next `query()` call. No `speed` passthrough, env vars, or `RunnerConfig` changes needed — the SDK owns activation.

## Phases

- [x] Investigate SDK passthrough and confirm activation mechanism via official Anthropic docs
- [ ] Live spike: confirm fast mode activates on current SDK (0.2.59) with `fastMode: true` in settings
- [ ] Upgrade SDK from `0.2.59` → `0.2.63`, set `.claude/settings.json` `fastMode` to `false`
- [ ] Add `fastMode` boolean to workspace settings and wire toggle to write `.claude/settings.json`
- [ ] Read `fast_mode_state` from SDK results and surface to frontend via event bridge
- [ ] Add fast-mode toggle button (lightning bolt) to thread input status bar
- [ ] Update context meter cost calculation for fast mode pricing (6x rates)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Detail

### Phase 0: Live Spike — Confirm Fast Mode Behavior

Run a minimal live agent experiment in `agents/src/experimental/` to empirically confirm:

1. **Does `fastMode: true` in `.claude/settings.json` actually activate fast mode on SDK 0.2.59?** The docs say the SDK reads this setting, but we haven't verified it works on the version we're running.
2. **Does the beta header matter?** We already pass `betas: ["fast-mode-2026-02-01"]` — confirm this is required vs. redundant when the SDK handles activation internally.
3. **What does the response `usage` object look like?** Confirm whether `usage.speed` is present on 0.2.59 and what value it reports.
4. **Is `fast_mode_state` available on 0.2.59?** The plan assumes we need 0.2.63 for this — verify it's actually absent.
5. **Does toggling `fastMode` in settings mid-session affect the next `query()` call?** Or does the SDK read settings once at import time?

#### Files

**Runner:** `agents/src/experimental/fast-mode-spike-runner.ts`

Minimal runner that:
- Accepts `FAST_MODE` env var (`"true"` | `"false"`, default `"true"`)
- Writes a temporary `.claude/settings.json` with `fastMode` set to the env value (or uses a `settingsDir` override if available)
- Calls `query()` with a trivial prompt ("Say hello in exactly 3 words"), `maxTurns: 1`, `bypassPermissions`, and the beta header
- Emits JSON lines for each message from the SDK stream, capturing:
  - `{ type: "message", role, usage }` — the raw usage object from each streamed message
  - `{ type: "partial", fast_mode_state }` — if `fast_mode_state` exists on partial results
  - `{ type: "result", fast_mode_state, usage }` — final result fields
- After the first query completes, optionally runs a **second query** with `FAST_MODE` toggled to the opposite value (controlled by `TEST_TOGGLE=true` env) to test mid-session toggle behavior
- Emits `{ type: "done", queries: [...] }` summarizing both runs

**Test:** `agents/src/experimental/__tests__/fast-mode-spike.integration.test.ts`

Integration test following the existing subprocess pattern:
- Gated with `process.env.ANTHROPIC_API_KEY ? describe : describe.skip`
- Vitest timeout: 120s (live API calls)
- Spawns the runner via `tsx` with env overrides

**Test cases:**

1. **`fastMode: true` activates fast mode** — run with `FAST_MODE=true`, assert `usage.speed === "fast"` if present, or note its absence
2. **`fastMode: false` uses standard mode** — run with `FAST_MODE=false`, assert `usage.speed === "standard"` or absent
3. **`fast_mode_state` presence check** — capture whether the field exists on partial/final results on SDK 0.2.59
4. **Mid-session toggle** — run with `FAST_MODE=true, TEST_TOGGLE=true`, confirm second query reflects the toggled setting

#### Expected Outcomes

| Question | Expected | If different |
|---|---|---|
| `fastMode: true` activates fast mode | Yes — SDK reads setting, passes `speed: "fast"` | Would mean SDK 0.2.59 doesn't support fast mode at all; upgrade becomes prerequisite |
| Beta header required | Likely yes — API requires it, SDK may pass it automatically | If SDK passes it internally, we can remove our manual `betas` entry |
| `usage.speed` on 0.2.59 | Uncertain — may be API-level only, not surfaced by SDK | If present, we can use it for cost calc without SDK upgrade |
| `fast_mode_state` on 0.2.59 | Absent — docs say it was added in 0.2.63 | If present, SDK upgrade for this field is unnecessary |
| Mid-session toggle | Works — SDK re-reads settings per `query()` call | If not, we'd need to restart the agent process on toggle |

#### Decision gate

If the spike shows that **SDK 0.2.59 does not activate fast mode at all** (no `usage.speed: "fast"`, no observable speed difference), then Phase 2 (SDK upgrade) becomes a hard prerequisite and should be done before any UI work. If 0.2.59 works but lacks `fast_mode_state` reporting, we can proceed with the upgrade as a parallel track.

### Phase 1: SDK Investigation — COMPLETE

**Confirmed** via official Anthropic documentation:
- API: beta header + `speed: "fast"` in body → response `usage.speed` reports `"fast"` | `"standard"`
- Claude Code: `"fastMode": true` in settings = fast mode ON (state, not gate). SDK reads this and passes `speed: "fast"` internally.
- SDK 0.2.63: `fast_mode_state` on results for UI reporting

Sources:
- [Fast mode API docs](https://platform.claude.com/docs/en/docs/build-with-claude/fast-mode)
- [Fast mode Claude Code docs](https://code.claude.com/docs/en/fast-mode)

### Phase 2: SDK Upgrade

1. Upgrade `@anthropic-ai/claude-agent-sdk` from `^0.2.59` to `^0.2.63` in `agents/package.json`
2. **Immediately** set `.claude/settings.json` to `"fastMode": false` — the file currently has `true`, which would activate fast mode (6x cost) as soon as the SDK can read it
3. Run tests to confirm nothing breaks

### Phase 3: Settings + Toggle Wiring

Since the SDK reads `.claude/settings.json` directly, the toggle is straightforward:

1. **Workspace settings** (`src/entities/settings/types.ts`) — add `fastMode: z.boolean()` with default `false`
2. **Toggle handler** — when user clicks the lightning bolt, write `fastMode` value to `.claude/settings.json`
3. **Agent spawn** — the SDK picks up the setting automatically on next `query()` call. No CLI args, no `RunnerConfig` changes.

**Open question:** `.claude/settings.json` is project-scoped. If user toggles fast mode in one thread, it affects all threads in the project. This matches Claude Code CLI behavior (project-wide setting). If per-thread control is desired later, we'd need a different mechanism.

### Phase 4: Surface `fast_mode_state` to Frontend

After SDK upgrade, `fast_mode_state` appears on `PartialResult` and `FinalResult`. Thread it through the event bridge so the frontend knows the actual state (on/off/cooldown) — don't rely solely on the settings file, since cooldown happens server-side.

Also read `usage.speed` from responses if available for cost calculation accuracy.

### Phase 5: Fast Mode Toggle Button (sole UI control)

Add a clickable fast-mode toggle button to the **right** of the context meter in `thread-input-status-bar.tsx`:

```
[Mode label]    [Context meter] [⚡]
```

**Toggle behavior:**
- **Off:** Outline lightning bolt icon (Lucide `Zap`), muted/dim color (e.g. `text-muted-foreground`)
- **On:** Filled lightning bolt icon (Lucide `Zap` with `fill="currentColor"`), amber/yellow color (e.g. `text-amber-400`)
- **Cooldown:** Filled icon with reduced opacity or pulsing animation to indicate temporary cooldown state
- Clicking the button toggles `fastMode` in `.claude/settings.json`

**Details:**
- Icon size: 14-16px, styled as a small inline button with hover state
- Tooltip (off): "Enable fast mode — 2.5x faster output at 6x cost"
- Tooltip (on): "Fast mode active — 2.5x faster, 6x cost. Click to disable."
- Tooltip (cooldown): "Fast mode — cooling down (rate limit)"
- Drive visual state from `fast_mode_state` reported by the SDK on each result message
- Store last-known `fast_mode_state` on thread metadata so it persists across thread resume

### Phase 6: Cost Calculation

In `context-meter.tsx`, the hardcoded pricing (lines 121-124) assumes standard Opus rates. When fast mode is active:

```typescript
// Standard Opus 4.6
const PRICE_INPUT = 5 / 1_000_000;
const PRICE_OUTPUT = 25 / 1_000_000;

// Fast mode (6x standard)
const PRICE_INPUT_FAST = 30 / 1_000_000;
const PRICE_OUTPUT_FAST = 150 / 1_000_000;
```

Cache pricing also needs the 6x multiplier. Use `usage.speed` from the response (or `fast_mode_state`) to determine which rates to apply.

## Notes

- **Prompt caching**: Switching between fast and standard breaks prompt caching. The first call after toggling will be a full cache miss. The official docs confirm: "requests at different speeds do not share cached prefixes." Worth noting in the tooltip.
- **Effort parameter**: Orthogonal to fast mode. Can be combined (fast + low effort = max speed on simple tasks). Could add effort control separately later.
- **Rate limits**: Fast mode has separate rate limits. When exhausted, SDK automatically falls back to standard and reports `fast_mode_state: 'cooldown'`. We reflect this in the UI indicator — no custom retry logic needed.
- **Automatic fallback**: The SDK/API handles fallback from fast → standard on rate limit. Our UI just needs to reflect the reported state.
- **Per-session opt-in**: Org admins can set `fastModePerSessionOptIn: true` to reset fast mode each session. We don't need to handle this — the SDK respects it automatically.
