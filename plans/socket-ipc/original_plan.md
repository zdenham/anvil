# Socket-Based IPC for Agent Communication

Original design document - see [readme.md](./readme.md) for decomposed sub-plans.

## Problem Statement

Current agent communication uses stdin/stdout piped through the **frontend renderer process**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CURRENT ARCHITECTURE                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────┐                                           │
│  │ Tauri Main Process (Rust)   │                                           │
│  │                             │                                           │
│  │ • Window management         │                                           │
│  │ • File system commands      │                                           │
│  │ • Git commands              │                                           │
│  │ • kill_process()            │                                           │
│  │                             │                                           │
│  │ ⚠️ NO agent communication!  │                                           │
│  └─────────────────────────────┘                                           │
│              ▲                                                              │
│              │ Tauri invoke() / emit()                                     │
│              ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Frontend Renderer (TypeScript/Svelte)                                │   │
│  │                                                                      │   │
│  │  agent-service.ts                                                    │   │
│  │  ├─ Command.create("node", [...])  ◄─── Spawns agents via shell     │   │
│  │  ├─ process.stdout.on("data")      ◄─── Parses JSONL output         │   │
│  │  ├─ process.write(JSON)            ───► Writes to agent stdin       │   │
│  │  └─ window.__agentServiceProcessMaps (HMR-resilient storage)        │   │
│  │                                                                      │   │
│  │  ⚠️ Frontend owns the stdio pipes!                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│              │                              ▲                               │
│              │ stdin (JSON)                 │ stdout (JSONL)               │
│              ▼                              │                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Agent Process (Node.js)                                              │   │
│  │                                                                      │   │
│  │  ├─ Reads stdin via StdinMessageStream                              │   │
│  │  ├─ Writes stdout via emitState(), emitEvent()                      │   │
│  │  └─ Spawns sub-agents via bash tool...                              │   │
│  │         │                                                            │   │
│  │         └─► Sub-Agent (Node.js)  ◄── ⚠️ NO stdin pipe!              │   │
│  │             Cannot receive: permissions, queued messages, cancel    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Core Issues:**

1. **Frontend owns the pipes** - The renderer process (not Rust) spawns agents and holds stdio handles. This is fragile:
   - HMR reloads can lose process references (mitigated by `window.__agentServiceProcessMaps`)
   - Multiple windows can't share the same agent connection
   - Renderer crashes lose all agent communication

2. **Sub-agents are deaf** - When a parent agent spawns a sub-agent via the bash tool, the sub-agent has no stdin pipe. It cannot receive:
   - Permission responses (tool approval/denial)
   - Queued messages (user input while agent is working)
   - Cancel signals

---

## Proposed Solution: Rust-Owned Socket Hub

