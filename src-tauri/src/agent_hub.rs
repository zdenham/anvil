//! AgentHub - Central Unix socket server for agent communication.
//!
//! The AgentHub is a Unix socket server owned by Tauri that:
//! - Creates socket at `~/.mort/agent-hub.sock` on app startup
//! - Accepts connections from all agents (root + bash-based sub-agents)
//! - Routes messages between agents and the frontend via Tauri events
//! - Cleans up on app exit

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::{mpsc, Arc, RwLock};
use std::thread;
use tauri::{AppHandle, Emitter};

/// Message structure for socket communication between agents and the hub.
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

/// Channel sender type for sending messages to a connected agent.
type AgentWriter = mpsc::Sender<String>;

/// Central hub for managing agent connections and message routing.
pub struct AgentHub {
    socket_path: String,
    agents: Arc<RwLock<HashMap<String, AgentWriter>>>,
    /// Track parent-child relationships for hierarchy (threadId -> parentId)
    hierarchy: Arc<RwLock<HashMap<String, Option<String>>>>,
    /// Flag to signal shutdown to the listener thread
    shutdown: Arc<RwLock<bool>>,
}

impl AgentHub {
    /// Creates a new AgentHub with the specified socket path.
    pub fn new(socket_path: String) -> Self {
        Self {
            socket_path,
            agents: Arc::new(RwLock::new(HashMap::new())),
            hierarchy: Arc::new(RwLock::new(HashMap::new())),
            shutdown: Arc::new(RwLock::new(false)),
        }
    }

    /// Returns the socket path.
    pub fn socket_path(&self) -> &str {
        &self.socket_path
    }

    /// Starts the AgentHub socket server.
    ///
    /// This spawns a background thread that:
    /// 1. Cleans up any stale socket file
    /// 2. Binds to the Unix socket
    /// 3. Accepts incoming connections
    /// 4. Spawns handler threads for each connection
    pub fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        // Clean up stale socket first
        self.cleanup_stale_socket()?;

        // Ensure the parent directory exists
        if let Some(parent) = std::path::Path::new(&self.socket_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create socket directory: {}", e))?;
        }

        let listener = UnixListener::bind(&self.socket_path)
            .map_err(|e| format!("Failed to bind socket at {}: {}", self.socket_path, e))?;

        // Set non-blocking so we can check shutdown flag periodically
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Failed to set non-blocking: {}", e))?;

        tracing::info!(socket_path = %self.socket_path, "AgentHub started");

        let agents = self.agents.clone();
        let hierarchy = self.hierarchy.clone();
        let shutdown = self.shutdown.clone();

        // Spawn listener thread
        thread::spawn(move || {
            let _span = tracing::info_span!("agent_hub_accept_loop").entered();
            loop {
                // Check shutdown flag
                if let Ok(guard) = shutdown.read() {
                    if *guard {
                        tracing::info!("AgentHub listener shutting down");
                        break;
                    }
                }

                match listener.accept() {
                    Ok((stream, _addr)) => {
                        tracing::info!("New agent connection accepted");
                        let agents = agents.clone();
                        let hierarchy = hierarchy.clone();
                        let app_handle = app_handle.clone();

                        // Spawn handler thread for this connection
                        thread::spawn(move || {
                            Self::handle_connection(stream, agents, hierarchy, app_handle);
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // No connection ready, sleep briefly and try again
                        thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "Error accepting connection");
                        // Brief sleep to avoid tight loop on persistent errors
                        thread::sleep(std::time::Duration::from_millis(100));
                    }
                }
            }
        });

        Ok(())
    }

