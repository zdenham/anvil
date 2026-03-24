# Anvil Presentation: Slide-by-Slide Outline

## Phases

- [x] Research codebase and architecture
- [x] Write expanded outline with talking points
- [x] Rewrite as slide-by-slide outline with diagrams
- [x] Incorporate feedback and refine

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Slide 1 — Title / Intro

*[Show logo.png — pixel skull with sine wave smile]*

# anvil

**AI agent orchestrator for software teams**

---

## Slide 2 — Table of Contents

1. Why build agent tooling?
2. Why a desktop app?
3. The next step function
4. Live demo
5. Architecture deep dive
6. Testing strategy
7. Orchestration modes
8. Code quality taxonomy
9. Maintainability
10. LLM-bound quality techniques
11. What makes code high quality?
12. What's next

---

## Slide 3 — Why Build Agent Tooling?

### The business case

- We all spend most of our time writing code
- If we build tooling that makes us measurably faster, we are better at our jobs
- Better tooling = competitive advantage. The teams that figure out agent-assisted development first win.
- This isn't theoretical — we're already using it daily to ship Anvil itself

---

## Slide 4 — Why Build a Desktop App?

### Why not just extend Claude Code?

- Claude Code hooks are powerful — PreToolUse, PostToolUse, custom timeouts, deny overrides
- But hooks are **reactive, not architectural**. You can't:
  - Control how agents are spawned, isolated, or coordinated
  - Build custom permission modes with runtime switching
  - Track state across parallel agents and sub-agents
  - Build a persistent plan system with automatic detection
  - Own the analytics pipeline
- Hooks let you add guardrails to Claude Code. A client lets you **build the rails**.
- Full control of UI: macOS-native panels, global hotkeys, system tray, live streaming with real-time diffs
- We track the SDK (`@anthropic-ai/claude-agent-sdk`) — we can adopt new capabilities day-one

---

## Slide 5 — The Next Step Function

### The three waves

**Wave 1 — Cursor / Copilot**
Embed your codebase. Autocomplete. Chat with your code.

**Wave 2 — Claude Code / Aider**
Give bash to your agents. Agents can read, write, and execute. Agentic coding arrives.

**Wave 3 — Open CLAW / Devin / SWE-Agent**
Run your agent in a loop. Autonomous task completion. But quality is inconsistent.

