# 02: Rust AgentHub

Implement the socket server in Rust that acts as the central communication hub for all agents.

## Context

The AgentHub is a Unix socket server owned by Tauri that:
- Creates socket at `~/.mort/agent-hub.sock` on app startup
- Accepts connections from all agents (root + bash-based sub-agents)
- Routes messages between agents and the frontend via Tauri events
- Cleans up on app exit

## Phases

- [x] Create `agent_hub.rs` module with AgentHub struct
- [x] Implement socket listener with connection handling
- [x] Implement agent registration and routing table
- [x] Add `send_to_agent` Tauri command
- [x] Handle stale socket cleanup on startup
- [x] Integrate into Tauri app lifecycle (start on launch, cleanup on exit)
- [x] Add agent hierarchy tracking (parentId)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

### File: `src-tauri/src/agent_hub.rs`

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::{UnixListener, UnixStream};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, RwLock};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SocketMessage {
    #[serde(rename = "senderId")]
    pub sender_id: String,
    #[serde(rename = "threadId")]
    pub thread_id: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(rename = "parentId", skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(flatten)]
    pub rest: serde_json::Value,
}

type AgentWriter = mpsc::Sender<String>;

pub struct AgentHub {
    socket_path: String,
    agents: Arc<RwLock<HashMap<String, AgentWriter>>>,
    // Track parent-child relationships for hierarchy
    hierarchy: Arc<RwLock<HashMap<String, Option<String>>>>,
}

impl AgentHub {
    pub fn new(socket_path: String) -> Self {
        Self {
            socket_path,
            agents: Arc::new(RwLock::new(HashMap::new())),
            hierarchy: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        // Clean up stale socket
        self.cleanup_stale_socket().await?;

        let listener = UnixListener::bind(&self.socket_path)
            .map_err(|e| format!("Failed to bind socket: {}", e))?;

        let agents = self.agents.clone();
        let hierarchy = self.hierarchy.clone();

        tokio::spawn(async move {
            loop {
                if let Ok((stream, _)) = listener.accept().await {
                    let agents = agents.clone();
                    let hierarchy = hierarchy.clone();
                    let app_handle = app_handle.clone();
                    tokio::spawn(async move {
                        Self::handle_connection(stream, agents, hierarchy, app_handle).await;
                    });
                }
            }
        });

        Ok(())
    }

    async fn cleanup_stale_socket(&self) -> Result<(), String> {
        use std::os::unix::net::UnixStream as StdUnixStream;

        if std::path::Path::new(&self.socket_path).exists() {
            // Try to connect - if it succeeds, another instance is running
            match StdUnixStream::connect(&self.socket_path) {
                Ok(_) => {
                    return Err("Another Mort instance is already running".to_string());
                }
                Err(_) => {
                    // Stale socket, safe to remove
                    let _ = std::fs::remove_file(&self.socket_path);
                }
            }
        }
        Ok(())
    }

    async fn handle_connection(
        stream: UnixStream,
        agents: Arc<RwLock<HashMap<String, AgentWriter>>>,
        hierarchy: Arc<RwLock<HashMap<String, Option<String>>>>,
        app_handle: AppHandle,
    ) {
        let (reader, writer) = tokio::io::split(stream);
        let (tx, mut rx) = mpsc::channel::<String>(100);

        // Writer task - sends messages to this agent
        let mut writer = writer;
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if writer.write_all(format!("{}\n", msg).as_bytes()).await.is_err() {
                    break;
                }
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
                            hierarchy.write().await.insert(msg.thread_id.clone(), msg.parent_id.clone());
                            continue;
                        }

                        // Forward to Tauri/UI
                        let _ = app_handle.emit_all("agent:message", &msg);
                    }
                }
                Err(_) => break,
            }
        }

        // Cleanup on disconnect
        if let Some(id) = thread_id {
            agents.write().await.remove(&id);
            hierarchy.write().await.remove(&id);
        }
    }

    pub async fn send_to_agent(&self, thread_id: &str, msg: &str) -> Result<(), String> {
        let agents = self.agents.read().await;
        if let Some(tx) = agents.get(thread_id) {
            tx.send(msg.to_string()).await
                .map_err(|e| format!("Send failed: {}", e))
        } else {
            Err(format!("Agent not connected: {}", thread_id))
        }
    }

    pub fn cleanup(&self) {
        let _ = std::fs::remove_file(&self.socket_path);
    }
}
```

### Tauri Command: `src-tauri/src/lib.rs`

```rust
#[tauri::command]
async fn send_to_agent(
    state: tauri::State<'_, Arc<AgentHub>>,
    thread_id: String,
    message: String,
) -> Result<(), String> {
    state.send_to_agent(&thread_id, &message).await
}
```

### App Lifecycle Integration

In `main.rs` or `lib.rs` setup:

```rust
fn main() {
    let mort_dir = dirs::home_dir().unwrap().join(".mort");
    let socket_path = mort_dir.join("agent-hub.sock").to_string_lossy().to_string();

    let hub = Arc::new(AgentHub::new(socket_path));
    let hub_cleanup = hub.clone();

    tauri::Builder::default()
        .manage(hub.clone())
        .setup(move |app| {
            let app_handle = app.handle();
            let hub = hub.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = hub.start(app_handle).await {
                    eprintln!("Failed to start AgentHub: {}", e);
                }
            });
            Ok(())
        })
        .on_window_event(move |event| {
            if let tauri::WindowEvent::Destroyed = event.event() {
                hub_cleanup.cleanup();
            }
        })
        .invoke_handler(tauri::generate_handler![send_to_agent])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Acceptance Criteria

