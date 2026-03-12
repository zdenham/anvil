//! AgentHub - Central Unix socket server for agent communication.
//!
//! The AgentHub is a Unix socket server owned by Tauri that:
//! - Creates socket at `~/.mort/agent-hub.sock` on app startup
//! - Accepts connections from all agents (root + bash-based sub-agents)
//! - Routes messages between agents and the frontend via Tauri events
//! - Injects pipeline stamps (`hub:received`, `hub:emitted`) for diagnostics
//! - Tracks per-agent sequence numbers to detect gaps
//! - Cleans up on app exit

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::ws_server::{AgentProcess, AgentProcessMap};
use crate::ws_server::push::EventBroadcaster;

/// Message structure for socket communication between agents and the hub.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[cfg(test)]
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

/// Diagnostic logging configuration -- mirrors TypeScript DiagnosticLoggingConfig.
///
/// Each module can be independently toggled. Parsed from MORT_DIAGNOSTIC_LOGGING
/// env var (JSON string). Status transitions, gap summaries, and errors always
/// log regardless of these toggles.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticLoggingConfig {
    /// Per-message pipeline stage stamps at every hop
    #[serde(default)]
    pub pipeline: bool,
    /// Heartbeat timing details: jitter, latency
    #[serde(default)]
    pub heartbeat: bool,
    /// Detailed sequence gap context
    #[serde(default)]
    pub sequence_gaps: bool,
    /// Write failures, backpressure stats, connection state
    #[serde(default)]
    pub socket_health: bool,
}

impl DiagnosticLoggingConfig {
    /// Parse config from MORT_DIAGNOSTIC_LOGGING env var, falling back to defaults.
    fn from_env() -> Self {
        std::env::var("MORT_DIAGNOSTIC_LOGGING")
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
}

/// Shared diagnostic config state, updatable at runtime from the frontend.
pub type DiagnosticConfigState = Arc<Mutex<DiagnosticLoggingConfig>>;

/// Channel sender type for sending messages to a connected agent.
type AgentWriter = mpsc::Sender<String>;

/// Returns current time as milliseconds since Unix epoch.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Extracts the seq number from the first pipeline stamp in the array.
/// Returns None if the pipeline array is missing, empty, or the first
/// stamp has no numeric `seq` field.
fn extract_seq(msg: &serde_json::Value) -> Option<u64> {
    msg.get("pipeline")?
        .as_array()?
        .first()?
        .get("seq")?
        .as_u64()
}

/// Appends a pipeline stamp to the message's pipeline array.
/// Creates the array if it doesn't exist.
fn append_pipeline_stamp(msg: &mut serde_json::Value, stage: &str, seq: Option<u64>) {
    let stamp = serde_json::json!({
        "stage": stage,
        "seq": seq.unwrap_or(0),
        "ts": now_ms(),
    });

    if let Some(pipeline) = msg.get_mut("pipeline") {
        if let Some(arr) = pipeline.as_array_mut() {
            arr.push(stamp);
        }
    } else if let Some(obj) = msg.as_object_mut() {
        obj.insert("pipeline".to_string(), serde_json::json!([stamp]));
    }
}

/// Central hub for managing agent connections and message routing.
pub struct AgentHub {
    socket_path: String,
    agents: Arc<RwLock<HashMap<String, AgentWriter>>>,
    /// Track parent-child relationships for hierarchy (threadId -> parentId)
    hierarchy: Arc<RwLock<HashMap<String, Option<String>>>>,
    /// Flag to signal shutdown to the listener thread
    shutdown: Arc<RwLock<bool>>,
    /// Diagnostic logging config, shared with connection handlers
    diagnostic_config: DiagnosticConfigState,
    /// Optional WS broadcaster for dual-emit to browser clients
    ws_broadcaster: Arc<RwLock<Option<EventBroadcaster>>>,
    /// Shared agent process map for PID-based cancellation
    agent_processes: AgentProcessMap,
}

impl AgentHub {
    /// Creates a new AgentHub with the specified socket path.
    pub fn new(socket_path: String, agent_processes: AgentProcessMap) -> Self {
        let config = DiagnosticLoggingConfig::from_env();
        tracing::info!(
            pipeline = config.pipeline,
            heartbeat = config.heartbeat,
            sequence_gaps = config.sequence_gaps,
            socket_health = config.socket_health,
            "AgentHub diagnostic config initialized"
        );

        Self {
            socket_path,
            agents: Arc::new(RwLock::new(HashMap::new())),
            hierarchy: Arc::new(RwLock::new(HashMap::new())),
            shutdown: Arc::new(RwLock::new(false)),
            diagnostic_config: Arc::new(Mutex::new(config)),
            ws_broadcaster: Arc::new(RwLock::new(None)),
            agent_processes,
        }
    }

