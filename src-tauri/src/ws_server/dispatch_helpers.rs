//! Shared helper functions for WebSocket command dispatch.
//!
//! Provides argument extraction utilities used by all dispatch domain modules.

/// Extract a required argument from the JSON args object.
pub fn extract_arg<T: serde::de::DeserializeOwned>(
    args: &serde_json::Value,
    key: &str,
) -> Result<T, String> {
    args.get(key)
        .ok_or_else(|| format!("missing required argument: {}", key))
        .and_then(|v| {
            serde_json::from_value(v.clone())
                .map_err(|e| format!("invalid argument '{}': {}", key, e))
        })
}

/// Extract an optional argument from the JSON args object.
pub fn extract_opt_arg<T: serde::de::DeserializeOwned>(
    args: &serde_json::Value,
    key: &str,
) -> Option<T> {
    args.get(key)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}
