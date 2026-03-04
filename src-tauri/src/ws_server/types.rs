//! WebSocket request/response types for the WS server protocol.
//!
//! Protocol: JSON messages with `{id, cmd, args}` request / `{id, result?, error?}` response.

use serde::{Deserialize, Serialize};

/// Incoming WebSocket command request from a client.
#[derive(Debug, Deserialize)]
pub struct WsRequest {
    pub id: u64,
    pub cmd: String,
    #[serde(default)]
    pub args: serde_json::Value,
}

/// Outgoing WebSocket response to a client.
#[derive(Debug, Serialize)]
pub struct WsResponse {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl WsResponse {
    /// Create a success response with a JSON value.
    pub fn ok(id: u64, result: serde_json::Value) -> Self {
        Self {
            id,
            result: Some(result),
            error: None,
        }
    }

    /// Create an error response with a message.
    pub fn err(id: u64, error: String) -> Self {
        Self {
            id,
            result: None,
            error: Some(error),
        }
    }
}