    /// Cleans up a stale socket file if it exists.
    ///
    /// This handles the case where a previous instance crashed without cleanup.
    /// It tries to connect to the socket - if successful, another instance is running.
    /// If connection fails, the socket is stale and can be removed.
    fn cleanup_stale_socket(&self) -> Result<(), String> {
        let path = std::path::Path::new(&self.socket_path);

        if path.exists() {
            // Try to connect - if it succeeds, another instance is running
            match UnixStream::connect(&self.socket_path) {
                Ok(_) => {
                    return Err("Another Mort instance is already running".to_string());
                }
                Err(_) => {
                    // Stale socket, safe to remove
                    tracing::info!(
                        socket_path = %self.socket_path,
                        "Removing stale socket file"
                    );
                    std::fs::remove_file(&self.socket_path)
                        .map_err(|e| format!("Failed to remove stale socket: {}", e))?;
                }
            }
        }
        Ok(())
    }

    /// Handles a single agent connection.
    ///
    /// This runs in its own thread and:
    /// 1. Sets up bidirectional communication channels
    /// 2. Processes incoming messages from the agent
    /// 3. Forwards messages to the Tauri frontend via events
    /// 4. Cleans up when the connection closes
    fn handle_connection(
        stream: UnixStream,
        agents: Arc<RwLock<HashMap<String, AgentWriter>>>,
        hierarchy: Arc<RwLock<HashMap<String, Option<String>>>>,
        app_handle: AppHandle,
    ) {
        // CRITICAL: Set stream to blocking mode.
        // Accepted sockets inherit non-blocking from the listener, which causes
        // the reader loop to break immediately on WouldBlock instead of waiting.
        if let Err(e) = stream.set_nonblocking(false) {
            tracing::error!(error = %e, "Failed to set stream to blocking mode");
            return;
        }

        // Clone stream for writing (reader will own the original)
        let write_stream = match stream.try_clone() {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "Failed to clone stream for writing");
                return;
            }
        };

        // Create channel for sending messages to this agent
        let (tx, rx) = mpsc::channel::<String>();

        // Spawn writer thread - receives from channel and writes to socket
        let mut writer = write_stream;
        thread::spawn(move || {
            for msg in rx {
                if let Err(e) = writeln!(writer, "{}", msg) {
                    tracing::debug!(error = %e, "Failed to write to agent socket");
                    break;
                }
                if let Err(e) = writer.flush() {
                    tracing::debug!(error = %e, "Failed to flush agent socket");
                    break;
                }
            }
            tracing::debug!("Agent writer thread exiting");
        });

        // Reader loop - reads from socket and processes messages
        let reader = BufReader::new(stream);
        let mut thread_id: Option<String> = None;

        for line in reader.lines() {
            match line {
                Ok(line) if line.is_empty() => continue,
                Ok(line) => {
                    match serde_json::from_str::<SocketMessage>(&line) {
                        Ok(msg) => {
                            // Handle registration
                            if msg.msg_type == "register" {
                                thread_id = Some(msg.thread_id.clone());

                                // Store the agent's writer channel
                                if let Ok(mut agents_guard) = agents.write() {
                                    agents_guard.insert(msg.thread_id.clone(), tx.clone());
                                    tracing::info!(
                                        thread_id = %msg.thread_id,
                                        parent_id = ?msg.parent_id,
                                        "Agent registered"
                                    );
                                }

                                // Store hierarchy relationship
                                if let Ok(mut hierarchy_guard) = hierarchy.write() {
                                    hierarchy_guard
                                        .insert(msg.thread_id.clone(), msg.parent_id.clone());
                                }

                                continue;
                            }

                            // Handle relay messages - forward payload to target agent
                            if msg.msg_type == "relay" {
                                if let Some(target_id) = msg.rest.get("targetThreadId").and_then(|v| v.as_str()) {
                                    if let Some(payload) = msg.rest.get("payload") {
                                        let payload_str = payload.to_string();
                                        if let Ok(agents_guard) = agents.read() {
                                            if let Some(target_tx) = agents_guard.get(target_id) {
                                                if let Err(e) = target_tx.send(payload_str) {
                                                    tracing::warn!(
                                                        error = %e,
                                                        target_id = %target_id,
                                                        "Failed to relay message to agent"
                                                    );
                                                } else {
                                                    tracing::debug!(
                                                        sender = %msg.thread_id,
                                                        target = %target_id,
                                                        "Relayed message between agents"
                                                    );
                                                }
                                            } else {
                                                tracing::debug!(
                                                    target_id = %target_id,
                                                    "Relay target agent not connected"
                                                );
                                            }
                                        }
                                    }
                                }
                                continue;
                            }

                            // Forward all other messages to Tauri/UI
                            if let Err(e) = app_handle.emit("agent:message", &msg) {
                                tracing::warn!(error = %e, "Failed to emit agent:message event");
                            }
                        }
                        Err(e) => {
                            tracing::warn!(
                                error = %e,
                                line_preview = %line.chars().take(100).collect::<String>(),
                                "Failed to parse message from agent"
                            );
                        }
                    }
                }
                Err(e) => {
                    tracing::debug!(error = %e, "Error reading from agent socket");
                    break;
                }
            }
        }

        // Cleanup on disconnect
        if let Some(id) = thread_id {
            if let Ok(mut agents_guard) = agents.write() {
                agents_guard.remove(&id);
                tracing::info!(thread_id = %id, "Agent disconnected and removed");
            }
            if let Ok(mut hierarchy_guard) = hierarchy.write() {
                hierarchy_guard.remove(&id);
            }
        }
    }

    /// Sends a message to a specific agent by thread ID.
    ///
    /// Returns an error if the agent is not connected.
    pub fn send_to_agent(&self, thread_id: &str, msg: &str) -> Result<(), String> {
        let agents = self.agents.read().map_err(|e| format!("Lock error: {}", e))?;

        if let Some(tx) = agents.get(thread_id) {
            tx.send(msg.to_string())
                .map_err(|e| format!("Send failed: {}", e))
        } else {
            Err(format!("Agent not connected: {}", thread_id))
        }
    }

    /// Returns a list of currently connected agent thread IDs.
    pub fn list_connected_agents(&self) -> Vec<String> {
        self.agents
            .read()
            .map(|guard| guard.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Cleans up the socket file and signals shutdown.
    pub fn cleanup(&self) {
        // Signal shutdown to listener thread
        if let Ok(mut guard) = self.shutdown.write() {
            *guard = true;
        }

        // Remove socket file
        if std::path::Path::new(&self.socket_path).exists() {
            if let Err(e) = std::fs::remove_file(&self.socket_path) {
                tracing::warn!(
                    error = %e,
                    socket_path = %self.socket_path,
                    "Failed to remove socket file during cleanup"
                );
            } else {
                tracing::info!(socket_path = %self.socket_path, "Socket file removed");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_hub_new() {
        let hub = AgentHub::new("/tmp/test-hub.sock".to_string());
        assert_eq!(hub.socket_path(), "/tmp/test-hub.sock");
    }

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

    #[test]
    fn test_cleanup_stale_socket() {
        let socket_path = "/tmp/test-stale-cleanup.sock";

        // Ensure clean state
        let _ = std::fs::remove_file(socket_path);

        // Create a fake stale socket file (regular file, not a real socket)
        std::fs::write(socket_path, "").unwrap();
        assert!(std::path::Path::new(socket_path).exists());

        let hub = AgentHub::new(socket_path.to_string());
        let result = hub.cleanup_stale_socket();

        assert!(result.is_ok());
        assert!(!std::path::Path::new(socket_path).exists());
    }

    #[test]
    fn test_list_connected_agents_empty() {
        let hub = AgentHub::new("/tmp/test-list-agents.sock".to_string());
        assert!(hub.list_connected_agents().is_empty());
    }

    #[test]
    fn test_send_to_nonexistent_agent() {
        let hub = AgentHub::new("/tmp/test-send-nonexistent.sock".to_string());
        let result = hub.send_to_agent("nonexistent-thread", "test message");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Agent not connected: nonexistent-thread"));
    }

}
