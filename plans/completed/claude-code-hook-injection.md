# Claude Code Hook Injection — Research & Approach

## Goal

Detect when a terminal session launches Claude Code in a Anvil-managed project directory, and inject Anvil's runner hooks into that session. This would let users interact with Anvil through Claude Code's native terminal UI instead of (or alongside) the thread UI.

---

## Phases

- [x] Research Claude Code hooks system and plugin architecture
- [ ] Design hook injection architecture
- [ ] Implement SessionStart detection and Anvil bridge
- [ ] Implement PreToolUse/PostToolUse hook bridge
- [ ] Implement permission flow bridging
- [ ] End-to-end testing with real Claude Code session

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Research Findings

### Claude Code Hook System Overview

Claude Code has a mature hooks system with **17 lifecycle events**. Hooks are configured in JSON settings files and can be installed at three scopes:

| Scope | File | Shareable |
|-------|------|-----------|
| Global (all projects) | `~/.claude/settings.json` | No |
| Project (committed) | `.claude/settings.json` | Yes |
| Project (local) | `.claude/settings.local.json` | No |
| Plugin | `hooks/hooks.json` inside plugin | Yes |
| Enterprise | Managed policy settings | Admin-controlled |

**Key property**: Hooks are **snapshotted at session start**. Changes to settings files during a session don't take effect until the session is restarted or reviewed via `/hooks`.

Sources:
- [Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [Settings Reference](https://code.claude.com/docs/en/settings)

### Relevant Hook Events

| Event | Use for Anvil | Matcher |
|-------|-------------|---------|
| **SessionStart** | Detect CC launch, register with Anvil backend, inject context | `startup`, `resume` |
| **PreToolUse** | Intercept tool calls, apply Anvil permission evaluation | Tool name regex |
| **PostToolUse** | Capture results, track file changes, forward to Anvil | Tool name regex |
| **PostToolUseFailure** | Error tracking | Tool name regex |
| **PermissionRequest** | Bridge to Anvil's permission gate UI | Tool name regex |
| **Stop** | Detect session completion, sync final state | No matcher |
| **SubagentStart/Stop** | Track child agent threads | Agent type |
| **SessionEnd** | Cleanup, deregister from Anvil backend | Reason matcher |
| **UserPromptSubmit** | Capture user prompts for Anvil thread history | No matcher |

### Hook Handler Types

1. **Command hooks** (`type: "command"`) — shell scripts that receive JSON on stdin, return JSON on stdout
2. **Prompt hooks** (`type: "prompt"`) — single-turn LLM evaluation
3. **Agent hooks** (`type: "agent"`) — multi-turn subagent with tool access

For Anvil integration, **command hooks** are the right choice — they can communicate with the Anvil backend via HTTP/sockets while hooks run.

### Hook Communication Protocol

**Input** (JSON on stdin):
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/user/my-project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "tool_use_id": "toolu_01ABC..."
}
```

**Output** (JSON on stdout, exit code 0):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "reason string",
    "updatedInput": { "command": "modified command" },
    "additionalContext": "Extra context for Claude"
  }
}
```

**Exit codes**: 0 = proceed, 2 = block (stderr fed back to Claude), other = non-blocking error.

### Plugin System

Claude Code has a **plugin system** (public beta) that bundles hooks, MCP servers, skills, and agents:

```
anvil-plugin/
  .claude-plugin/
    plugin.json          # Plugin manifest
  hooks/
    hooks.json           # Hook definitions
    session-start.sh     # SessionStart handler
    pre-tool-use.sh      # PreToolUse handler
    post-tool-use.sh     # PostToolUse handler
  .mcp.json              # Optional MCP server config
```

Install: `/plugin install anvil-plugin@/path/to/plugin`

Plugin hooks use `${CLAUDE_PLUGIN_ROOT}` for portable path references. This is the cleanest distribution mechanism.

Sources:
- [Plugins Docs](https://code.claude.com/docs/en/plugins)
- [Plugin Announcement](https://www.anthropic.com/news/claude-code-plugins)
- [Official Plugins Repo](https://github.com/anthropics/claude-code/tree/main/plugins)

---

## Approach Comparison

### Option A: Project `.claude/settings.json` Hooks

**How it works**: Add hook entries to the project's `.claude/settings.json` (or `.claude/settings.local.json`). When any developer opens Claude Code in this directory, Anvil's hooks fire automatically.

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "startup|resume",
      "hooks": [{
        "type": "command",
        "command": "anvil-hook session-start",
        "timeout": 10
      }]
    }],
    "PreToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "anvil-hook pre-tool-use",
        "timeout": 3600
      }]
    }],
    "PostToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "anvil-hook post-tool-use",
        "timeout": 30
      }]
    }]
  }
}
```

**Pros**: Simple setup, per-project, no plugin infrastructure needed
**Cons**: Clutters project settings, not portable, merge conflicts with team

### Option B: Claude Code Plugin (Recommended)

**How it works**: Package Anvil hooks as a Claude Code plugin. Users install it once. The plugin's `hooks.json` defines all hook handlers. Hook scripts communicate with the running Anvil backend over HTTP or Unix socket.

**Pros**: Clean separation, installable/removable, portable, uses `${CLAUDE_PLUGIN_ROOT}`
**Cons**: Plugin system is still in beta, requires plugin manifest

### Option C: Global `~/.claude/settings.json` Hooks

**How it works**: Install hooks globally. SessionStart checks if the cwd is a Anvil-managed directory (e.g., has `.anvil/` or is registered in `~/.anvil/repositories/`). If so, activate; otherwise no-op.

**Pros**: Works everywhere without per-project setup
**Cons**: Fires for ALL Claude Code sessions (perf concern), detection logic needed

### Option D: MCP Server Bridge

**How it works**: Run Anvil as an MCP server. Claude Code connects via `.mcp.json`. Anvil exposes custom tools (ask-question, check-permission, etc.) that Claude Code can call.

**Pros**: Rich bidirectional communication, custom tools
**Cons**: Doesn't intercept native tool calls (Bash, Edit, etc.), supplemental only

**Recommendation**: **Option B (Plugin)** as the primary distribution, with **Option C (Global hooks)** as an alternative for development. Option D (MCP) is complementary for exposing Anvil-specific capabilities.

---

## Architecture Design

### Core Concept: Hook Bridge Process

Anvil's agent runner currently builds hooks as in-process TypeScript callbacks inside `runAgentLoop()`. For Claude Code integration, we need a **bridge** that translates between:

- **Claude Code hooks** (shell commands receiving JSON on stdin/stdout)
- **Anvil backend** (HTTP/WebSocket API running in Tauri process or standalone)

```
┌─────────────────────┐     stdin/stdout      ┌──────────────────┐
│    Claude Code       │ ──────────────────── │  anvil-hook CLI    │
│    (terminal UI)     │    (JSON protocol)    │  (bridge script)  │
└─────────────────────┘                       └────────┬─────────┘
                                                       │ HTTP/WS
                                                       ▼
                                              ┌──────────────────┐
                                              │   Anvil Backend    │
                                              │  (Tauri/Node)     │
                                              │                   │
                                              │ • PermissionGate  │
                                              │ • QuestionGate    │
                                              │ • Thread tracking │
                                              │ • File tracking   │
                                              │ • Analytics       │
                                              └──────────────────┘