- [x] Socket created at `~/.mort/agent-hub.sock` on app start
- [x] Multiple agents can connect simultaneously
- [x] Agent registration stores threadId → writer mapping
- [x] Messages from agents are emitted via `emit("agent:message", ...)` (using Tauri 2.x API)
- [x] `send_to_agent` command routes messages to correct agent
- [x] Stale socket is detected and cleaned up on startup
- [x] Socket file is deleted on app exit
- [x] Parent-child hierarchy is tracked via `parentId`

## Verification

### Unit Test Approaches

Create `src-tauri/src/agent_hub_test.rs` with the following test cases:

**1. AgentHub Creation**
```rust
#[test]
fn test_agent_hub_new() {
    let hub = AgentHub::new("/tmp/test-hub.sock".to_string());
    assert_eq!(hub.socket_path, "/tmp/test-hub.sock");
}
```

**2. SocketMessage Serialization/Deserialization**
```rust
#[test]
fn test_socket_message_serialization() {
    let msg = SocketMessage {
        sender_id: "agent-1".to_string(),
        thread_id: "thread-123".to_string(),
        msg_type: "register".to_string(),
        parent_id: Some("parent-456".to_string()),
        rest: serde_json::json!({"foo": "bar"}),
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"senderId\":\"agent-1\""));
    assert!(json.contains("\"threadId\":\"thread-123\""));
    assert!(json.contains("\"parentId\":\"parent-456\""));

    let parsed: SocketMessage = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.sender_id, "agent-1");
    assert_eq!(parsed.thread_id, "thread-123");
    assert_eq!(parsed.parent_id, Some("parent-456".to_string()));
}

#[test]
fn test_socket_message_without_parent_id() {
    let msg = SocketMessage {
        sender_id: "agent-1".to_string(),
        thread_id: "thread-123".to_string(),
        msg_type: "register".to_string(),
        parent_id: None,
        rest: serde_json::json!({}),
    };

    let json = serde_json::to_string(&msg).unwrap();
    // parentId should be omitted when None (skip_serializing_if)
    assert!(!json.contains("parentId"));
}
```

**3. Stale Socket Cleanup**
```rust
#[tokio::test]
async fn test_cleanup_stale_socket() {
    let socket_path = "/tmp/test-stale.sock";

    // Create a stale socket file (not actively listening)
    std::fs::write(socket_path, "").unwrap();

    let hub = AgentHub::new(socket_path.to_string());
    let result = hub.cleanup_stale_socket().await;

    assert!(result.is_ok());
    assert!(!std::path::Path::new(socket_path).exists());
}
```

**4. Edge Cases to Test**
- Empty message handling (should be ignored gracefully)
- Malformed JSON handling (should not crash the server)
- Agent disconnection cleanup (verify removal from HashMap)
- Duplicate registration with same threadId (should overwrite)
- Send to non-existent agent (should return error)

### Integration Test Approaches

