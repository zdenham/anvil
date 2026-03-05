//! WebSocket server + HTTP file serving on `127.0.0.1:9600`.
//!
//! Provides a secondary transport layer alongside Tauri IPC so the frontend
//! can run in any browser (Chrome, Playwright) while talking to the real
//! Rust backend. Uses axum for both WebSocket and HTTP on the same port.

mod dispatch;
mod dispatch_agent;
mod dispatch_fs;
mod dispatch_git;
mod dispatch_helpers;
mod dispatch_misc;
mod dispatch_worktree;
mod files;
pub mod push;
mod types;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use crate::agent_hub::{AgentHub, DiagnosticConfigState};
use crate::file_watcher::FileWatcherState;
use crate::mort_commands::LockManager;
use crate::terminal::TerminalState;

use types::WsRequest;

/// Create a new agent PID map (re-exported for `lib.rs`).
pub fn dispatch_agent_pid_map() -> dispatch_agent::AgentPidMap {
    dispatch_agent::new_pid_map()
}

const BIND_ADDR: &str = "127.0.0.1:9600";

/// Shared state passed to all WS and HTTP handlers.
pub struct WsState {
    pub lock_manager: Arc<LockManager>,
    pub terminal_state: TerminalState,
    pub agent_hub: Arc<AgentHub>,
    pub file_watcher_state: FileWatcherState,
    pub diagnostic_config: DiagnosticConfigState,
    pub broadcaster: push::EventBroadcaster,
    pub agent_pids: dispatch_agent::AgentPidMap,
}

/// Start the WebSocket + HTTP server on the configured port.
///
/// This function runs forever (accepts connections in a loop).
/// Spawn it as a tokio task — do not await it on the main thread.
pub async fn start(state: Arc<WsState>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/ws", get(ws_upgrade_handler))
        .route("/files", get(files::serve_file))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(BIND_ADDR).await?;
    tracing::info!("WS server listening on ws://{}", BIND_ADDR);
    tracing::info!("File server listening on http://{}/files", BIND_ADDR);

    axum::serve(listener, app).await?;
    Ok(())
}

/// Axum handler that upgrades an HTTP request to a WebSocket connection.
async fn ws_upgrade_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<WsState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_connection(socket, state))
}

/// Handle a single WebSocket connection.
///
/// Splits the socket into send/receive halves. The receive half processes
/// request/response commands. A separate task forwards broadcast push events
/// to the send half.
async fn handle_connection(socket: WebSocket, state: Arc<WsState>) {
    tracing::debug!("New WebSocket connection established");

    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(tokio::sync::Mutex::new(sender));

    // Spawn push event forwarder task
    let push_sender = sender.clone();
    let mut push_rx = state.broadcaster.subscribe();
    let push_task = tokio::spawn(async move {
        forward_push_events(&mut push_rx, push_sender).await;
    });

    // Process request/response messages
    process_requests(&mut receiver, &sender, &state).await;

    // Connection closed — abort the push forwarder
    push_task.abort();
    tracing::debug!("WebSocket connection closed");
}

/// Forward broadcast push events to a single WS client.
async fn forward_push_events(
    rx: &mut tokio::sync::broadcast::Receiver<push::PushEvent>,
    sender: Arc<tokio::sync::Mutex<SplitSink<WebSocket, Message>>>,
) {
    loop {
        match rx.recv().await {
            Ok(event) => {
                if let Some(msg) = push::to_ws_message(&event) {
                    let mut guard = sender.lock().await;
                    if guard.send(msg).await.is_err() {
                        break; // Client disconnected
                    }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!(dropped = n, "WS push client lagged, dropped events");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

/// Process incoming request/response WS messages.
async fn process_requests(
    receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    sender: &Arc<tokio::sync::Mutex<SplitSink<WebSocket, Message>>>,
    state: &Arc<WsState>,
) {
    while let Some(msg) = receiver.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                tracing::debug!(error = %e, "WebSocket receive error, closing");
                break;
            }
        };

        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => continue,
            _ => continue,
        };

        // Check for relay messages (cross-window broadcast via WS)
        if let Ok(raw) = serde_json::from_str::<serde_json::Value>(&text) {
            if raw.get("relay").and_then(|v| v.as_bool()) == Some(true) {
                if let (Some(event), Some(payload)) = (
                    raw.get("event").and_then(|v| v.as_str()),
                    raw.get("payload"),
                ) {
                    state.broadcaster.broadcast(event, payload.clone());
                }
                continue;
            }
        }

        let request: WsRequest = match serde_json::from_str(&text) {
            Ok(r) => r,
            Err(e) => {
                let err = types::WsResponse::err(0, format!("invalid request JSON: {}", e));
                let json = serde_json::to_string(&err).unwrap_or_default();
                let mut guard = sender.lock().await;
                let _ = guard.send(Message::Text(json.into())).await;
                continue;
            }
        };

        let id = request.id;
        let response = dispatch::dispatch(id, &request.cmd, request.args, state).await;

        let json = match serde_json::to_string(&response) {
            Ok(j) => j,
            Err(e) => {
                tracing::error!(error = %e, cmd = %request.cmd, "Failed to serialize WS response");
                let fallback = types::WsResponse::err(id, "internal serialization error".into());
                serde_json::to_string(&fallback).unwrap_or_default()
            }
        };

        let mut guard = sender.lock().await;
        if guard.send(Message::Text(json.into())).await.is_err() {
            tracing::debug!("Failed to send WS response, closing connection");
            break;
        }
    }
}
