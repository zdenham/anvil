//! Log server tracing layer for uploading logs to a backend server.
//!
//! This layer batches log entries and uploads them via HTTP POST to a backend
//! server that forwards them to ClickHouse. This approach removes the heavy
//! clickhouse crate dependency (217 transitive deps) and keeps credentials server-side.

use super::config::LogServerConfig;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tracing_subscriber::Layer;

/// Log row matching the backend server schema.
/// Field names and types must match exactly for the server to process correctly.
#[derive(Debug, Clone, Serialize)]
pub struct LogRow {
    pub timestamp: i64,    // DateTime64(3) as milliseconds since epoch
    pub device_id: String, // Unique device identifier for tracking
    pub level: String,     // TRACE, DEBUG, INFO, WARN, ERROR
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, serde_json::Value>>,
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
const MAX_BUFFER_SIZE: usize = 5_000;

pub struct LogServerLayer {
    sender: mpsc::Sender<LogRow>,
    device_id: String,
}

impl LogServerLayer {
    /// Creates a new LogServer layer with the given configuration.
    /// Spawns a background worker thread that handles batching and HTTP uploads.
    pub fn new(config: LogServerConfig, device_id: String) -> Self {
        let (sender, receiver) = mpsc::channel::<LogRow>();

        // Spawn background worker thread using std::thread (no tokio needed)
        std::thread::Builder::new()
            .name("log-server-client".into())
            .spawn(move || {
                batch_worker(receiver, config);
            })
            .expect("Failed to spawn log server client thread");

        Self { sender, device_id }
    }
}

/// Background worker that batches logs and sends them to the backend server.
/// Uses std::sync::mpsc and blocking HTTP calls via ureq.
///
/// Single buffer design: logs accumulate in one buffer that only drains on successful flush.
/// This naturally handles retries without needing a separate retry buffer.
fn batch_worker(receiver: mpsc::Receiver<LogRow>, config: LogServerConfig) {
    let _span = tracing::info_span!("log_server_loop").entered();
    let mut buffer: Vec<LogRow> = Vec::with_capacity(MAX_BUFFER_SIZE);
    let mut last_flush = Instant::now();
    let mut flush_backoff = FLUSH_INTERVAL;

    loop {
        let elapsed = last_flush.elapsed();
        let timeout = flush_backoff.saturating_sub(elapsed);

        if timeout.is_zero() {
            tracing::error!(
                "[log_server] spin-loop avoided: elapsed={:?} backoff={:?}, resetting timer",
                elapsed, flush_backoff
            );
        }

        match receiver.recv_timeout(timeout) {
            Ok(row) => {
                // Drop oldest if at capacity
                if buffer.len() >= MAX_BUFFER_SIZE {
                    buffer.remove(0);
                }
                buffer.push(row);

                // Only attempt flush if backoff period has elapsed
                if buffer.len() >= BATCH_SIZE && last_flush.elapsed() >= flush_backoff {
                    if try_flush(&config.url, &mut buffer) {
                        flush_backoff = FLUSH_INTERVAL; // Reset on success
                    } else {
                        // Back off: double the interval, cap at 60s
                        flush_backoff = (flush_backoff * 2).min(Duration::from_secs(60));
                    }
                    last_flush = Instant::now();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !buffer.is_empty() {
                    if try_flush(&config.url, &mut buffer) {
                        flush_backoff = FLUSH_INTERVAL;
                    } else {
                        flush_backoff = (flush_backoff * 2).min(Duration::from_secs(60));
                    }
                }
                last_flush = Instant::now();
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // Final flush on shutdown
                let _ = flush_batch(&config.url, &mut buffer);
                break;
            }
        }
    }
}

/// Attempts to flush with exponential backoff retry.
/// On success, buffer is cleared and returns true. On failure, buffer is retained and returns false.
fn try_flush(url: &str, buffer: &mut Vec<LogRow>) -> bool {
    let mut delay = INITIAL_RETRY_DELAY;

    for attempt in 0..MAX_RETRIES {
        // Clone the buffer contents for the attempt
        let batch: Vec<LogRow> = buffer.clone();

        match send_batch(url, &batch) {
            Ok(()) => {
                buffer.clear(); // Only clear on success
                return true;
            }
            Err(e) => {
                if attempt < MAX_RETRIES - 1 {
                    tracing::error!(
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

    // All retries failed - buffer is retained for next attempt
    tracing::info!(
        "Log server temporarily unavailable. {} logs buffered.",
        buffer.len()
    );
    false
}

/// Sends a batch of logs to the server (non-destructive, takes reference).
fn send_batch(url: &str, batch: &[LogRow]) -> Result<(), Box<dyn std::error::Error>> {
    if batch.is_empty() {
        return Ok(());
    }

    let payload = LogBatch {
        logs: batch.to_vec(),
    };

    ureq::post(url)
        .set("Content-Type", "application/json")
        .send_json(&payload)?;

    Ok(())
}

/// Performs the actual HTTP POST to the backend server using ureq (drains buffer on success).
fn flush_batch(url: &str, buffer: &mut Vec<LogRow>) -> Result<(), Box<dyn std::error::Error>> {
    if buffer.is_empty() {
        return Ok(());
    }

    let payload = LogBatch {
        logs: buffer.clone(),
    };

    ureq::post(url)
        .set("Content-Type", "application/json")
        .send_json(&payload)?;

    buffer.clear();
    Ok(())
}

/// Modules/targets to exclude from log uploads (HTTP client internals used for uploading logs)
/// These are checked against both module_path() and target() since logs from the `log` crate
/// compatibility layer may have the crate name in target rather than module_path.
const EXCLUDED_TARGETS: &[&str] = &["ureq", "rustls", "log", "h2"];

/// Message patterns to exclude from uploads (HTTP client internals that come through log crate)
/// These are checked as prefixes against the log message content.
const EXCLUDED_MESSAGE_PREFIXES: &[&str] = &[
    // TLS/HTTP client noise (ureq, rustls)
    "connecting to mort-server",
    "Resuming session",
    "Sending ClientHello",
    "We got ServerHello",
    "Using ciphersuite",
    "Not resuming",
    "Resuming using PSK",
    "EarlyData rejected",
    "Dropping CCS",
    "TLS1.3 encrypted extensions",
    "ALPN protocol is",
    "Server cert is",
    "created stream:",
    "sending request POST",
    "writing prelude:",
    "Chunked body in response",
    "response 200 to POST",
    "dropping stream:",
];

/// Message substrings to exclude (checked via contains() for patterns that appear mid-message)
const EXCLUDED_MESSAGE_SUBSTRINGS: &[&str] = &[
    // Frontend timing logs - very noisy during development
    ":TIMING]",
    // Persistence debug logs
    "[persistence.ensureDir]",
    "[persistence.writeJson]",
    "[persistence.exists]",
];

impl<S> Layer<S> for LogServerLayer
where
    S: tracing::Subscriber,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        // Skip logs from HTTP client libraries to avoid meta-logging
        // Check both module_path and target since log-crate compatibility uses target
        let target = event.metadata().target();
        for excluded in EXCLUDED_TARGETS {
            if target.starts_with(excluded) {
                return;
            }
        }
        if let Some(module) = event.metadata().module_path() {
            for excluded in EXCLUDED_TARGETS {
                if module.starts_with(excluded) {
                    return;
                }
            }
        }

        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);

        let message = visitor.message;

        // Skip logs with noisy message content (e.g., TLS handshake details from log crate)
        for prefix in EXCLUDED_MESSAGE_PREFIXES {
            if message.starts_with(prefix) {
                return;
            }
        }
        for substring in EXCLUDED_MESSAGE_SUBSTRINGS {
            if message.contains(substring) {
                return;
            }
        }

        let properties = if visitor.properties.is_empty() {
            None
        } else {
            Some(visitor.properties)
        };

        let row = LogRow {
            timestamp: chrono::Utc::now().timestamp_millis(),
            device_id: self.device_id.clone(),
            level: event.metadata().level().to_string(),
            message,
            properties,
        };

        // Non-blocking send - if channel is full, drop the log rather than blocking
        // This ensures logging never impacts app performance
        if self.sender.send(row).is_err() {
            // Channel disconnected - worker thread has exited
            // We don't log this to avoid recursive issues.
        }
    }
}

/// Visitor that extracts the message and all structured fields as properties.
#[derive(Default)]
struct FieldVisitor {
    message: String,
    properties: HashMap<String, serde_json::Value>,
}

impl tracing::field::Visit for FieldVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{:?}", value);
            // Remove surrounding quotes if present (from debug formatting)
            if self.message.starts_with('"') && self.message.ends_with('"') && self.message.len() >= 2 {
                self.message = self.message[1..self.message.len() - 1].to_string();
            }
        } else {
            let formatted = format!("{:?}", value);
            self.properties.insert(field.name().to_string(), serde_json::Value::String(formatted));
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            self.properties.insert(field.name().to_string(), serde_json::Value::String(value.to_string()));
        }
    }

    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        self.properties.insert(field.name().to_string(), serde_json::json!(value));
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.properties.insert(field.name().to_string(), serde_json::json!(value));
    }