**1. Full Connection Lifecycle Test**
```rust
#[tokio::test]
async fn test_agent_connection_lifecycle() {
    use tokio::net::UnixStream;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let socket_path = "/tmp/test-integration.sock";
    let _ = std::fs::remove_file(socket_path); // Clean up

    // Start hub (mock app_handle needed)
    let hub = Arc::new(AgentHub::new(socket_path.to_string()));
    // ... start hub with mock app handle ...

    // Connect as agent
    let stream = UnixStream::connect(socket_path).await.unwrap();
    let (reader, mut writer) = tokio::io::split(stream);

    // Send registration
    let register_msg = r#"{"senderId":"test","threadId":"thread-1","type":"register"}"#;
    writer.write_all(format!("{}\n", register_msg).as_bytes()).await.unwrap();

    // Verify agent is registered
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(hub.agents.read().await.contains_key("thread-1"));

    // Send message to agent
    hub.send_to_agent("thread-1", r#"{"type":"test"}"#).await.unwrap();

    // Verify message received
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    assert!(line.contains("test"));

    // Clean up
    std::fs::remove_file(socket_path).ok();
}
```

**2. Multiple Agents Test**
- Connect 3+ agents simultaneously
- Verify each can send/receive independently
- Verify messages route to correct agent

**3. Hierarchy Tracking Test**
- Register parent agent (no parentId)
- Register child agent (with parentId pointing to parent)
- Verify hierarchy HashMap contains correct relationships

### Manual Verification Commands

**1. Verify Socket Creation**
After starting the Tauri app:
```bash
# Check socket exists
ls -la ~/.mort/agent-hub.sock

# Expected output:
# srwxr-xr-x  1 user  staff  0 [date] /Users/[user]/.mort/agent-hub.sock
```

**2. Test Socket Connection with netcat/socat**
```bash
# Connect to socket and send a registration message
echo '{"senderId":"test-agent","threadId":"manual-test-1","type":"register"}' | socat - UNIX-CONNECT:~/.mort/agent-hub.sock

# Or interactively:
socat - UNIX-CONNECT:~/.mort/agent-hub.sock
# Then type: {"senderId":"test","threadId":"test-thread","type":"register"}
```

**3. Test with a Simple Node.js Script**
Create `test-agent-connection.js`:
```javascript
const net = require('net');
const path = require('path');
const os = require('os');

const socketPath = path.join(os.homedir(), '.mort', 'agent-hub.sock');

const client = net.createConnection(socketPath, () => {
    console.log('Connected to AgentHub');

    // Send registration
    const registerMsg = JSON.stringify({
        senderId: 'test-node-agent',
        threadId: 'node-test-thread-1',
        type: 'register'
    });
    client.write(registerMsg + '\n');
    console.log('Sent registration:', registerMsg);
});

client.on('data', (data) => {
    console.log('Received from hub:', data.toString());
});

client.on('error', (err) => {
    console.error('Connection error:', err.message);
});

client.on('close', () => {
    console.log('Connection closed');
});

// Keep alive for 10 seconds to receive messages
setTimeout(() => {
    client.end();
}, 10000);
```

Run with: `node test-agent-connection.js`

**4. Verify Stale Socket Cleanup**
```bash
# Create a fake stale socket
touch ~/.mort/agent-hub.sock

# Start the Tauri app
# The app should remove the stale file and create a real socket

# Verify it's now a real socket (not a regular file)
file ~/.mort/agent-hub.sock
# Expected: /Users/[user]/.mort/agent-hub.sock: socket
```

**5. Verify Socket Cleanup on Exit**
```bash
# With app running, verify socket exists
ls ~/.mort/agent-hub.sock

# Close the app (Cmd+Q or equivalent)

# Verify socket is removed
ls ~/.mort/agent-hub.sock
# Expected: ls: /Users/[user]/.mort/agent-hub.sock: No such file or directory
```

### Expected Outputs/Behaviors

| Test | Expected Outcome |
|------|------------------|
| Socket file creation | `~/.mort/agent-hub.sock` exists as socket type (not regular file) |
| Agent registration | Agent appears in internal HashMap, no errors logged |
| Message from agent | Tauri emits `agent:message` event with correct payload |
| `send_to_agent` command | Message arrives at correct agent's socket connection |
| Send to unknown agent | Returns error: "Agent not connected: [threadId]" |
| Agent disconnect | Agent removed from HashMap, no memory leak |
| Stale socket on startup | Old file deleted, new socket created successfully |
| App exit | Socket file deleted, no orphan processes |
| Multiple instance detection | Second instance fails with "Another Mort instance is already running" |
| Malformed JSON | Logged but doesn't crash server, connection remains open |