Move agent communication from frontend stdio pipes to a **Unix socket owned by the Rust backend**. All agents (root and sub-agents) connect as clients.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PROPOSED ARCHITECTURE                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Tauri Main Process (Rust)                                            │   │
│  │                                                                      │   │
│  │  AgentHub (NEW)                                                      │   │
│  │  ├─ Creates socket at ~/.mort/agent-hub.sock                        │   │
│  │  ├─ Accepts connections from ALL agents (root + sub-agents)         │   │
│  │  ├─ Maintains: HashMap<threadId, SocketWriter>                      │   │
│  │  ├─ Routes Tauri→Agent: send_to_agent(threadId, message)            │   │
│  │  └─ Routes Agent→Tauri: emit_all("agent:message", payload)          │   │
│  │                                                                      │   │
│  │  Existing:                                                           │   │
│  │  ├─ File system commands                                            │   │
│  │  ├─ Git commands                                                     │   │
│  │  └─ Process management                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│         │                                              ▲                    │
│         │ Tauri emit_all("agent:message")             │ invoke()           │
│         ▼                                              │                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Frontend Renderer (TypeScript/Svelte)                                │   │
│  │                                                                      │   │
│  │  agent-service.ts                                                    │   │
│  │  ├─ Command.create("node", [...])  ◄─── Still spawns agents         │   │
│  │  ├─ listen("agent:message")        ◄─── Receives from Rust hub      │   │
│  │  └─ invoke("send_to_agent", {...}) ───► Sends via Rust hub          │   │
│  │                                                                      │   │
│  │  ✅ No more stdio pipe management!                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ~/.mort/agent-hub.sock  ◄── Unix socket (Rust listens)                    │
│         ▲         ▲         ▲                                              │
│         │         │         │  All agents connect as clients               │
│         │         │         │                                              │
│  ┌──────┴──┐ ┌────┴────┐ ┌──┴──────┐                                      │
│  │ Agent 1 │ │ Agent 2 │ │ Agent 3 │                                      │
│  │ (root)  │ │ (root)  │ │ (sub)   │  ◄── Sub-agents can connect too!    │
│  └─────────┘ └─────────┘ └─────────┘                                      │
│                               │                                            │
│                               └─► Spawned by Agent 1 via bash tool        │
│                                   ✅ Has full socket access                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Who Spawns What

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PROCESS HIERARCHY                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  macOS launchd                                                              │
│       │                                                                     │
│       └─► Mort.app (Tauri)                                                  │
│               │                                                             │
│               ├─► Rust Main Process (owns AgentHub socket)                  │
│               │       • Created by Tauri framework on app launch            │
│               │       • Creates ~/.mort/agent-hub.sock                      │
│               │       • Listens for agent connections                       │
│               │                                                             │
│               └─► Renderer Process (WebView/Frontend)                       │
│                       │                                                     │
│                       └─► Agent Processes (via Command.create)              │
│                               │   • node runner.js --thread-id=X           │
│                               │   • PID stored in thread metadata          │
│                               │   • Connects to AgentHub socket            │
│                               │                                             │
│                               ├─► Tool-Based Sub-Agents (via SDK Task tool)│
│                               │       • Parent spawns via SDK internals    │
│                               │       • Parent manages stdin/stdout relay  │
│                               │       • NO socket connection needed        │
│                               │       • ✅ Works today (parent relays)     │
│                               │                                             │
│                               └─► Bash-Based Sub-Agents (via Bash tool)    │
│                                       • node runner.js --thread-id=Y       │
│                                         --parent-id=X                      │
│                                       • Connects to AgentHub socket        │
│                                       • ✅ Can receive permissions/cancel  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Two Types of Sub-Agents

**Tool-Based Sub-Agents (Task tool via SDK):**
- Spawned by SDK internals when agent uses Task tool
- Parent process manages all communication via stdin/stdout
- Parent relays messages between child and Tauri
- **No socket connection needed** - parent handles everything
- Already works today

**Bash-Based Sub-Agents (Bash tool spawns `node runner.js`):**
- Spawned via shell command in Bash tool output
- No parent process managing their communication
- **Needs socket to "phone home" to Tauri**
- Currently broken - this is the problem we're solving

**Key insight:** The frontend spawns agents, but the Rust backend owns communication. This separation is important:

- **Spawning stays in frontend** because:
  - Uses Tauri's shell plugin (`Command.create`)
  - Captures stdout/stderr for debug logs
  - Can pass environment variables easily
  - Existing code works fine for this

- **Communication moves to Rust** because:
  - Socket persists across HMR reloads
  - All windows share the same hub
  - Bash-based sub-agents can connect independently
  - Rust is better suited for async I/O multiplexing

---

## Process Ownership Summary

| Component | Owner | Responsibility |
|-----------|-------|----------------|
| **Socket file** | Rust (AgentHub) | Creates on startup, deletes on exit |
| **Socket listener** | Rust (AgentHub) | Accepts connections, manages connection map |
| **Agent spawning** | Frontend (agent-service.ts) | Creates node processes (unchanged) |
| **Message routing** | Rust (AgentHub) | Routes by threadId in both directions |
| **UI updates** | Frontend (eventBus) | Receives via Tauri emit, updates components |
| **Disk state** | Agent (Node.js) | Writes state.json before socket emit (source of truth) |

---

