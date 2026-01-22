//! Log server tracing layer for uploading logs to a backend server.
//!
//! This layer batches log entries and uploads them via HTTP POST to a backend
//! server that forwards them to ClickHouse. This approach removes the heavy
//! clickhouse crate dependency (217 transitive deps) and keeps credentials server-side.

use super::config::LogServerConfig;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tracing_subscriber::Layer;
use uuid::Uuid;

/// Session ID generated once at app startup, shared across all log entries
static SESSION_ID: OnceLock<String> = OnceLock::new();

fn get_session_id() -> &'static str {
    SESSION_ID.get_or_init(|| Uuid::new_v4().to_string())
}

/// Log row matching the backend server schema.
/// Field names and types must match exactly for the server to process correctly.
#[derive(Debug, Clone, Serialize)]
pub struct LogRow {
    // Core fields (always present)
    #[serde(rename = "timestamp")]
    pub timestamp: i64, // DateTime64(3) as milliseconds since epoch
    pub level: String,   // TRACE, DEBUG, INFO, WARN, ERROR
    pub message: String,
    pub target: String, // Rust module path (e.g., "mort::clipboard")

    // Instance identification (always present)
    pub version: String,    // From CARGO_PKG_VERSION
    pub session_id: String, // UUID generated on app start

    // Build identification
    pub app_suffix: String, // Build suffix (e.g., "dev", "" for production)

    // Source context (optional)
    pub source: Option<String>, // Window source (main, spotlight, task-panel)

    // Domain context (optional)
    pub task_id: Option<String>,
    pub thread_id: Option<String>,
    pub repo_name: Option<String>,
    pub worktree_path: Option<String>,

    // Operation metrics (optional)
    pub duration_ms: Option<i64>,

    // Extended data (optional)
    pub data: Option<String>, // JSON blob for extra structured fields
}

/// Batch of logs to send to the server
#[derive(Debug, Serialize)]
struct LogBatch {
    logs: Vec<LogRow>,
}

/// Batch size - flush when this many logs accumulate
const BATCH_SIZE: usize = 100;

/// Flush interval - flush at least this often, even if batch not full
const FLUSH_INTERVAL: Duration = Duration::from_secs(5);

/// Retry configuration
const MAX_RETRIES: u32 = 3;
const INITIAL_RETRY_DELAY: Duration = Duration::from_millis(100);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(5);

/// Maximum logs to buffer during connection issues (prevents unbounded memory growth)
const MAX_RETRY_BUFFER: usize = 5_000;

pub struct LogServerLayer {
    sender: mpsc::Sender<LogRow>,
}

impl LogServerLayer {
    /// Creates a new LogServer layer with the given configuration.
    /// Spawns a background worker thread that handles batching and HTTP uploads.
    pub fn new(config: LogServerConfig) -> Self {
        let (sender, receiver) = mpsc::channel::<LogRow>();

        // Spawn background worker thread using std::thread (no tokio needed)
        std::thread::Builder::new()
            .name("log-server-client".into())
            .spawn(move || {
                batch_worker(receiver, config);
            })
            .expect("Failed to spawn log server client thread");

        Self { sender }
    }
}

