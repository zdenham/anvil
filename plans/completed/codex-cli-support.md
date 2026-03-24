# Codex CLI Support — Feasibility Assessment

## TL;DR

**Hard, but not impossible.** Estimated at 60-70% of the original Claude integration effort. The `@openai/codex-sdk` npm package exists and is designed for embedding (spawns CLI as subprocess, JSONL over stdin/stdout), but there are significant gaps in hook/permission control that would require architectural workarounds.

---

## Current Architecture Coupling

The agent layer (`agents/src/runners/shared.ts`) is **tightly coupled** to the Claude Agent SDK:

| Layer | Coupling | Notes |
| --- | --- | --- |
| `query()` async iterator | Direct | Entire agent loop built around it |
| Hook system (6+ hooks) | Critical | PreToolUse/PostToolUse intercept every tool call |
| `canUseTool` callback | High | Two-phase permission gate (AskUserQuestion flow) |
| Tool definitions | High | Preset `claude_code` tools |
| System prompt format | High | Preset + appended template interpolation |
| Message/streaming format | Medium | SDKMessage types drive all state updates |
| Session resumption | Medium | SDK's sessionId for conversation continuity |
| Sub-agent spawning | High | PreToolUse hook creates child threads dynamically |
| Tauri IPC (hub/socket) | **Low** | Generic — not Claude-specific |
| Thread state persistence | **Low** | Disk-as-truth, just JSON files |
| Plan/comment detection | **Low** | PostToolUse pattern matching, provider-agnostic |

**Key insight:** The Tauri shell (spawning, socket IPC, state persistence, UI rendering) is provider-agnostic. The agent runner layer is not.

---

## Codex SDK Capabilities vs Requirements

### What Codex SDK offers (`@openai/codex-sdk`)

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex({ env: { CODEX_API_KEY: "..." } });
const thread = codex.startThread({ workingDirectory: "/repo" });

// Buffered
const turn = await thread.run("Fix the tests");

// Streaming
const { events } = await thread.runStreamed("Refactor auth");
for await (const event of events) {
  // event.type: "item.started" | "item.completed" | "turn.started" | "turn.completed"
}