## Event Flow Diagrams

### 1. Agent Startup Flow

```
┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐
│ Frontend │        │  Rust    │        │  Socket  │        │  Agent   │
│          │        │ AgentHub │        │   File   │        │ (Node)   │
└────┬─────┘        └────┬─────┘        └────┬─────┘        └────┬─────┘
     │                   │                   │                   │
     │ ──── App Start ───────────────────────────────────────────>
     │                   │                   │                   │
     │                   │ create + bind     │                   │
     │                   │ ─────────────────>│                   │
     │                   │                   │                   │
     │ Command.create()  │                   │                   │
     │ ─────────────────────────────────────────────────────────>│
     │                   │                   │                   │
     │                   │                   │      connect()    │
     │                   │                   │<──────────────────│
     │                   │                   │                   │
     │                   │  accept()         │                   │
     │                   │<──────────────────│                   │
     │                   │                   │                   │
     │                   │                   │   {"type":"register",
     │                   │                   │    "threadId":"abc"}
     │                   │<──────────────────────────────────────│
     │                   │                   │                   │
     │                   │ Store in HashMap: │                   │
     │                   │ agents["abc"] = writer                │
     │                   │                   │                   │
```

### 2. Agent → UI Event Flow (State Update)

```
┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐
│  Agent   │        │  Rust    │        │ Frontend │        │    UI    │
│ (Node)   │        │ AgentHub │        │ eventBus │        │ Component│
└────┬─────┘        └────┬─────┘        └────┬─────┘        └────┬─────┘
     │                   │                   │                   │
     │ 1. writeFileSync(state.json)          │                   │
     │ ─────────────────────────────────────────────────────────>│ (disk)
     │                   │                   │                   │
     │ 2. socket.write() │                   │                   │
     │ {"type":"state",  │                   │                   │
     │  "threadId":"abc",│                   │                   │
     │  "state":{...}}   │                   │                   │
     │ ─────────────────>│                   │                   │
     │                   │                   │                   │
     │                   │ 3. emit_all(      │                   │
     │                   │   "agent:message",│                   │
     │                   │   payload)        │                   │
     │                   │ ─────────────────>│                   │
     │                   │                   │                   │
     │                   │                   │ 4. eventBus.emit( │
     │                   │                   │   AGENT_STATE)    │
     │                   │                   │ ─────────────────>│
     │                   │                   │                   │
     │                   │                   │                   │ 5. Re-render
```

### 3. UI → Agent Flow (Permission Response)

```
┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐
│    UI    │        │ Frontend │        │  Rust    │        │  Agent   │
│ Component│        │          │        │ AgentHub │        │ (Node)   │
└────┬─────┘        └────┬─────┘        └────┬─────┘        └────┬─────┘
     │                   │                   │                   │
     │ User clicks       │                   │                   │
     │ "Approve"         │                   │                   │
     │ ─────────────────>│                   │                   │
     │                   │                   │                   │
     │                   │ invoke(           │                   │
     │                   │  "send_to_agent", │                   │
     │                   │  {threadId, msg}) │                   │
     │                   │ ─────────────────>│                   │
     │                   │                   │                   │
     │                   │                   │ agents["abc"]     │
     │                   │                   │  .send(msg)       │
     │                   │                   │ ─────────────────>│
     │                   │                   │                   │
     │                   │                   │                   │ Resolve
     │                   │                   │                   │ pending
     │                   │                   │                   │ promise
```

### 4. Bash-Based Sub-Agent Communication (THE KEY IMPROVEMENT)

This flow applies to **bash-based sub-agents** only. Tool-based sub-agents (via SDK Task tool) are managed entirely by their parent process via stdin/stdout relay.

