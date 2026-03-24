# Architecture Overview

All 5 implementations share the same high-level architecture. The refactor moves command execution from Rust into a Node.js sidecar process, with WebSocket as the transport layer.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Tauri Desktop App                            │
│                                                                     │
│  ┌──────────────────────────┐    ┌────────────────────────────────┐ │
│  │     Rust (src-tauri/)     │    │    React Frontend (src/)       │ │
│  │                           │    │                                │ │
│  │  ┌─────────────────────┐  │    │  ┌──────────────────────────┐ │ │
│  │  │   Native Commands   │  │    │  │     invoke(cmd, args)    │ │ │
│  │  │  - Window mgmt      │◄─┼────┼──│                          │ │ │
│  │  │  - Hotkeys           │ IPC  │  │  Routes:                 │ │ │
│  │  │  - Panels            │  │   │  │  - Native → Tauri IPC    │ │ │
│  │  │  - Clipboard         │  │   │  │  - Data   → WebSocket    │ │ │
│  │  │  - Accessibility     │  │   │  └──────────┬───────────────┘ │ │
│  │  └─────────────────────┘  │    │             │ WS               │ │
│  │                           │    └─────────────┼─────────────────┘ │
│  │  ┌─────────────────────┐  │                  │                   │
│  │  │  Sidecar Lifecycle  │  │                  │                   │
│  │  │  - spawn(node ...)  │  │                  │                   │
│  │  │  - SIGTERM/SIGKILL  │  │                  │                   │
│  │  │  - Port file read   │  │                  │                   │
│  │  └────────┬────────────┘  │                  │                   │
│  └───────────┼───────────────┘                  │                   │
│              │ spawn                            │                   │
└──────────────┼──────────────────────────────────┼───────────────────┘
               │                                  │
               ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Node.js Sidecar Process                          │
│                                                                      │
│  ┌─────────────┐  ┌────────────────────────────────────────────────┐ │
│  │ Express HTTP │  │            WebSocket Server                    │ │
│  │  /files      │  │                                                │ │
│  │  /health     │  │  /ws ─────────────► Command Dispatch           │ │
│  └─────────────┘  │  │                   ┌──────────────────────┐  │ │
│                    │  │                   │  fs_*    → FS cmds   │  │ │
│                    │  │                   │  git_*   → Git cmds  │  │ │
│                    │  │                   │  shell_* → Shell     │  │ │
│                    │  │                   │  agent_* → Agents    │  │ │
│                    │  │                   │  *_terminal → PTY    │  │ │
│                    │  │                   │  *_watch   → Choki.  │  │ │
│                    │  │                   │  misc      → Catch   │  │ │
│  ┌─────────────┐  │  │                   └──────────────────────┘  │ │
│  │ Port File   │  │  │                                              │ │
│  │ ~/.anvil/    │  │  /ws/agent ────────► Agent Hub                  │ │
│  │  sidecar-   │  │                      ┌─────────────────────┐   │ │
│  │  {hash}.port│  │                      │ register/relay/drain│   │ │
│  └─────────────┘  │                      │ pipeline stamping   │   │ │
│                    │                      │ sequence gap detect │   │ │
│  ┌─────────────────┤                     └──────────┬──────────┘   │ │
│  │    Managers      │                               │               │ │
│  │  TerminalMgr     │                               │               │ │
│  │  WatcherMgr      │         ┌─────────────────────┘               │ │
│  │  AgentProcessMgr │         │                                     │ │
│  │  LockMgr         │         │  ┌───────────────────────────────┐  │ │
│  │  EventBroadcaster│◄────────┘  │    Agent Processes (child)    │  │ │
│  └──────────────────┘            │  node agent-runner.js          │  │ │
│                                  │  Connects back to /ws/agent    │  │ │
│                                  └───────────────────────────────┘  │ │
└──────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │   Browser Web Build   │
                    │  (No Tauri — WS only) │
                    │                       │
                    │  Same React app       │
                    │  invoke() → WS only   │
                    │  Tauri API shims      │
                    │  /files for assets    │
                    └───────────┬───────────┘
                                │ WS
                                ▼
                     ws://127.0.0.1:9600/ws
```

## Shared Protocol

```
Request:   { id: number, cmd: string, args: Record<string, unknown> }
Response:  { id: number, result?: unknown, error?: string }
Push:      { event: string, payload: unknown }
Relay:     { relay: true, event: string, payload: unknown }
```