/// Background worker that batches logs and sends them to the backend server.
/// Uses std::sync::mpsc and blocking HTTP calls via ureq.
fn batch_worker(receiver: mpsc::Receiver<LogRow>, config: LogServerConfig) {
    let mut batch: Vec<LogRow> = Vec::with_capacity(BATCH_SIZE);
    let mut retry_buffer: Vec<LogRow> = Vec::new();
    let mut consecutive_failures: u32 = 0;
    let mut last_flush = Instant::now();

    loop {
        // Calculate remaining time until next scheduled flush
        let elapsed = last_flush.elapsed();
        let timeout = if elapsed >= FLUSH_INTERVAL {
            Duration::from_millis(1) // Flush immediately
        } else {
            FLUSH_INTERVAL - elapsed
        };

        // Try to receive a log entry with timeout
        match receiver.recv_timeout(timeout) {
            Ok(row) => {
                batch.push(row);
                if batch.len() >= BATCH_SIZE {
                    flush_with_retry(
                        &config.url,
                        &mut batch,
                        &mut retry_buffer,
                        &mut consecutive_failures,
                    );
                    last_flush = Instant::now();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Timeout - check if we need to flush
                if !batch.is_empty() || !retry_buffer.is_empty() {
                    flush_with_retry(
                        &config.url,
                        &mut batch,
                        &mut retry_buffer,
                        &mut consecutive_failures,
                    );
                    last_flush = Instant::now();
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // Channel closed - flush remaining logs and exit
                if !batch.is_empty() {
                    let _ = flush_batch(&config.url, &mut batch);
                }
                break;
            }
        }
    }
}

/// Attempts to flush with exponential backoff retry.
/// On persistent failure, moves logs to retry buffer (with size limit).
fn flush_with_retry(
    url: &str,
    batch: &mut Vec<LogRow>,
    retry_buffer: &mut Vec<LogRow>,
    consecutive_failures: &mut u32,
) {
    // First, try to flush any previously failed logs
    if !retry_buffer.is_empty() {
        let mut retry_batch: Vec<LogRow> = retry_buffer.drain(..).collect();
        if flush_batch(url, &mut retry_batch).is_err() {
            // Still failing, put back what we can
            let space = MAX_RETRY_BUFFER.saturating_sub(retry_buffer.len());
            retry_buffer.extend(retry_batch.into_iter().take(space));
        } else {
            *consecutive_failures = 0;
        }
    }

    // Now flush the current batch
    if batch.is_empty() {
        return;
    }

    let mut delay = INITIAL_RETRY_DELAY;
    for attempt in 0..MAX_RETRIES {
        match flush_batch(url, batch) {
            Ok(()) => {
                *consecutive_failures = 0;
                return;
            }
            Err(e) => {
                if attempt < MAX_RETRIES - 1 {
                    // Log retry attempt (to console only, not server to avoid loops)
                    eprintln!(
                        "Log server flush attempt {} failed: {}. Retrying in {:?}...",
                        attempt + 1,
                        e,
                        delay
                    );
                    std::thread::sleep(delay);
                    delay = (delay * 2).min(MAX_RETRY_DELAY);
                }
            }
        }
    }

    // All retries exhausted - move to retry buffer or drop if buffer full
    *consecutive_failures += 1;
    let space = MAX_RETRY_BUFFER.saturating_sub(retry_buffer.len());

    if space > 0 {
        retry_buffer.extend(batch.drain(..).take(space));
        if *consecutive_failures == 1 {
            eprintln!(
                "Log server temporarily unavailable. Buffering logs (up to {} entries).",
                MAX_RETRY_BUFFER
            );
        }
    } else {
        let dropped = batch.len();
        batch.clear();
        eprintln!(
            "Log server retry buffer full. Dropped {} log entries.",
            dropped
        );
    }
}

/// Performs the actual HTTP POST to the backend server using ureq.
fn flush_batch(url: &str, batch: &mut Vec<LogRow>) -> Result<(), Box<dyn std::error::Error>> {
    if batch.is_empty() {
        return Ok(());
    }

    let payload = LogBatch {
        logs: batch.drain(..).collect(),
    };

    ureq::post(url)
        .set("Content-Type", "application/json")
        .send_json(&payload)?;

    Ok(())
}

impl<S> Layer<S> for LogServerLayer
where
    S: tracing::Subscriber,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let mut visitor = LogVisitor::default();
        event.record(&mut visitor);

        // Extract extra_fields_as_json first before consuming other fields
        let data = visitor.extra_fields_as_json();

        let row = LogRow {
            timestamp: chrono::Utc::now().timestamp_millis(),
            level: event.metadata().level().to_string(),
            message: visitor.message.unwrap_or_default(),
            target: event.metadata().target().to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            session_id: get_session_id().to_string(),
            app_suffix: crate::build_info::APP_SUFFIX.to_string(),
            source: visitor.source,
            task_id: visitor.task_id,
            thread_id: visitor.thread_id,
            repo_name: visitor.repo_name,
            worktree_path: visitor.worktree_path,
            duration_ms: visitor.duration_ms,
            data,
        };

        // Non-blocking send - if channel is full, drop the log rather than blocking
        // This ensures logging never impacts app performance
        if self.sender.send(row).is_err() {
            // Channel disconnected - worker thread has exited
            // We don't log this to avoid recursive issues.
        }
    }
}

/// Visitor that extracts known fields and collects extras into a JSON blob
#[derive(Default)]
struct LogVisitor {
    message: Option<String>,
    source: Option<String>,
    task_id: Option<String>,
    thread_id: Option<String>,
    repo_name: Option<String>,
    worktree_path: Option<String>,
    duration_ms: Option<i64>,
    extra_fields: HashMap<String, serde_json::Value>,
}