```
┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐
│  Parent  │        │  Rust    │        │  Bash    │        │ Frontend │
│  Agent   │        │ AgentHub │        │ Sub-Agent│        │          │
└────┬─────┘        └────┬─────┘        └────┬─────┘        └────┬─────┘
     │                   │                   │                   │
     │ bash: node        │                   │                   │
     │  runner.js        │                   │                   │
     │  --thread-id=xyz  │                   │                   │
     │  --parent-id=abc  │                   │                   │
     │ ──────────────────────────────────────>                   │
     │                   │                   │                   │
     │                   │                   │ connect()         │
     │                   │<──────────────────│                   │
     │                   │                   │                   │
     │                   │                   │ {"type":"register",│
     │                   │                   │  "threadId":"xyz", │
     │                   │                   │  "parentId":"abc"} │
     │                   │<──────────────────│                   │
     │                   │                   │                   │
     │                   │ Store: agents["xyz"] = writer         │
     │                   │ Track: hierarchy[xyz].parent = abc    │
     │                   │                   │                   │
     │                   │                   │ {"type":"event",  │
     │                   │                   │  "name":"perm:req"}│
     │                   │<──────────────────│                   │
     │                   │                   │                   │
     │                   │ emit_all("agent:message")             │
     │                   │ ──────────────────────────────────────>│
     │                   │                   │                   │
     │                   │                   │   (user approves) │
     │                   │                   │                   │
     │                   │ send_to_agent("xyz", response)        │
     │                   │<──────────────────────────────────────│
     │                   │                   │                   │
     │                   │ agents["xyz"]     │                   │
     │                   │  .send(response)  │                   │
     │                   │ ─────────────────>│                   │
     │                   │                   │                   │
     │                   │                   │ ✅ Sub-agent       │
     │                   │                   │    receives it!   │
```

---

## Key Design Decisions

### 1. Tauri Creates Socket (Hub Model)

Tauri owns the socket and acts as a central hub:
- Creates socket on app startup
- Accepts connections from all agents
- Routes messages to specific agents by threadId
- Cleans up socket on app exit

Benefits:
- **Simpler discovery** - All agents connect to one known path
- **Centralized routing** - Hub decides where messages go
- **Easier monitoring** - All traffic flows through one place

### 2. Connection Failure Handling

Agents use **retry with backoff** when connecting to the hub socket:
- Retry connection attempts with exponential backoff
- Eventually fail if the hub never appears
- This ensures agents don't crash immediately if Tauri is slow to start, but also don't hang forever

### 3. Sub-Agent Hierarchy (Bash-Based Only)

**Bash-based sub-agents** receive a `--parent-id` argument when spawned:
- The parent agent passes its own threadId as the parent-id
- Sub-agents include `parentId` in their registration message
- Tauri can use this to track the agent hierarchy (for cascading cancellation, UI tree display, etc.)

**Tool-based sub-agents** (via SDK Task tool) don't need this - the parent process manages their communication via stdin/stdout relay. They never connect to the socket directly.

### 4. Socket Location & Discovery

```
~/.mort/agent-hub.sock
```

Built from the mort directory path, which is already available in agent context via `getMortDir()`.

**How bash-based sub-agents discover the socket:**

The socket path is derived from the mort directory, which agents already know. When a bash-based sub-agent starts:

1. Agent reads `--thread-id` and `--parent-id` from command line args
2. Agent calls `getMortDir()` to get `~/.mort`
3. Agent connects to `~/.mort/agent-hub.sock`

No environment variable needed - the socket path is deterministic from the mort directory.

**Command line for bash-based sub-agent spawn:**

```bash
# Parent agent (threadId=abc) spawns sub-agent via Bash tool:
node /path/to/runner.js \
  --thread-id=xyz \
  --parent-id=abc \
  --prompt="Do the thing"
```

This is the same invocation pattern the frontend uses to spawn root agents, just with `--parent-id` added. The runner.js detects whether it has a parent and adjusts behavior accordingly.

### 5. All Agents Send to Tauri (No Agent-to-Agent)

Sub-agents don't need to send to their parent directly. Tauri is the orchestrator:
- Sub-agents send events/state to Tauri with their `threadId`
- Tauri routes to appropriate windows
- Tauri tracks agent hierarchy if needed
- No `targetId` routing complexity needed

### 6. Message Protocol

JSONL (newline-delimited JSON) over the socket. **Same message types as current stdout protocol**:

