//! SQLite drain tracing layer.
//!
//! Captures events with `target == "drain"` from the tracing subscriber
//! and sends them to a background worker for batched SQLite insertion.
//! Same architecture as `LogServerLayer` — mpsc channel + background thread.

use std::sync::mpsc;
use tracing_subscriber::Layer;

/// Intermediate struct decomposed from tracing fields, sent over the channel.
pub struct DrainRow {
    pub event_id: String,
    pub event: String,
    pub ts: i64,
    pub thread_id: String,
    pub properties: Vec<(String, PropertyValue)>,
}

/// Property value types matching the SQLite EAV schema columns.
pub enum PropertyValue {
    String(String),
    Number(f64),
    Bool(bool),
}

/// Tracing layer that filters on `target == "drain"` and forwards
/// decomposed rows to the SQLite background worker via mpsc channel.
pub struct SQLiteLayer {
    sender: mpsc::Sender<DrainRow>,
}

impl SQLiteLayer {
    /// Creates a new SQLiteLayer and spawns the background worker thread.
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel::<DrainRow>();

        std::thread::Builder::new()
            .name("drain-sqlite-worker".into())
            .spawn(move || {
                super::sqlite_worker::batch_worker(receiver);
            })
            .expect("Failed to spawn drain SQLite worker thread");

        Self { sender }
    }
}

/// Visitor that extracts structured drain fields from a tracing event.
///
/// Expects three fields:
/// - `thread_id`: the agent thread ID
/// - `event`: the drain event name (e.g. "tool:started")
/// - `properties`: JSON string of key-value pairs
struct DrainFieldVisitor {
    thread_id: Option<String>,
    event: Option<String>,
    properties_json: Option<String>,
}

impl DrainFieldVisitor {
    fn new() -> Self {
        Self {
            thread_id: None,
            event: None,
            properties_json: None,
        }
    }
}

impl tracing::field::Visit for DrainFieldVisitor {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        match field.name() {
            "thread_id" => self.thread_id = Some(value.to_string()),
            "event" => self.event = Some(value.to_string()),
            "properties" => self.properties_json = Some(value.to_string()),
            _ => {}
        }
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        // Fields may arrive via Display (%field) which routes through record_debug
        let s = format!("{:?}", value);
        let cleaned = if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
            s[1..s.len() - 1].to_string()
        } else {
            s
        };
        match field.name() {
            "thread_id" => self.thread_id = Some(cleaned),
            "event" => self.event = Some(cleaned),
            "properties" => self.properties_json = Some(cleaned),
            _ => {}
        }
    }
}

/// Parses a JSON string of properties into a Vec of (key, PropertyValue) pairs.
fn parse_properties(json_str: &str) -> Vec<(String, PropertyValue)> {
    let parsed: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let obj = match parsed.as_object() {
        Some(o) => o,
        None => return Vec::new(),
    };

    let mut props = Vec::with_capacity(obj.len());
    for (key, val) in obj {
        let pv = match val {
            serde_json::Value::String(s) => PropertyValue::String(s.clone()),
            serde_json::Value::Number(n) => {
                PropertyValue::Number(n.as_f64().unwrap_or(0.0))
            }
            serde_json::Value::Bool(b) => PropertyValue::Bool(*b),
            // Skip null and nested objects/arrays
            _ => continue,
        };
        props.push((key.clone(), pv));
    }
    props
}

impl<S> Layer<S> for SQLiteLayer
where
    S: tracing::Subscriber,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        // Only capture events with target "drain"
        if event.metadata().target() != "drain" {
            return;
        }

        let mut visitor = DrainFieldVisitor::new();
        event.record(&mut visitor);

        // Both event name and thread_id are required
        let (event_name, thread_id) = match (visitor.event, visitor.thread_id) {
            (Some(e), Some(t)) => (e, t),
            _ => return,
        };

        let properties = visitor
            .properties_json
            .as_deref()
            .map(parse_properties)
            .unwrap_or_default();

        let row = DrainRow {
            event_id: uuid::Uuid::new_v4().to_string(),
            event: event_name,
            ts: chrono::Utc::now().timestamp_millis(),
            thread_id,
            properties,
        };

        // Non-blocking send — drop if channel disconnected (same as LogServerLayer)
        let _ = self.sender.send(row);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_properties_string() {
        let json = r#"{"toolName":"Bash","toolUseId":"abc-123"}"#;
        let props = parse_properties(json);
        assert_eq!(props.len(), 2);
        assert!(props.iter().any(|(k, v)| k == "toolName"
            && matches!(v, PropertyValue::String(s) if s == "Bash")));
    }

    #[test]
    fn test_parse_properties_number() {
        let json = r#"{"durationMs":1234.5}"#;
        let props = parse_properties(json);
        assert_eq!(props.len(), 1);
        assert!(props.iter().any(|(k, v)| k == "durationMs"
            && matches!(v, PropertyValue::Number(n) if (*n - 1234.5).abs() < f64::EPSILON)));
    }

    #[test]
    fn test_parse_properties_bool() {
        let json = r#"{"resultTruncated":true}"#;
        let props = parse_properties(json);
        assert_eq!(props.len(), 1);
        assert!(props.iter().any(|(k, v)| k == "resultTruncated"
            && matches!(v, PropertyValue::Bool(true))));
    }

    #[test]
    fn test_parse_properties_invalid_json() {
        let props = parse_properties("not json");
        assert!(props.is_empty());
    }

    #[test]
    fn test_parse_properties_skips_null() {
        let json = r#"{"key":"val","nullKey":null}"#;
        let props = parse_properties(json);
        assert_eq!(props.len(), 1);
    }

    #[test]
    fn test_parse_properties_mixed() {
        let json = r#"{"name":"Bash","count":42,"flag":false}"#;
        let props = parse_properties(json);
        assert_eq!(props.len(), 3);
    }
}
