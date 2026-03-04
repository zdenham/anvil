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

**Agent SDK** (v0.2.64):
- `FastModeState` type: `'off' | 'cooldown' | 'on'`
- `fast_mode_state` field on `SessionInfo`, `PartialResult`, `FinalResult`, `SessionState` — read-only reporting, not an input
- The SDK manages activation internally: reads `"fastMode"` from settings, passes `speed: "fast"` to API, reports state back
- **However:** Activation is gated by a server-side `flagSettings.fastMode` flag. When running via the Agent SDK, the CLI checks this flag and silently disables fast mode if it's false. This is separate from the user-level `fastMode` setting.

**Current state of our codebase (confirmed via live spikes on 0.2.59 and 0.2.64, 2026-03-03):**
- SDK version: `0.2.64` (latest available), bundled CLI version: `2.1.64`
- **Fast mode does NOT activate via SDK** — `fast_mode_state: "off"`, `usage.speed: "standard"` regardless of `fastMode` setting (file or inline)
- **Fast mode DOES work via direct API call** — `speed: "fast"` in request body returns `usage.speed: "fast"` (confirmed)
- **Root cause: server-side `flagSettings.fastMode` gate** — CLI binary checks `IA("flagSettings")?.fastMode` and logs `"Fast mode is not available in the Agent SDK"` when false. This is a server-side feature flag that Anthropic controls.
- `fast_mode_state` and `usage.speed` fields present on 0.2.59+ for reporting
- Beta header passed: `betas: ["fast-mode-2026-02-01"]` in `shared.ts:1201`
- `.claude/settings.json` set to `"fastMode": false` (safe default)
- **BLOCKER:** Fast mode via the Agent SDK requires Anthropic to enable `flagSettings.fastMode` server-side. No local configuration can bypass this.

### Toggle mechanism

Writing `"fastMode": true/false` to `.claude/settings.json` is the official toggle mechanism. The SDK picks this up on the next `query()` call. No `speed` passthrough, env vars, or `RunnerConfig` changes needed — the SDK owns activation.

**Caveat (2026-03-03):** This mechanism is correct but currently non-functional. The SDK's bundled CLI checks a server-side `flagSettings.fastMode` flag before honoring the setting, and this flag is currently `false` for Agent SDK usage. The toggle code can still be built — it will "just work" once Anthropic enables the flag.

## Phases

- [x] Investigate SDK passthrough and confirm activation mechanism via official Anthropic docs
- [x] Live spike: confirm fast mode activates on current SDK (0.2.59) with `fastMode: true` in settings
- [x] Upgrade SDK to 0.2.64, re-run spike, confirm activation mechanism
- [ ] **BLOCKED** — Wait for `flagSettings.fastMode` to be enabled server-side for Agent SDK, or bypass SDK for direct API `speed: "fast"` passthrough
- [ ] Add `fastMode` boolean to workspace settings and wire toggle to write `.claude/settings.json`
- [ ] Read `fast_mode_state` from SDK results and surface to frontend via event bridge
- [ ] Add fast-mode toggle button (lightning bolt) to thread input status bar
- [ ] Update context meter cost calculation for fast mode pricing (6x rates)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Detail

### Phase 0: Live Spike — COMPLETE (2026-03-03)

Ran live agent experiments via `agents/src/experimental/fast-mode-spike-runner.ts` against the Anthropic API with SDK 0.2.59 (bundled CLI v2.1.59).

#### Files

- **Runner:** `agents/src/experimental/fast-mode-spike-runner.ts`
- **Test:** `agents/src/experimental/__tests__/fast-mode-spike.integration.test.ts`

#### Results

| Question | Result |
|---|---|
| `fastMode: true` activates fast mode on 0.2.59 | **NO** — `fast_mode_state: "off"` and `usage.speed: "standard"` regardless of settings value |
| `fastMode: false` behavior | Identical to `true` — both report `fast_mode_state: "off"`, `usage.speed: "standard"` |
| `usage.speed` present on 0.2.59 | **YES** — present on the aggregated `result` message usage object. Reports `"standard"`. NOT present on individual `assistant` message usage. |
| `fast_mode_state` present on 0.2.59 | **YES** — present on `system/init` message and accessible on result. Reports `"off"`. Contradicts assumption that 0.2.63 is needed for this field. |
| Beta header sufficient to activate | **NO** — despite passing `betas: ["fast-mode-2026-02-01"]`, fast mode does not activate. The SDK's internal activation logic (reading `fastMode` from settings and passing `speed: "fast"` to the API) is apparently missing in 0.2.59. |
| Mid-session toggle | **Not tested** — moot since neither `true` nor `false` activates fast mode |

#### Raw observations

**`fastMode: true` run — init message:**
```json
{ "fast_mode_state": "off", "claude_code_version": "2.1.59" }
```