**Wave 4 — ? (What we're building toward)**
Align agents to recursively build your software **and keep the quality high**.
Orchestration + measurement + feedback loops = agents that improve the codebase, not just add to it.

> The goal: use agents to **raise the bar** on software quality, not just ship faster.

---

## Slide 6 — Demo Feature Overview

*[This slide sets up the live demo — enumerate what you'll show]*

Features to demonstrate:

1. **Spotlight** — Global hotkey (Cmd+Shift+Space) from any app, search threads/plans/repos
2. **Live Streaming** — Real-time text, token meters, context pressure gauge
3. **Permission Modes** — Plan / Implement / Approve, switch with Shift+Tab mid-conversation
4. **Plan Detection** — Write `## Phases` in markdown, Anvil auto-detects and tracks completion
5. **Sub-agents** — Agent spawns child threads via Task tool, routed through AgentHub
6. **Control Panel** — Quick actions (Archive, Respond, Follow-up), plan view, git diffs
7. **Clipboard Manager** — Full history in SQLite, global hotkey, smart paste to any app
8. **Session Resumption** — Kill agent mid-conversation, restart, agent picks up where it left off
9. **Permission Gates** — Approve mode shows inline diffs, approve/deny file writes
10. **Context Pressure** — Live tracking with threshold alerts (50%, 75%, 90%, 95%)
11. **System Tray** — App lives in background, left-click spotlight, right-click menu
12. **Analytics Drain** — 17 event types tracking tool lifecycle, API calls, permissions → SQLite

---

## Slide 7 — [LIVE DEMO]

*[Placeholder — game time decision on demo vs architecture first]*

---

## Slide 8 — Architecture Overview (Current State)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         YOUR MACHINE                                │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   Tauri App (Rust Shell)                       │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │              UI Layer (React + Tauri IPC)                │  │  │
│  │  │                                                         │  │  │
│  │  │  Main Window · Spotlight · Control Panel · Clipboard    │  │  │
│  │  │  Zustand stores ← eventBus (mitt) ← agent events       │  │  │
│  │  └─────────────────────────┬───────────────────────────────┘  │  │
│  │                            │ IPC                               │  │
│  │  ┌─────────────────────────┴───────────────────────────────┐  │  │
│  │  │           Claude Agent SDK Layer (Node.js)               │  │  │
│  │  │           @anthropic-ai/claude-agent-sdk                 │  │  │
│  │  │                                                         │  │  │
│  │  │  • SDK query() async iterator drives all agent logic    │  │  │
│  │  │  • Hooks: PreToolUse, PostToolUse (custom timeouts)     │  │  │
│  │  │  • Permission modes: Plan / Implement / Approve         │  │  │
│  │  │  • Spawns sub-agents via Task tool                      │  │  │
│  │  │  • SDK exposed to agents for recursive self-control     │  │  │
│  │  └─────────────────────────┬───────────────────────────────┘  │  │
│  └────────────────────────────│────────────────────────────────┘  │
│                               │                                    │
│       ┌───────────────────────┴───────────────────────┐            │
│       │              AgentHub (Rust)                    │            │
│       │         Unix Socket: ~/.anvil/agent-hub.sock    │            │
│       │                                                │            │
│       │  • Bidirectional message routing (any → any)   │            │
│       │  • Pipeline stamping (timestamps at every hop) │            │
│       │  • Sequence gap detection                      │            │
│       │  • Parent-child hierarchy tracking              │            │
│       └───────┬────────────────┬───────────────────────┘            │
│               │                │                                    │
│      ┌────────┴───────┐ ┌─────┴──────────────┐                     │
│      │ Agent Process   │ │ Agent Process       │                     │
│      │ (Node.js)       │ │ (Node.js)           │                     │
│      │                 │ │                     │                     │
│      │ Root Thread     │ │ Root Thread         │                     │
│      │ ├─ SDK query()  │ │ ├─ SDK query()      │                     │
│      │ ├─ Hooks        │ │ └─ Hooks            │                     │
│      │ └─ Sub-Agent ───┤ │                     │                     │
│      │    (child PID)  │ │                     │                     │
│      └────────────────┘ └────────────────────┘                     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Event Sync (Drains)                         │  │
│  │                                                               │  │
│  │  AgentHub stamps every event → drains to SQLite               │  │
│  │  17 event types: tool lifecycle, API calls, permissions       │  │
│  │  Future: event handlers trigger agents from drain events      │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    ~/.anvil/ (Disk as Truth)                    │  │
│  │  threads/  plans/  plan-edges/  repos/  settings/  databases/ │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Talking points:**
- **Two layers:** UI rendering (React/Tauri) and SDK control (Node.js/Claude Agent SDK) — cleanly separated
- SDK layer is the brain — it drives agents, permissions, hooks, and sub-agent spawning
- SDK will be exposed to agents themselves for recursive self-control
- Thin Rust, thick TypeScript — Rust for perf-critical (socket, IPC), TS for everything else
- Each agent = isolated Node.js process — kill PID, OS cleans up children
- **Event bus:** Any process can message any other process via AgentHub forwarding — not just parent-child
- **Event Sync (Drains):** Every event stamped and persisted to SQLite — future event handlers will react to drain events
- Unix socket > stdin/stdout: bidirectional, multiplexed, reconnectable
- Disk as truth: multi-writer safe (UI + agents both write), crash resilient

---

## Slide 9 — Event Flow & Data Model

### How data moves through the system

```
Agent Process                    AgentHub (Rust)                Tauri Frontend
─────────────                    ───────────────                ──────────────

  SDK query()
    │
    ├─ text/tool/thinking ──────► Unix Socket ──────────────► eventBus (mitt)
    │                              │                              │
    │                              ├─ stamp: hub:received         ├─ filter by threadId
    │                              ├─ stamp: hub:emitted          ├─ echo prevention
    │                              └─ drain → SQLite              └─ Zustand → React
    │
    │  ◄────── permission request ◄── permission gate ◄──────── user clicks approve
    │  ◄────── mode change ◄──────── relay ◄─────────────────── Shift+Tab
    │  ◄────── user message ◄─────── relay ◄─────────────────── user types + enter
```

### Event Bus — Any-to-Any Messaging

```
  Process A ──► AgentHub ──► Process B
                  │
                  ├──► Process C
                  └──► UI (all windows)
```

- Any process can send a message to any other process via the hub
- Hub routes by recipient ID — agents, sub-agents, UI windows
- Enables peer coordination, not just parent-child hierarchies

### Storage — Disk as Truth

```
~/.anvil/
├── agent-hub.sock              # Unix socket (runtime)
├── threads/{id}/
│   ├── metadata.json           # Status, git info, timestamps
│   ├── state.json              # Messages, tools, sessionId (resume)
│   └── draft.txt               # Unsent user input
├── plans/{id}/metadata.json    # Plan tracking
├── plan-thread-edges/          # {planId}-{threadId}.json
├── repositories/{slug}/        # Worktrees, thread branches
├── settings/config.json        # Hotkeys, preferences
└── databases/
    ├── clipboard.db            # Clipboard history (FTS)
    └── drain-events.db         # Analytics (17 event types)
```

**Writer contract:** Complete disk write BEFORE emitting event. Listeners always re-read from disk, never trust event payloads.

---

## Slide 10 — Testing Strategy: Writing Tests Faster

### Test isolation boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                        Test Pyramid                              │
│                                                                 │
│                      ┌───────────┐                              │
│                      │   E2E     │  Accessibility APIs          │
│                      │  (Tauri)  │  Real app, real processes    │
│                      └─────┬─────┘                              │
│                    ┌───────┴───────┐                             │
│                    │   Harness     │  AgentTestHarness           │
│                    │   Tests      │  Real subprocess,           │
│                    │              │  MockHubServer socket       │
│                    └───────┬──────┘                              │
│               ┌────────────┴────────────┐                       │
│               │     Happy-DOM Tests      │  Mock other processes │
│               │     (Unit / Component)   │  Fast, isolated       │
│               └──────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

### Why tests are faster on a new codebase

- **Fewer people = fewer conflicts** — you can reshape test infra without coordinating
- **Agents have log access by default** — `logs/dev.log` is always available, debugging is simpler
- **Agent-written tests** — agents can write, run, and iterate on tests in a closed loop
- **Clean boundaries** — adapter pattern means every service boundary is injectable/mockable

### Three isolation levels

| Level | What's real | What's mocked | Speed |
|---|---|---|---|
| **E2E** | Full app + agents | Nothing | Slow (~seconds) |
| **Harness** | Agent subprocess | Hub socket | Medium (~ms) |
| **Happy-DOM** | Component logic | Other processes, DOM | Fast (~ms) |

**Key insight:** Each level tests a different trust boundary. E2E proves the system works. Harness proves agent behavior. Happy-DOM proves component logic.

---

## Slide 11 — Orchestration: Two Modes

### Mode 1: Top-Down (User-Initiated Swarm)

```
  User creates plan with phases
            │
            ▼
  ┌─────────────────────┐
  │   "Build feature X"  │
  │                      │
  │   Phase 1: Research  │ ──► Agent A (Plan mode)
  │   Phase 2: Implement │ ──► Agent B (Implement mode, Worktree B)
  │   Phase 3: Tests     │ ──► Agent C (Implement mode, Worktree C)
  │   Phase 4: Review    │ ──► Agent D (Approve mode)
  └─────────────────────┘
            │
            ▼
  Phases complete → merge worktrees → quality gate → done
```

- User defines the plan, Anvil distributes phases to agents
- Each agent gets appropriate permission mode
- Parallel work on isolated worktrees
- Human stays in the loop via Approve mode on final review

### Mode 2: Event-Driven (Environment-Instigated)

```
  ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
  │  File Watch  │     │  CI Webhook  │     │  Git Hook    │
  │  (fs events) │     │  (HTTP)      │     │  (post-push) │
  └──────┬──────┘     └──────┬───────┘     └──────┬───────┘
         │                   │                    │
         ▼                   ▼                    ▼
  ┌─────────────────────────────────────────────────────────┐
  │                   Event Router                           │
  │                                                         │
  │  Rule: *.test.ts changed  → spawn test runner agent     │
  │  Rule: CI failed          → spawn diagnosis agent       │
  │  Rule: PR opened          → spawn review agent          │
  │  Rule: plan phase done    → spawn next phase agent      │
  └─────────────────────────────────────────────────────────┘
```

### Skills: Testing Orchestration Without Committing

- **Skills are composable, swappable orchestration recipes** — not hardcoded into the product
- Different teams can define different skills for the same trigger (e.g., "on PR opened" → review skill A vs review skill B)
- Test orchestration techniques simultaneously by running different skills in parallel
- Iterate on orchestration logic without modifying the core product
- **Planning for the unknown:** we don't know which orchestration patterns will win, so we make them pluggable

---

## Slide 12 — Transition: How Do We Know If It's Working?

> Agents can write code fast. But how do we know the code is **good**?

We need a taxonomy of code quality — and it's bigger than you think.

---

## Slide 13 — Code Quality Taxonomy: Static Analysis

### No execution required

```
┌──────────────────────────────────────────────────────┐
│                   STATIC ANALYSIS                     │
│                                                      │
│  • Lines of code                                     │
│  • Cyclomatic complexity                             │
│  • Linters (ESLint, Clippy)                          │
│  • Type coverage                                     │
│  • Dependency analysis                               │
│  • Dead code detection                               │
│  • Halstead volume (operator/operand complexity)     │
│  • Microsoft Maintainability Index                   │
└──────────────────────────────────────────────────────┘
```

**Cheapest to run. Every commit. No excuses.**

---

## Slide 14 — Code Quality Taxonomy: Dynamic Analysis

### Requires running the code

```
┌──────────────────────────────────────────────────────┐
│                  DYNAMIC ANALYSIS                     │
│                                                      │
│  • Test coverage (statement, branch, path)           │
│  • Integration test results                          │
│  • Performance benchmarks                            │
│  • Memory profiling                                  │
│  • Fuzzing                                           │
│  • Load testing                                      │
│  • E2E tests                                         │
└──────────────────────────────────────────────────────┘
```

**Proves things work. More expensive, but this is where confidence comes from.**

---

## Slide 15 — Code Quality Taxonomy: Live User Analysis

### Production observation

```
┌──────────────────────────────────────────────────────┐
│                 LIVE USER ANALYSIS                    │
│                                                      │
│  • Error rates                                       │
│  • Performance metrics (p50, p95, p99)               │
│  • User behavior analytics                           │
│  • Crash reports                                     │
│  • Support tickets                                   │
│  • Feature adoption rates                            │
└──────────────────────────────────────────────────────┘
```

**Proves things matter. Most teams never get here systematically.**

```
  Static ──────────► Dynamic ──────────► Live User
  Cheapest            Moderate             Most expensive
  Every commit        CI / staging         Production
  Catches syntax      Catches behavior     Catches impact
```

---

## Slide 16 — Maintainability

### The hidden cost of agent-written code

**Microsoft Maintainability Index:**

```
MI = MAX(0, (171 - 5.2 * ln(HV) - 0.23 * CC - 16.2 * ln(LOC)) * 100 / 171)
```

| Component | What it measures |
|---|---|
| **HV** (Halstead Volume) | Size/complexity from operators and operands |
| **CC** (Cyclomatic Complexity) | Number of independent code paths |
| **LOC** (Lines of Code) | Executable lines |

| Score | Rating | Visual Studio color |
|---|---|---|
| 20–100 | Good maintainability | Green |
| 10–19 | Moderate | Yellow |
| 0–9 | Low — something is wrong | Red |

### Why this matters more with agents

- **Agents dramatically reduce implementation effort**
- **But maintenance effort stays the same — or gets worse**
- Agent-written code is prolific but often:
  - Over-engineered (too many abstractions)
  - Under-documented (no design intent captured)
  - Inconsistent (different agents, different patterns)
  - Bloated (agents don't delete, they add)

### Maintainability levers

| Lever | Metric | Agent-enforceable? |
|---|---|---|
| File size | < 250 lines | Yes — lint rule |
| Function size | < 50 lines | Yes — lint rule |
| Cyclomatic complexity | < 10 per function | Yes — lint rule |
| Dead code | 0 unused exports | Yes — lint rule |
| Single responsibility | One-sentence description | Partially — LLM review |
| Naming clarity | Self-documenting | Partially — LLM review |
| Test coverage | > 80% statement | Yes — coverage gate |
| Dependency freshness | No outdated deps | Yes — automated |

**Implication:** When implementation is cheap, maintenance dominates. YAGNI and simplicity matter *more* with AI, not less.

---

## Slide 17 — LLM-Bound Quality Techniques

### Beyond static analysis — using AI to judge AI

**LLM as reviewer:**
- Code review: "Does this function do one thing? Is the naming clear? Are there edge cases?"
- Architecture review: "Does this change respect the existing patterns? Would you approve this PR?"
- Intent verification: "Does this implementation match the plan? Did it drift?"

**LLM as quality gate:**
- Pre-merge review agent in Approve mode — human signs off on AI's review
- Diff summarization: "Here's what changed and why" — reduces review burden
- Regression detection: "This change modifies behavior X, which has tests Y — did they update?"

**Agentic quality techniques:**
- Agent writes code → different agent reviews it (adversarial)
- Agent writes tests → run tests → if failing, agent iterates (closed loop)
- Agent refactors → run full test suite → if regression, revert (safe experimentation)
- Plan-driven: agent must plan first (Plan mode) → human approves plan → agent implements (Implement mode) → agent reviews (Approve mode)

---

## Slide 18 — What Makes Code High Quality?

### The arguments

**The traditionalist view:**
- Correctness, readability, maintainability, performance
- Measured by: tests pass, code review approved, no regressions
- "Good code is code that works and that someone else can understand"

**The pragmatist view:**
- Good code is code that ships, doesn't break, and is easy to change
- Measured by: deployment frequency, change failure rate, time to recovery
- DORA metrics > code metrics

**The AI-era view:**
- Good code is code that AI can **also** understand and safely modify
- Small files, clear naming, explicit types, minimal magic
- Measured by: can an agent modify this file without introducing bugs?
- New metric: **AI-navigability** — how quickly can an agent locate, understand, and safely change this code?

**The synthesis:**
- Quality = human-readable AND machine-readable
- Quality = correct today AND changeable tomorrow
- Quality = the minimum complexity needed for the current requirements (YAGNI)
- The best code is code that both humans and agents can reason about confidently

---

## Slide 19 — Future Architecture (V2: Distributed)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         YOUR MACHINE (local)                        │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                  Anvil Desktop App (same as v1)                 │  │
│  │  UI Layer · Claude Agent SDK · AgentHub · Drains · Disk       │  │
│  │                                                               │  │
│  │  Localhost dev servers run HERE                                │  │
│  │  Light work: file edits, plan management, UI                  │  │
│  └────────────────────────────┬──────────────────────────────────┘  │
│                               │                                     │
│  ┌────────────────────────────┴──────────────────────────────────┐  │
│  │              ① Buffer System (SSE)                             │  │
│  │                                                               │  │
│  │  World events (GitHub webhooks, CI status, file watch)        │  │
│  │  → forwarded to your machine via Server-Sent Events           │  │
│  │  → Event Router decides: spawn agent? ignore? queue?          │  │
│  └────────────────────────────┬──────────────────────────────────┘  │
│                               │                                     │
│  ┌────────────────────────────┴──────────────────────────────────┐  │
│  │              ② CRDT Sync Layer                                 │  │
│  │                                                               │  │
│  │  State files (threads, plans, metadata) ←→ remote machines    │  │
│  │  Code text files ←→ remote worktrees                          │  │
│  │  Conflict-free: CRDTs ensure convergence without locks        │  │
│  │  Works offline — syncs when reconnected                       │  │
│  └────────────────────────────┬──────────────────────────────────┘  │
│                               │                                     │
│  ┌────────────────────────────┴──────────────────────────────────┐  │
│  │              ③ Secrets Manager                                 │  │
│  │                                                               │  │
│  │  Safely provision environment variables to remote agents      │  │
│  │  API keys, tokens, credentials — never stored on remote disk  │  │
│  │  Enables scaling agent count without manual env setup         │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ SSE + CRDT sync
                                   │
┌──────────────────────────────────┴──────────────────────────────────┐
│                      REMOTE MACHINE(S)                               │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Heavy compute runs HERE:                                     │  │
│  │  • Bash commands (build, compile, lint)                       │  │
│  │  • Test suites (unit, integration, E2E)                       │  │
│  │  • Agent processes (SDK query loops)                          │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │  │
│  │  │ Worktree A  │  │ Worktree B  │  │ Worktree C  │           │  │
│  │  │ Agent(s)    │  │ Agent(s)    │  │ Agent(s)    │           │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │  │
│  │                                                               │  │
│  │  State synced back to local via CRDT layer                    │  │
│  │  Secrets injected at runtime, never persisted                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Key additions over v1:**
- **Buffer System (SSE):** World events forwarded to your machine in real-time — webhooks, CI, file watch
- **CRDT Sync:** State files and code synced between local and remote without locks or conflicts
- **Secrets Manager:** Safe remote environment provisioning — scale agents without manual setup
- **Split execution:** Localhost runs locally (dev servers, UI), heavy compute runs remotely (bash, tests, agents)
- Same architecture at the core — same AgentHub, same SDK, same drains

---

## Slide 20 — Closing / What's Next

- Anvil is a platform for exploring these questions, not just a tool
- We're building the feedback loop: agents write → quality is measured → agents improve
- Next steps:
  - Distributed agent orchestration (buffer + CRDT + secrets manager)
  - Quality gates integrated into the agent loop (not just CI)
  - Drain analytics dashboard — which agents produce the best code? where do they get stuck?
  - Collaborative workflows — multiple humans + multiple agents on shared plans

> The teams that figure out agent-assisted development first will have a compounding advantage.

---

*Notes: Slides 6-7 (demo) and slides 8-9 (architecture) can be reordered at game time. Demo-first works if the audience needs to see the product to engage. Architecture-first works if the audience is technical and wants to understand before they see.*