```typescript
// Existing stdout message types - used unchanged over socket
type AgentOutput =
  | { type: "state"; state: ThreadState }
  | { type: "event"; name: EventNameType; payload: unknown }
  | { type: "log"; level: "DEBUG" | "INFO" | "WARN" | "ERROR"; message: string }
  | { type: "subagent_result"; text: string };

// Socket messages add senderId and threadId for routing
interface SocketMessage {
  senderId: string;   // Agent's threadId (or "tauri" for hub→agent)
  threadId: string;   // Thread context for UI routing
  // ...plus one of the existing message type shapes
}

// Agent → Tauri (state update)
{ "senderId": "thread-abc", "threadId": "thread-abc", "type": "state", "state": {...} }

// Agent → Tauri (event)
{ "senderId": "thread-abc", "threadId": "thread-abc", "type": "event", "name": "permission:request", "payload": {...} }

// Tauri → Agent (permission response)
{ "senderId": "tauri", "threadId": "thread-abc", "type": "permission_response", "payload": { "requestId": "...", "decision": "approve" } }

// Tauri → Agent (cancel)
{ "senderId": "tauri", "threadId": "thread-abc", "type": "cancel" }

// Tauri → Agent (queued message)
{ "senderId": "tauri", "threadId": "thread-abc", "type": "queued_message", "payload": { "content": "..." } }

// Registration (first message after connect)
{ "senderId": "thread-abc", "threadId": "thread-abc", "type": "register" }

// Registration with parent (sub-agent)
{ "senderId": "thread-xyz", "threadId": "thread-xyz", "type": "register", "parentId": "thread-abc" }
```

## Phases

- [ ] Implement Rust AgentHub (socket server, threadId routing)
- [ ] Add socket path helper to core (build from mort dir)
- [ ] Implement Node.js HubClient class
- [ ] Integrate client into agent runner (replace stdout for events)
- [ ] Handle stale socket cleanup on app startup
- [ ] Remove stdin-based communication

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Rust AgentHub (Server)

```rust
// src-tauri/src/agent_hub.rs

use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::{UnixListener, UnixStream};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, RwLock};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct SocketMessage {
    #[serde(rename = "senderId")]
    sender_id: String,
    #[serde(rename = "threadId")]
    thread_id: String,
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(flatten)]
    rest: serde_json::Value,
}

type AgentWriter = mpsc::Sender<String>;

pub struct AgentHub {
    socket_path: String,
    // Map threadId → writer channel
    agents: Arc<RwLock<HashMap<String, AgentWriter>>>,
    app_handle: AppHandle,
}

impl AgentHub {
    pub fn new(socket_path: String, app_handle: AppHandle) -> Self {
        Self {
            socket_path,
            agents: Arc::new(RwLock::new(HashMap::new())),
            app_handle,
        }
    }

    pub async fn start(&self) -> Result<(), String> {
        // Clean up stale socket
        let _ = std::fs::remove_file(&self.socket_path);

        let listener = UnixListener::bind(&self.socket_path)
            .map_err(|e| format!("Failed to bind socket: {}", e))?;

        let agents = self.agents.clone();
        let app_handle = self.app_handle.clone();

        tokio::spawn(async move {
            loop {
                if let Ok((stream, _)) = listener.accept().await {
                    let agents = agents.clone();
                    let app_handle = app_handle.clone();
                    tokio::spawn(async move {
                        Self::handle_connection(stream, agents, app_handle).await;
                    });
                }
            }
        });

        Ok(())
    }

    async fn handle_connection(
        stream: UnixStream,
        agents: Arc<RwLock<HashMap<String, AgentWriter>>>,
        app_handle: AppHandle,
    ) {
        let (reader, writer) = tokio::io::split(stream);
        let (tx, mut rx) = mpsc::channel::<String>(100);

        // Writer task - sends messages to this agent
        tokio::spawn(async move {
            let mut writer = writer;
            while let Some(msg) = rx.recv().await {
                let _ = writer.write_all(format!("{}\n", msg).as_bytes()).await;
            }
        });

        // Reader task - receives messages from this agent
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        let mut thread_id: Option<String> = None;

        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    if let Ok(msg) = serde_json::from_str::<SocketMessage>(&line) {
                        // Handle registration
                        if msg.msg_type == "register" {
                            thread_id = Some(msg.thread_id.clone());
                            agents.write().await.insert(msg.thread_id.clone(), tx.clone());
                            continue;
                        }

                        // Forward to Tauri/UI - all agent messages go to Tauri
                        app_handle.emit_all("agent:message", &msg).ok();
                    }
                }
                Err(_) => break,
            }
        }

        // Cleanup on disconnect
        if let Some(id) = thread_id {
            agents.write().await.remove(&id);
        }
    }

    /// Send a message to a specific agent by threadId
    pub async fn send_to_agent(&self, thread_id: &str, msg: &str) -> Result<(), String> {
        let agents = self.agents.read().await;
        if let Some(tx) = agents.get(thread_id) {
            tx.send(msg.to_string()).await
                .map_err(|e| format!("Send failed: {}", e))
        } else {
            Err(format!("Agent not connected: {}", thread_id))
        }
    }
}
```