```

### `anvil-hook` CLI Bridge

A lightweight executable (Node.js script or compiled binary) that:

1. Reads JSON from stdin (Claude Code hook input)
2. Sends it to the Anvil backend via HTTP or Unix socket
3. Waits for the response (permission decision, updated input, etc.)
4. Outputs JSON to stdout and exits with appropriate code

```bash
#!/usr/bin/env node
// anvil-hook — bridge between Claude Code hooks and Anvil backend
import { readStdin, sendToAnvil, formatOutput } from './bridge-lib';

const event = process.argv[2]; // "session-start", "pre-tool-use", etc.
const input = await readStdin();
const result = await sendToAnvil(event, input);
process.stdout.write(JSON.stringify(formatOutput(result)));
process.exit(result.exitCode);
```

### Session Lifecycle

#### 1. SessionStart — Register Session
```
Claude Code starts → SessionStart hook fires → anvil-hook session-start
  → Anvil backend creates a thread (or links to existing)
  → Returns context to inject (CLAUDE.md content, project info)
  → Sets session_id ↔ thread_id mapping
```

The SessionStart hook can inject Anvil context via stdout (added to Claude's context) and persist env vars via `$CLAUDE_ENV_FILE`:
```bash
echo "ANVIL_THREAD_ID=$THREAD_ID" >> "$CLAUDE_ENV_FILE"
echo "ANVIL_SESSION_URL=http://localhost:$PORT" >> "$CLAUDE_ENV_FILE"
```

#### 2. PreToolUse — Permission Evaluation
```
Claude wants to run tool → PreToolUse hook fires → anvil-hook pre-tool-use
  → Anvil backend evaluates permissions (PermissionEvaluator)
  → If needs user approval: PermissionGate waits for Anvil UI decision
  → Returns: allow/deny/ask + optional updatedInput