impl LogVisitor {
    /// Converts extra fields to a JSON string, or None if empty
    fn extra_fields_as_json(&self) -> Option<String> {
        if self.extra_fields.is_empty() {
            None
        } else {
            serde_json::to_string(&self.extra_fields).ok()
        }
    }

    fn record_field(&mut self, name: &str, value: serde_json::Value) {
        match name {
            "message" => {
                self.message = value.as_str().map(|s| {
                    // Remove surrounding quotes if present (from debug formatting)
                    let s = s.trim();
                    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
                        s[1..s.len() - 1].to_string()
                    } else {
                        s.to_string()
                    }
                });
            }
            "source" => self.source = value.as_str().map(String::from),
            "task_id" => self.task_id = value.as_str().map(String::from),
            "thread_id" => self.thread_id = value.as_str().map(String::from),
            "repo_name" => self.repo_name = value.as_str().map(String::from),
            "worktree_path" => self.worktree_path = value.as_str().map(String::from),
            "duration_ms" => self.duration_ms = value.as_i64(),
            _ => {
                // Collect unknown fields into extra_fields
                self.extra_fields.insert(name.to_string(), value);
            }
        }
    }
}

impl tracing::field::Visit for LogVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        let value_str = format!("{:?}", value);
        self.record_field(field.name(), serde_json::Value::String(value_str));
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.record_field(field.name(), serde_json::Value::String(value.to_string()));
    }

    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        self.record_field(field.name(), serde_json::json!(value));
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.record_field(field.name(), serde_json::json!(value));
    }

    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        self.record_field(field.name(), serde_json::json!(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_visitor_extracts_known_fields() {
        let mut visitor = LogVisitor::default();

        visitor.record_field("message", serde_json::Value::String("test message".into()));
        visitor.record_field("source", serde_json::Value::String("spotlight".into()));
        visitor.record_field("task_id", serde_json::Value::String("task-123".into()));
        visitor.record_field(
            "thread_id",
            serde_json::Value::String("thread-456".into()),
        );
        visitor.record_field("repo_name", serde_json::Value::String("my-repo".into()));
        visitor.record_field(
            "worktree_path",
            serde_json::Value::String("/path/to/worktree".into()),
        );
        visitor.record_field("duration_ms", serde_json::json!(1234));

        assert_eq!(visitor.message, Some("test message".to_string()));
        assert_eq!(visitor.source, Some("spotlight".to_string()));
        assert_eq!(visitor.task_id, Some("task-123".to_string()));
        assert_eq!(visitor.thread_id, Some("thread-456".to_string()));
        assert_eq!(visitor.repo_name, Some("my-repo".to_string()));
        assert_eq!(visitor.worktree_path, Some("/path/to/worktree".to_string()));
        assert_eq!(visitor.duration_ms, Some(1234));
        assert!(visitor.extra_fields.is_empty());
    }

    #[test]
    fn test_log_visitor_collects_extra_fields() {
        let mut visitor = LogVisitor::default();

        visitor.record_field("message", serde_json::Value::String("test".into()));
        visitor.record_field("custom_field", serde_json::Value::String("custom_value".into()));
        visitor.record_field("another_field", serde_json::json!(42));

        assert_eq!(visitor.extra_fields.len(), 2);
        assert_eq!(
            visitor.extra_fields.get("custom_field"),
            Some(&serde_json::Value::String("custom_value".into()))
        );
        assert_eq!(
            visitor.extra_fields.get("another_field"),
            Some(&serde_json::json!(42))
        );
    }

    #[test]
    fn test_extra_fields_as_json_empty() {
        let visitor = LogVisitor::default();
        assert!(visitor.extra_fields_as_json().is_none());
    }

    #[test]
    fn test_extra_fields_as_json_with_data() {
        let mut visitor = LogVisitor::default();
        visitor.record_field("custom", serde_json::Value::String("value".into()));

        let json = visitor.extra_fields_as_json();
        assert!(json.is_some());
        let parsed: serde_json::Value = serde_json::from_str(&json.unwrap()).unwrap();
        assert_eq!(parsed["custom"], "value");
    }

    #[test]
    fn test_message_strips_quotes() {
        let mut visitor = LogVisitor::default();
        visitor.record_field("message", serde_json::Value::String("\"quoted message\"".into()));
        assert_eq!(visitor.message, Some("quoted message".to_string()));
    }

    #[test]
    fn test_session_id_is_consistent() {
        let id1 = get_session_id();
        let id2 = get_session_id();
        assert_eq!(id1, id2);
    }
}