// Resume
const resumed = codex.resumeThread(savedThreadId);
```

- Spawns Codex CLI (Rust binary) as subprocess
- JSONL communication over stdin/stdout
- Thread persistence to `~/.codex/sessions`
- `env` parameter for sandboxed hosts (designed for Electron/Tauri)
- MCP tool support
- Configurable models (GPT-5.4, GPT-5.4 mini, etc.)

### Feature Parity Matrix

| Anvil Feature | Claude SDK | Codex SDK | Gap |
| --- | --- | --- | --- |
| Agent loop | `query()` async iterator | `runStreamed()` async generator | Minor — different shapes, same pattern |
| Per-token streaming | `stream_event` deltas | `item.started/completed` | **Major** — Codex is item-level, not token-level |
| PreToolUse hooks | Full programmatic hooks | Declarative `approval_policy` config only | **Critical** — no code injection point |
| PostToolUse hooks | Full programmatic hooks | `item.completed` event (read-only) | **Major** — can observe but not intercept |
| canUseTool gate | 60s timeout callback | No equivalent | **Critical** — AskUserQuestion two-phase flow breaks |
| Permission decisions | Hook returns allow/deny | Config-based only | **Major** — no runtime permission mediation |
| Sub-agent spawning | PreToolUse creates child threads | No hook to intercept | **Critical** — entire sub-agent architecture depends on this |
| Tool definitions | Preset `claude_code` tools | Built-in file/bash/MCP tools | Medium — different tool set, less configurable |
| System prompt | Preset + appended | Config-based instructions | Low — just a different config format |
| Session resume | SDK sessionId | `resumeThread(threadId)` | Low — both support it |
| Sandbox/security | Hooks + permission evaluator | OS-level sandbox (Seatbelt/Landlock) | Different approach — Codex is more locked down by default |
| Plans/skills | Detected via PostToolUse hooks | Would need item.completed parsing | Medium — doable with adapter |
| Thread naming | Anthropic API call | Would need OpenAI API call | Low |

---

## Critical Gaps (The Hard Parts)

### 1. No Programmable Hooks — Breaks 80% of agent features

The entire Anvil permission/interception layer is built on Claude SDK hooks:

- **AskUserQuestion** — two-phase async gate with 1-hour timeout
- **Safe-git** — blocks destructive git operations
- **Repl-hook** — intercepts anvil-repl Bash calls
- **Comment-resolution** — intercepts anvil-resolve-comment calls
- **Permission evaluator** — rules engine for tool allowance
- **Sub-agent spawner** — creates child threads on Task/Agent tool use

Codex has no equivalent. The `approval_policy` is declarative config, not runtime code.

**Workaround options:**

- (a) Build a JSONL proxy between Codex CLI and your app that intercepts tool calls before forwarding — fragile, undocumented internal protocol
- (b) Use the Codex App Server WebSocket mode and intercept at the transport layer — experimental, unclear if approval requests surface
- (c) Accept reduced functionality for Codex mode (no custom hooks, basic permissions only)
- (d) Fork Codex CLI (it's open source Rust) and add hook points — massive maintenance burden

### 2. No Fine-Grained Streaming — Degraded UX

Claude SDK emits per-content-block deltas (`TextDelta`, tool_use start). Codex SDK emits `item.completed` — you see results after the fact. This means:

- No character-by-character text streaming in the UI
- No "tool running" indicator until it finishes
- Potentially long silent periods during complex operations

**Workaround:** The Codex App Server may offer finer-grained events. Needs investigation.

### 3. Sub-Agent Architecture Breaks

Anvil's sub-agent system works by:

1. PreToolUse hook intercepts Task/Agent tool calls
2. Creates a child thread + spawns child process BEFORE the SDK executes the tool
3. PostToolUse captures child's response

With Codex, there's no way to intercept tool calls before execution. The entire multi-agent orchestration layer would need redesign.

**Workaround:** Use Codex in a simpler mode without sub-agents, or implement sub-agents at a layer above Codex (your app spawns multiple independent Codex threads and coordinates them).

---

## Architecture Required

To support both Claude and Codex, you'd need an **Agent Backend abstraction**:

```
┌─────────────────────────────────────────┐
│              Tauri Shell                 │
│  (spawning, socket IPC, UI, state)      │
│          ← already generic →            │
├─────────────────────────────────────────┤
│          Agent Backend Interface         │
│  startAgent(config) → AsyncIterable     │
│  cancelAgent(id) → void                 │
│  injectMessage(id, msg) → void          │
├──────────────────┬──────────────────────┤
│  Claude Backend  │   Codex Backend      │
│  (shared.ts)     │   (new file)         │
│  query() + hooks │   runStreamed()      │
│  Full features   │   Reduced features   │
└──────────────────┴──────────────────────┘
```

The interface would normalize:

- Events → unified `AgentEvent` type (text, tool_start, tool_end, error, usage)
- Prompts → string input (both support this)
- State → both persist to disk (different formats, need adapter)
- Permissions → Claude uses hooks, Codex uses config + OS sandbox

---

## Effort Estimate

| Work Item | Effort | Notes |
| --- | --- | --- |
| Agent Backend interface + types | Medium | New abstraction layer over runners |
| Codex runner implementation | Large | New `runCodexLoop()` parallel to `runAgentLoop()` |
| Event normalization adapter | Medium | Map Codex JSONL events → unified AgentEvent |
| UI provider selector | Small | Config/UI to choose Claude vs Codex |
| Reduced-feature mode for Codex | Medium | Graceful degradation of hooks/permissions |
| Sub-agent redesign for Codex | Large | Fundamentally different approach needed |
| Streaming adapter | Medium | Handle coarser Codex events in the content pane |
| Auth/config management | Small | CODEX_API_KEY, model selection |
| Testing infrastructure | Medium | Parallel test suites for both backends |
| **Total** | **\~3-4 weeks of focused work** | Assuming reduced feature set for Codex |

For **full feature parity** (including hooks, sub-agents, fine-grained streaming): add another 3-4 weeks and accept significant maintenance burden from either forking Codex or building fragile proxy layers.

---

## Recommendation

### Option A: Reduced-Feature Codex Support (Recommended)

- Support Codex as a "simpler" backend — single-agent, OS-sandbox permissions, item-level streaming
- Users who want full orchestration/hooks/sub-agents use Claude
- Users who want OpenAI models get Codex with basic features
- **Effort: \~3-4 weeks**

### Option B: Full Parity via Codex Fork

- Fork the open-source Codex CLI, add hook points in Rust
- Maintain a custom build of Codex alongside the Claude SDK
- **Effort: \~6-8 weeks + ongoing maintenance**

### Option C: OpenAI via Claude-Compatible Adapter

- Instead of Codex CLI, use OpenAI's API directly through an adapter that mimics Claude SDK patterns
- Build your own tool execution layer on top of OpenAI's chat/responses API
- Get full hook control since you own the execution layer
- **Effort: \~8-10 weeks** (you're building your own agent runtime)

### Option D: Wait for Convergence

- Both Claude and Codex are evolving rapidly
- MCP is becoming a shared standard
- A provider-agnostic agent SDK may emerge
- **Effort: None now, reassess quarterly**

---

## Phases (if proceeding with Option A)

- [ ] Spike: Embed `@openai/codex-sdk` in test harness, validate JSONL event flow

- [ ] Design Agent Backend interface abstracting over both SDKs

- [ ] Implement Codex runner with basic single-agent support

- [ ] Build event normalization adapter (Codex events → unified format)

- [ ] Add provider selection UI and auth management

- [ ] Adapt content pane for item-level (non-streaming) updates

- [ ] Testing and polish

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---