### Socket Path Helper

```typescript
// core/lib/socket.ts

import { join } from "path";
import { getMortDir } from "./mort-dir.js";

/**
 * Get the path to the agent hub socket.
 * Built from the mort directory - no env vars needed.
 */
export function getHubSocketPath(): string {
  return join(getMortDir(), "agent-hub.sock");
}
```

### Node.js Hub Client (Multiple Files)

The client is split into multiple files following single responsibility principle:

```
agents/src/lib/hub/
├── index.ts           # Re-exports public API
├── types.ts           # Message type definitions
├── connection.ts      # Low-level socket connection management
├── client.ts          # High-level HubClient API
└── retry.ts           # Connection retry logic with backoff
```

#### types.ts - Message Definitions

```typescript
// agents/src/lib/hub/types.ts

/**
 * Base message structure for all socket communication.
 * All messages include sender and thread identification.
 */
export interface SocketMessage {
  senderId: string;
  threadId: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Registration message sent when agent connects to hub.
 */
export interface RegisterMessage extends SocketMessage {
  type: "register";
  parentId?: string;
}

/**
 * State update message from agent to Tauri.
 */
export interface StateMessage extends SocketMessage {
  type: "state";
  state: unknown;
}

/**
 * Event message from agent to Tauri.
 */
export interface EventMessage extends SocketMessage {
  type: "event";
  name: string;
  payload: unknown;
}

/**
 * Messages that Tauri can send to agents.
 */
export type TauriToAgentMessage =
  | { type: "permission_response"; payload: { requestId: string; decision: string } }
  | { type: "queued_message"; payload: { content: string } }
  | { type: "cancel" };
```

#### retry.ts - Connection Retry Logic

```typescript
// agents/src/lib/hub/retry.ts

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 10,
  baseDelayMs: 100,
};

/**
 * Execute an async operation with exponential backoff retry.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err as Error;
      if (attempt < options.maxRetries - 1) {
        const delay = options.baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Operation failed after ${options.maxRetries} attempts: ${lastError?.message}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

#### connection.ts - Socket Connection Management

```typescript
// agents/src/lib/hub/connection.ts

import { connect, Socket } from "net";
import { EventEmitter } from "events";
import type { SocketMessage } from "./types.js";

/**
 * Low-level socket connection to the agent hub.
 * Handles raw socket I/O and JSONL parsing.
 */
export class HubConnection extends EventEmitter {
  private socket: Socket | null = null;
  private buffer = "";

  /**
   * Attempt a single connection to the hub socket.
   * Resolves when connected, rejects on error.
   */
  connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect(socketPath);

      const onConnect = () => {
        cleanup();
        this.setupDataHandler();
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        this.socket?.removeListener("connect", onConnect);
        this.socket?.removeListener("error", onError);
      };

