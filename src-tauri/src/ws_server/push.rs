//! WS push event broadcasting for server-initiated messages.
//!
//! Maintains a list of connected WS clients and broadcasts events
//! like terminal output, terminal exit, and file watcher changes.
//! Format: `{"event": "terminal:output", "payload": {...}}`

use axum::extract::ws::Message;
use serde::Serialize;
use tokio::sync::broadcast;

/// Channel capacity for push events. Events are dropped if clients fall behind.
const PUSH_CHANNEL_CAPACITY: usize = 1024;

/// A push event sent to all connected WS clients.
#[derive(Debug, Clone, Serialize)]
pub struct PushEvent {
    pub event: String,
    pub payload: serde_json::Value,
}

/// Broadcaster for server-initiated events to all connected WS clients.
///
/// Uses a tokio broadcast channel so multiple WS connection handlers can
/// each receive a copy of every event. Slow clients that fall behind
/// will have events dropped (lagged).
#[derive(Clone)]
pub struct EventBroadcaster {
    sender: broadcast::Sender<PushEvent>,
}

impl EventBroadcaster {
    /// Create a new broadcaster.
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(PUSH_CHANNEL_CAPACITY);
        Self { sender }
    }

    /// Subscribe to push events. Each WS connection calls this once.
    pub fn subscribe(&self) -> broadcast::Receiver<PushEvent> {
        self.sender.subscribe()
    }

    /// Broadcast an event to all connected clients.
    /// Returns the number of receivers that will get the message.
    /// Silently ignores errors (no receivers connected).
    pub fn broadcast(&self, event: &str, payload: serde_json::Value) -> usize {
        let push_event = PushEvent {
            event: event.to_string(),
            payload,
        };
        self.sender.send(push_event).unwrap_or(0)
    }
}

impl Default for EventBroadcaster {
    fn default() -> Self {
        Self::new()
    }
}

/// Serialize a PushEvent into a WS text message.
pub fn to_ws_message(event: &PushEvent) -> Option<Message> {
    serde_json::to_string(event)
        .ok()
        .map(|json| Message::Text(json.into()))
}