**`fastMode: true` run — result message usage:**
```json
{
  "input_tokens": 3, "cache_read_input_tokens": 21056, "output_tokens": 8,
  "service_tier": "standard", "speed": "standard"
}
```

**`fastMode: false` run — identical behavior:** `fast_mode_state: "off"`, `speed: "standard"`

#### Decision gate outcome

**SDK upgrade to 0.2.63+ is a hard prerequisite.** SDK 0.2.59 does not activate fast mode regardless of settings. The `fast_mode_state` and `usage.speed` fields are already present for reporting, but the activation logic (reading `fastMode` setting → passing `speed: "fast"` to API) is missing. Phase 2 (SDK upgrade) must be completed before any other phases can be validated.

**Bonus finding:** `fast_mode_state` is already available on 0.2.59, so the SDK upgrade is needed purely for the **activation** mechanism, not for field availability.

**Update (Phase 2 result):** SDK upgrade to 0.2.64 completed but fast mode still doesn't activate. See Phase 2 section for root cause — the activation is gated by a server-side `flagSettings.fastMode` flag that Anthropic controls.

### Phase 1: SDK Investigation — COMPLETE

**Confirmed** via official Anthropic documentation:
- API: beta header + `speed: "fast"` in body → response `usage.speed` reports `"fast"` | `"standard"`
- Claude Code: `"fastMode": true` in settings = fast mode ON (state, not gate). SDK reads this and passes `speed: "fast"` internally.
- SDK 0.2.63: `fast_mode_state` on results for UI reporting

Sources:
- [Fast mode API docs](https://platform.claude.com/docs/en/docs/build-with-claude/fast-mode)
- [Fast mode Claude Code docs](https://code.claude.com/docs/en/fast-mode)

### Phase 2: SDK Upgrade + Re-spike — COMPLETE (2026-03-03)

Upgraded SDK from `0.2.59` → `0.2.64` (latest). Set `.claude/settings.json` `fastMode` to `false`. Re-ran all spike experiments.

**Result: Fast mode still does NOT activate via the SDK.** The upgrade was necessary but not sufficient.

#### Spike results (SDK 0.2.64, CLI v2.1.64)

| Test | `fast_mode_state` | `usage.speed` | Notes |
|---|---|---|---|
| `fastMode: true` (file settings) | `"off"` | `"standard"` | SDK ignores the setting |
| `fastMode: false` (file settings) | `"off"` | `"standard"` | Same behavior |
| `fastMode: true` (inline via `settings` option) | `"off"` | `"standard"` | Inline settings also ignored |
| Direct API call with `speed: "fast"` | N/A | `"fast"` | **API supports fast mode for our key** |

#### Raw observations

**`fastMode: true` run — init message (0.2.64):**
```json
{ "fast_mode_state": "off", "claude_code_version": "2.1.64" }
```

**`fastMode: true` run — result usage (0.2.64):**
```json
{
  "input_tokens": 3, "cache_read_input_tokens": 21519, "output_tokens": 8,
  "service_tier": "standard", "speed": "standard"
}
```

**Direct API call — response usage:**
```json
{
  "input_tokens": 14, "output_tokens": 8,
  "service_tier": "standard", "speed": "fast"
}
```

#### Root cause analysis (from CLI binary inspection)

The CLI binary (bundled in the SDK) contains the full fast mode implementation, but activation is gated by multiple checks:

1. **`Iq()` — top-level feature gate:** When `false`, all fast mode logic returns `false`/is bypassed
2. **`nj()` — availability check** (calls `Wt()`): Returns list of blockers:
   - `"Fast mode is not available"` — if `Iq()` is false
   - `"Fast mode requires the native binary"` — if not running native
   - **`"Fast mode is not available in the Agent SDK"`** — if `flagSettings.fastMode` is `false`
   - `"Fast mode is not available on Bedrock, Vertex, or Foundry"` — if non-first-party API
3. **`flagSettings.fastMode` — server-side flag:** Checked via `IA("flagSettings")?.fastMode`. This is fetched from Anthropic's servers during CLI init. For Agent SDK mode specifically, this flag must be `true`.
4. **Activation path (when all gates pass):**
   ```
   Iq() && nj() && !VB() && _j(model) && !!fastMode → speed: "fast"
   ```

The `flagSettings.fastMode` gate is the blocker. This is a server-side feature flag that Anthropic controls — no local setting can override it.

#### Options to unblock

1. **Wait for Anthropic** to enable `flagSettings.fastMode` for Agent SDK usage (ideal — preserves all SDK-managed cooldown/fallback/reporting)
2. **Direct API passthrough** — bypass the SDK for LLM calls and pass `speed: "fast"` directly. Would lose SDK-managed cooldown, `fast_mode_state` reporting, and automatic fallback.
3. **Hybrid approach** — use the SDK's settings mechanism (for when the flag is eventually enabled) and also support a direct API fallback mode

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