      this.socket.once("connect", onConnect);
      this.socket.once("error", onError);
    });
  }

  private setupDataHandler(): void {
    if (!this.socket) return;

    this.socket.on("data", (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.socket.on("close", () => {
      this.emit("disconnect");
    });

    this.socket.on("error", (err) => {
      this.emit("error", err);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as SocketMessage;
        this.emit("message", msg);
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  /**
   * Write a message to the socket as JSONL.
   */
  write(msg: SocketMessage): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(JSON.stringify(msg) + "\n");
    }
  }

  /**
   * Check if connection is active.
   */
  get isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /**
   * Close the connection.
   */
  destroy(): void {
    this.socket?.destroy();
    this.socket = null;
    this.buffer = "";
  }
}
```

#### client.ts - High-Level Client API

```typescript
// agents/src/lib/hub/client.ts

import { EventEmitter } from "events";
import { getHubSocketPath } from "@core/lib/socket.js";
import { HubConnection } from "./connection.js";
import { withRetry, type RetryOptions, DEFAULT_RETRY_OPTIONS } from "./retry.js";
import type { SocketMessage } from "./types.js";

/**
 * High-level client for communicating with the Tauri agent hub.
 * Handles connection lifecycle, registration, and message sending.
 */
export class HubClient extends EventEmitter {
  private connection: HubConnection;
  private socketPath: string;

  constructor(
    private threadId: string,
    private parentId?: string
  ) {
    super();
    this.socketPath = getHubSocketPath();
    this.connection = new HubConnection();

    // Forward events from connection
    this.connection.on("message", (msg) => this.emit("message", msg));
    this.connection.on("disconnect", () => this.emit("disconnect"));
    this.connection.on("error", (err) => this.emit("error", err));
  }

  /**
   * Connect to the hub with retry and exponential backoff.
   */
  async connect(options: Partial<RetryOptions> = {}): Promise<void> {
    const retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };

    await withRetry(() => this.connection.connect(this.socketPath), retryOptions);

    // Register with hub after successful connection
    this.send({
      type: "register",
      ...(this.parentId && { parentId: this.parentId }),
    });
  }

  /**
   * Send a message to Tauri via the hub.
   * senderId and threadId are added automatically.
   */
  send(msg: Omit<SocketMessage, "senderId" | "threadId">): void {
    const fullMsg: SocketMessage = {
      senderId: this.threadId,
      threadId: this.threadId,
      ...msg,
    };
    this.connection.write(fullMsg);
  }

  /**
   * Send state update (replaces stdout state emission).
   */
  sendState(state: unknown): void {
    this.send({ type: "state", state });
  }

  /**
   * Send event (replaces stdout event emission).
   */
  sendEvent(name: string, payload: unknown): void {
    this.send({ type: "event", name, payload });
  }

  /**
   * Check if connected to hub.
   */
  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  /**
   * Disconnect from the hub.
   */
  disconnect(): void {
    this.connection.destroy();
  }
}
```

#### index.ts - Public API Exports

```typescript
// agents/src/lib/hub/index.ts

export { HubClient } from "./client.js";
export { HubConnection } from "./connection.js";
export { withRetry, DEFAULT_RETRY_OPTIONS } from "./retry.js";
export type {
  SocketMessage,
  RegisterMessage,
  StateMessage,
  EventMessage,
  TauriToAgentMessage,
} from "./types.js";
export type { RetryOptions } from "./retry.js";
```

### Runner Integration

```typescript
// agents/src/runner.ts changes

import { HubClient } from "./lib/hub-client.js";

// Connect to hub (socket path built internally from mort dir)
const hub = new HubClient(threadId);
await hub.connect();

// Handle incoming messages from Tauri
hub.on("message", (msg: SocketMessage) => {
  switch (msg.type) {
    case "permission_response":
      permissionResolver.resolve(msg.payload.requestId, msg.payload.decision);
      break;
    case "queued_message":
      queuedMessages.enqueue(msg.payload);
      break;
    case "cancel":
      abortController.abort();
      break;
  }
});

// Replace stdout emissions with hub messages
async function emitState(): Promise<void> {
  // Still write to disk (source of truth)
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  // Send via socket instead of stdout
  hub.sendState(state);
}

// Cleanup on exit
process.on("SIGTERM", () => {
  hub.disconnect();
  process.exit(0);
});
```

## Socket Lifecycle Summary

| Event | Action |
|-------|--------|
| App starts | Tauri creates socket at `~/.mort/agent-hub.sock`, starts listening |
| Agent spawned | Agent connects to hub, sends `register` with threadId |
| State update | Agent sends `state` message |
| Permission needed | Agent sends `permission:request` event, Tauri routes response back by threadId |
| Cancel request | Tauri sends `cancel` to specific agent by threadId |
| Agent exits | Connection closes, hub removes from routing table |
| App exits | Tauri sends SIGTERM to all agent processes, closes socket, deletes socket file |

## Stale Socket Handling

A `.sock` file can exist without Tauri running (crash, unclean exit). On app startup:

1. Check if socket file exists
2. Try to connect to it
3. If connection succeeds → another Tauri instance is running, show error
4. If connection fails (ECONNREFUSED) → stale socket, safe to delete and recreate

## What Happens to Current Protocols

### Current stdout Protocol (REPLACED)

**Before:** Agent writes JSONL to stdout, frontend parses it.

```typescript
// agents/src/output.ts - CURRENT
function emitState(state: ThreadState) {
  process.stdout.write(JSON.stringify({ type: "state", state }) + "\n");
}

// src/lib/agent-service.ts - CURRENT
process.stdout.on("data", (data) => {
  const parsed = parseAgentOutput(data);
  eventBus.emit(parsed.type, parsed.payload);
});
```

**After:** Agent writes to socket, Rust hub emits to all windows.

```typescript
// agents/src/output.ts - NEW
function emitState(state: ThreadState) {
  // Disk write unchanged (source of truth)
  writeFileSync(statePath, JSON.stringify(state));
  // Socket instead of stdout
  hubClient.sendState(state);
}

// src/lib/agent-service.ts - NEW
listen("agent:message", (event) => {
  const parsed = event.payload;
  eventBus.emit(parsed.type, parsed.payload);
});
```

**stdout retained for:** Debug logs only (`console.log`, `console.error`). These go to Tauri's shell output handler for developer visibility but are not parsed.

### Current stdin Protocol (REPLACED)

**Before:** Frontend writes JSON to agent stdin.

```typescript
// src/lib/agent-service.ts - CURRENT
function sendToAgent(threadId: string, message: any) {
  const process = processMap.get(threadId);
  process.write(JSON.stringify(message) + "\n");
}

// agents/src/runners/stdin-message-stream.ts - CURRENT
process.stdin.on("data", (chunk) => {
  const msg = JSON.parse(chunk);
  handleMessage(msg);
});
```

**After:** Frontend invokes Rust command, Rust writes to socket.

```typescript
// src/lib/agent-service.ts - NEW
async function sendToAgent(threadId: string, message: any) {
  await invoke("send_to_agent", { threadId, message: JSON.stringify(message) });
}

// agents/src/lib/hub/client.ts - NEW
hubClient.on("message", (msg) => {
  handleMessage(msg);
});
```

**stdin removed:** Agents no longer read stdin. All incoming messages come via socket.

---

## Migration Path

### Phase 1: Parallel Operation
1. Implement Rust AgentHub alongside existing code
2. Implement Node.js HubClient
3. Agents connect to socket AND emit to stdout (both paths active)
4. Frontend listens to both Tauri events AND stdout parsing
5. Verify socket path works identically to stdout path

### Phase 2: Socket Primary
1. Frontend stops parsing stdout (keeps it for debug logs)
2. Frontend sends messages via `invoke("send_to_agent")` instead of stdin
3. Agents stop reading stdin
4. Remove stdin message stream code

### Phase 3: Cleanup
1. Remove stdout event emission from agents
2. Remove stdout parsing from frontend
3. Optionally migrate tool results to socket