    /// Returns a clone of the diagnostic config state for Tauri managed state.
    pub fn diagnostic_config(&self) -> DiagnosticConfigState {
        self.diagnostic_config.clone()
    }

    /// Injects the WS EventBroadcaster for dual-emit to browser clients.
    pub fn set_ws_broadcaster(&self, broadcaster: EventBroadcaster) {
        if let Ok(mut guard) = self.ws_broadcaster.write() {
            *guard = Some(broadcaster);
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
    pub fn start(&self) -> Result<(), String> {
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
        let diagnostic_config = self.diagnostic_config.clone();
        let ws_broadcaster = self.ws_broadcaster.clone();
        let agent_processes = self.agent_processes.clone();

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
                        let diag_config = diagnostic_config.clone();
                        let ws_bc = ws_broadcaster.clone();
                        let agent_procs = agent_processes.clone();

                        // Spawn handler thread for this connection
                        thread::spawn(move || {
                            Self::handle_connection(
                                stream,
                                agents,
                                hierarchy,
                                diag_config,
                                ws_bc,
                                agent_procs,
                            );
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
    /// 3. Injects pipeline stamps (hub:received, hub:emitted)
    /// 4. Tracks sequence numbers and detects gaps
    /// 5. Forwards messages to the Tauri frontend via events
    /// 6. Cleans up when the connection closes
    fn handle_connection(
        stream: UnixStream,
        agents: Arc<RwLock<HashMap<String, AgentWriter>>>,
        hierarchy: Arc<RwLock<HashMap<String, Option<String>>>>,
        diagnostic_config: DiagnosticConfigState,
        ws_broadcaster: Arc<RwLock<Option<EventBroadcaster>>>,
        agent_processes: AgentProcessMap,
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
        let mut last_seq: Option<u64> = None;

        for line in reader.lines() {
            match line {
                Ok(line) if line.is_empty() => continue,
                Ok(line) => {
                    // Parse as raw Value for pipeline stamp injection
                    let mut raw_msg: serde_json::Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(e) => {
                            tracing::warn!(
                                error = %e,
                                line_preview = %line.chars().take(100).collect::<String>(),
                                "Failed to parse message from agent"
                            );
                            continue;
                        }
                    };

                    // Extract routing fields from the raw JSON
                    let msg_type = raw_msg
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let msg_thread_id = raw_msg
                        .get("threadId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let msg_sender_id = raw_msg
                        .get("senderId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let msg_parent_id = raw_msg
                        .get("parentId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    // Extract seq from the first pipeline stamp (agent:sent)
                    let seq = extract_seq(&raw_msg);

                    // Inject hub:received stamp
                    append_pipeline_stamp(&mut raw_msg, "hub:received", seq);

                    // Sequence gap detection (always-on)
                    if let Some(current_seq) = seq {
                        if let Some(prev) = last_seq {
                            let expected = prev + 1;
                            if current_seq != expected {
                                tracing::warn!(
                                    agent_id = %msg_sender_id,
                                    expected = expected,
                                    got = current_seq,
                                    "SEQ GAP"
                                );
                            }
                        }
                        last_seq = Some(current_seq);
                    }

                    // Opt-in per-message diagnostic logging
                    let diag_pipeline = diagnostic_config
                        .lock()
                        .map(|c| c.pipeline)
                        .unwrap_or(false);
                    if diag_pipeline {
                        tracing::debug!(
                            agent_id = %msg_sender_id,
                            msg_type = %msg_type,
                            seq = ?seq,
                            stage = "hub:received",
                            "Pipeline diagnostic: message received"
                        );
                    }

                    // Handle registration
                    if msg_type == "register" {
                        thread_id = Some(msg_thread_id.clone());

                        // Store the agent's writer channel
                        if let Ok(mut agents_guard) = agents.write() {
                            agents_guard.insert(msg_thread_id.clone(), tx.clone());
                            tracing::info!(
                                thread_id = %msg_thread_id,
                                parent_id = ?msg_parent_id,
                                "Agent registered"
                            );
                        }

                        // Store hierarchy relationship
                        if let Ok(mut hierarchy_guard) = hierarchy.write() {
                            hierarchy_guard.insert(msg_thread_id.clone(), msg_parent_id);
                        }

                        // Register PID in AgentProcessMap for cancellation support.
                        // Agents spawned via dispatch_agent already have entries; this
                        // covers child agents spawned by ChildSpawner that aren't in the map.
                        if let Some(pid) = raw_msg.get("pid").and_then(|v| v.as_u64()) {
                            let mut map = agent_processes.blocking_lock();
                            if !map.contains_key(&msg_thread_id) {
                                map.insert(msg_thread_id.clone(), AgentProcess {
                                    pid: pid as u32,
                                    exited: Arc::new(tokio::sync::Notify::new()),
                                });
                                tracing::info!(
                                    thread_id = %msg_thread_id,
                                    pid = pid,
                                    "Agent PID registered via hub"
                                );
                            }
                        }

                        continue;
                    }

                    // Handle relay messages - forward payload to target agent
                    if msg_type == "relay" {
                        if let Some(target_id) =
                            raw_msg.get("targetThreadId").and_then(|v| v.as_str())
                        {
                            if let Some(payload) = raw_msg.get("payload") {
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
                                                sender = %msg_thread_id,
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

                    // Handle drain messages -- bridge to tracing for SQLite layer
                    if msg_type == "drain" {
                        if let (Some(event), Some(props)) = (
                            raw_msg.get("event").and_then(|v| v.as_str()),
                            raw_msg.get("properties").cloned(),
                        ) {
                            // Inject threadId into properties so it's stored as a regular property
                            let mut props_with_thread = props;
                            if let Some(obj) = props_with_thread.as_object_mut() {
                                obj.insert("threadId".to_string(), serde_json::Value::String(msg_thread_id.clone()));
                            }
                            let props_str = props_with_thread.to_string();
                            tracing::info!(
                                target: "drain",
                                event = %event,
                                properties = %props_str,
                            );
                        }

                        // Forward to WS clients
                        if let Ok(guard) = ws_broadcaster.read() {
                            if let Some(ref broadcaster) = *guard {
                                broadcaster.broadcast("agent:message", raw_msg.clone());
                            }
                        }
                        continue;
                    }

                    // Inject hub:emitted stamp
                    append_pipeline_stamp(&mut raw_msg, "hub:emitted", seq);

                    if diag_pipeline {
                        tracing::debug!(
                            agent_id = %msg_sender_id,
                            msg_type = %msg_type,
                            seq = ?seq,
                            stage = "hub:emitted",
                            "Pipeline diagnostic: message emitted"
                        );
                    }

                    // Forward to WS clients (sole transport)
                    if let Ok(guard) = ws_broadcaster.read() {
                        if let Some(ref broadcaster) = *guard {
                            broadcaster.broadcast("agent:message", raw_msg.clone());
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
            // Notify cancel waiters and remove from process map
            let mut map = agent_processes.blocking_lock();
            if let Some(entry) = map.remove(&id) {
                entry.exited.notify_waiters();
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

/// Updates the diagnostic logging config at runtime (standalone, callable from WS server).
pub fn update_diagnostic_config_inner(
    config: DiagnosticLoggingConfig,
    state: &DiagnosticConfigState,
) {
    tracing::info!(
        pipeline = config.pipeline,
        heartbeat = config.heartbeat,
        sequence_gaps = config.sequence_gaps,
        socket_health = config.socket_health,
        "Diagnostic config updated"
    );
    if let Ok(mut guard) = state.lock() {
        *guard = config;
    }
}

/// Updates the diagnostic logging config at runtime.
/// Called by the frontend to enable/disable diagnostic modules.
#[tauri::command]
pub fn update_diagnostic_config(
    config: DiagnosticLoggingConfig,
    state: tauri::State<'_, DiagnosticConfigState>,
) {
    update_diagnostic_config_inner(config, &state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_hub_new() {
        let hub = AgentHub::new("/tmp/test-hub.sock".to_string(), crate::ws_server::new_agent_process_map());
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

        let hub = AgentHub::new(socket_path.to_string(), crate::ws_server::new_agent_process_map());
        let result = hub.cleanup_stale_socket();

        assert!(result.is_ok());
        assert!(!std::path::Path::new(socket_path).exists());
    }

    #[test]
    fn test_list_connected_agents_empty() {
        let hub = AgentHub::new("/tmp/test-list-agents.sock".to_string(), crate::ws_server::new_agent_process_map());
        assert!(hub.list_connected_agents().is_empty());
    }

    #[test]
    fn test_send_to_nonexistent_agent() {
        let hub = AgentHub::new("/tmp/test-send-nonexistent.sock".to_string(), crate::ws_server::new_agent_process_map());
        let result = hub.send_to_agent("nonexistent-thread", "test message");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Agent not connected: nonexistent-thread"));
    }

    #[test]
    fn test_diagnostic_config_default() {
        let config = DiagnosticLoggingConfig::default();
        assert!(!config.pipeline);
        assert!(!config.heartbeat);
        assert!(!config.sequence_gaps);
        assert!(!config.socket_health);
    }

    #[test]
    fn test_diagnostic_config_deserialization() {
        let json =
            r#"{"pipeline":true,"heartbeat":false,"sequenceGaps":true,"socketHealth":false}"#;
        let config: DiagnosticLoggingConfig = serde_json::from_str(json).unwrap();
        assert!(config.pipeline);
        assert!(!config.heartbeat);
        assert!(config.sequence_gaps);
        assert!(!config.socket_health);
    }

    #[test]
    fn test_diagnostic_config_partial_deserialization() {
        // Missing fields should default to false
        let json = r#"{"pipeline":true}"#;
        let config: DiagnosticLoggingConfig = serde_json::from_str(json).unwrap();
        assert!(config.pipeline);
        assert!(!config.heartbeat);
        assert!(!config.sequence_gaps);
        assert!(!config.socket_health);
    }

    #[test]
    fn test_now_ms() {
        let ts = now_ms();
        // Should be a reasonable timestamp (after 2024-01-01)
        assert!(ts > 1_704_067_200_000);
    }

    #[test]
    fn test_extract_seq_with_pipeline() {
        let msg = serde_json::json!({
            "type": "output",
            "pipeline": [{"stage": "agent:sent", "seq": 42, "ts": 1234567890}]
        });
        assert_eq!(extract_seq(&msg), Some(42));
    }

    #[test]
    fn test_extract_seq_no_pipeline() {
        let msg = serde_json::json!({"type": "output"});
        assert_eq!(extract_seq(&msg), None);
    }

    #[test]
    fn test_extract_seq_empty_pipeline() {
        let msg = serde_json::json!({"type": "output", "pipeline": []});
        assert_eq!(extract_seq(&msg), None);
    }

    #[test]
    fn test_append_pipeline_stamp_existing_array() {
        let mut msg = serde_json::json!({
            "type": "output",
            "pipeline": [{"stage": "agent:sent", "seq": 5, "ts": 1000}]
        });
        append_pipeline_stamp(&mut msg, "hub:received", Some(5));

        let pipeline = msg["pipeline"].as_array().unwrap();
        assert_eq!(pipeline.len(), 2);
        assert_eq!(pipeline[1]["stage"], "hub:received");
        assert_eq!(pipeline[1]["seq"], 5);
        assert!(pipeline[1]["ts"].as_u64().unwrap() > 0);
    }

    #[test]
    fn test_append_pipeline_stamp_no_array() {
        let mut msg = serde_json::json!({"type": "register"});
        append_pipeline_stamp(&mut msg, "hub:received", None);

        let pipeline = msg["pipeline"].as_array().unwrap();
        assert_eq!(pipeline.len(), 1);
        assert_eq!(pipeline[0]["stage"], "hub:received");
        assert_eq!(pipeline[0]["seq"], 0);
    }
}