    fn record_f64(&mut self, field: &tracing::field::Field, value: f64) {
        self.properties.insert(field.name().to_string(), serde_json::json!(value));
    }

    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        self.properties.insert(field.name().to_string(), serde_json::json!(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_row_serialization_no_properties() {
        let row = LogRow {
            timestamp: 1234567890123,
            device_id: "test-device-id".to_string(),
            level: "INFO".to_string(),
            message: "test message".to_string(),
            properties: None,
        };

        let json = serde_json::to_string(&row).unwrap();
        assert!(json.contains("\"timestamp\":1234567890123"));
        assert!(json.contains("\"device_id\":\"test-device-id\""));
        assert!(json.contains("\"level\":\"INFO\""));
        assert!(json.contains("\"message\":\"test message\""));
        assert!(!json.contains("\"properties\""));
    }

    #[test]
    fn test_log_row_serialization_with_properties() {
        let mut props = HashMap::new();
        props.insert("data_dir".to_string(), serde_json::Value::String("/home/user/.mort".to_string()));
        props.insert("count".to_string(), serde_json::json!(42));

        let row = LogRow {
            timestamp: 1234567890123,
            device_id: "test-device-id".to_string(),
            level: "INFO".to_string(),
            message: "test message".to_string(),
            properties: Some(props),
        };

        let json = serde_json::to_string(&row).unwrap();
        assert!(json.contains("\"properties\""));
        assert!(json.contains("\"data_dir\""));
        assert!(json.contains("\"/home/user/.mort\""));
        assert!(json.contains("\"count\":42"));
    }

    #[test]
    fn test_log_batch_serialization() {
        let batch = LogBatch {
            logs: vec![
                LogRow {
                    timestamp: 1234567890123,
                    device_id: "device-1".to_string(),
                    level: "INFO".to_string(),
                    message: "message 1".to_string(),
                    properties: None,
                },
                LogRow {
                    timestamp: 1234567890124,
                    device_id: "device-1".to_string(),
                    level: "ERROR".to_string(),
                    message: "message 2".to_string(),
                    properties: None,
                },
            ],
        };

        let json = serde_json::to_string(&batch).unwrap();
        assert!(json.contains("\"logs\":["));
        assert!(json.contains("\"message 1\""));
        assert!(json.contains("\"message 2\""));
        assert!(json.contains("\"device_id\":\"device-1\""));
    }
}