```

**Critical**: The PreToolUse hook timeout must be set high (3600s) to support waiting for user approval in the Anvil UI, matching the current runner behavior.

**AskUserQuestion special case**: For AskUserQuestion, the hook can use the same two-phase pattern currently in the runner:
1. PreToolUse hook stashes the question, returns `permissionDecision: "ask"`
2. This forces Claude Code to show its native permission prompt
3. The PermissionRequest hook (if needed) can intercept and auto-approve with `updatedInput.answers`

However, with Claude Code's terminal UI, AskUserQuestion has a native elicitation dialog. The hook could:
- Let it pass through (user answers in terminal) → PostToolUse captures answers
- Or intercept and redirect to Anvil UI for answering

#### 3. PostToolUse — State Tracking
```
Tool completes → PostToolUse hook fires → anvil-hook post-tool-use
  → Anvil backend records: file changes, tool results, plan detection
  → No blocking needed (exit 0 immediately)
  → Can use async: true for fire-and-forget
```

#### 4. SubagentStart — Child Thread Tracking
```
Claude spawns Task agent → SubagentStart hook fires → anvil-hook subagent-start
  → Anvil backend creates child thread
  → Maps subagent to thread hierarchy
```

#### 5. SessionEnd — Cleanup
```
Claude Code exits → SessionEnd hook fires → anvil-hook session-end
  → Anvil backend marks thread complete
  → Final state sync
```

### Mapping Current Runner Hooks → Claude Code Hooks

| Current Runner Hook | Claude Code Hook | Notes |
|---------------------|-----------------|-------|
| PreToolUse: AskUserQuestion | PreToolUse + PermissionRequest | Two-phase pattern or let terminal handle natively |
| PreToolUse: PermissionEvaluator | PreToolUse (all tools) | Direct mapping — allow/deny/ask |
| PreToolUse: Task tool | PreToolUse (matcher: "Task") + SubagentStart | Child thread creation |
| PostToolUse: state tracking | PostToolUse (all tools) | File changes, plan detection |
| PostToolUseFailure: error tracking | PostToolUseFailure | Error classification |
| canUseTool: answer delivery | PermissionRequest hook | `updatedInput.answers` via PermissionRequest |
| Stop hook | Stop hook | Task validation |

### Backend API Surface

The Anvil backend needs to expose an API for the hook bridge. Since the Tauri app already runs a local server, this could be additional endpoints:

```
POST /api/hooks/session-start     { session_id, cwd, model }
POST /api/hooks/pre-tool-use      { session_id, tool_name, tool_input, tool_use_id }
POST /api/hooks/post-tool-use     { session_id, tool_name, tool_input, tool_response }
POST /api/hooks/permission-request { session_id, tool_name, tool_input }
POST /api/hooks/subagent-start    { session_id, agent_type }
POST /api/hooks/session-end       { session_id, reason }
```

Or a single endpoint:
```
POST /api/hooks/:event_name       { ...hook_input }
```

### Open Questions

1. **Anvil running or not?** If the Anvil desktop app isn't running when Claude Code starts, what happens? Options:
   - Hook exits with code 0 (no-op, CC continues without Anvil)
   - Hook launches Anvil in the background
   - Hook blocks with exit 2 and tells Claude "Anvil not available"

2. **Dual-mode sessions**: Can a session be viewed in both Claude Code terminal AND Anvil thread UI simultaneously? This requires real-time state sync.

3. **Transcript bridging**: Claude Code writes transcripts to `~/.claude/projects/.../transcript.jsonl`. Should Anvil read these directly, or should hooks forward all messages?

4. **Permission mode conflicts**: If Claude Code is running in `bypassPermissions` mode, Anvil's permission hooks still fire (confirmed by prior research). But if CC is in `default` mode, both CC's native permissions AND Anvil's hooks apply. Need to decide who owns permission decisions.

5. **AskUserQuestion UX**: In terminal, CC has native elicitation dialogs. Should Anvil intercept these (redirect to Anvil UI) or let the terminal handle them? If intercepted, the user can't answer in the terminal.

---

## References

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Hooks Automation Guide](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code Settings](https://code.claude.com/docs/en/settings)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code MCP Integration](https://code.claude.com/docs/en/mcp)
- [Official Plugins Repository](https://github.com/anthropics/claude-code/tree/main/plugins)
- [Plugins Announcement](https://www.anthropic.com/news/claude-code-plugins)
- [Hook Development Skill (official)](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md)
- [Community Hooks Mastery Repo](https://github.com/disler/claude-code-hooks-mastery)
- [In-Process Hooks Feature Request (GitHub #7535)](https://github.com/anthropics/claude-code/issues/7535)
