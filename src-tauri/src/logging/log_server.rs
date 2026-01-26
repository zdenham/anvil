//! Log server tracing layer for uploading logs to a backend server.
//!
//! This layer batches log entries and uploads them via HTTP POST to a backend
//! server that forwards them to ClickHouse. This approach removes the heavy
//! clickhouse crate dependency (217 transitive deps) and keeps credentials server-side.

use super::config::LogServerConfig;
use serde::Serialize;
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
    let mut buffer: Vec<LogRow> = Vec::with_capacity(MAX_BUFFER_SIZE);
    let mut last_flush_attempt = Instant::now();

    loop {
        let timeout = FLUSH_INTERVAL.saturating_sub(last_flush_attempt.elapsed());

        match receiver.recv_timeout(timeout) {
            Ok(row) => {
                // Drop oldest if at capacity
                if buffer.len() >= MAX_BUFFER_SIZE {
                    buffer.remove(0);
                }
                buffer.push(row);

                // Flush if batch size reached
                if buffer.len() >= BATCH_SIZE {
                    try_flush(&config.url, &mut buffer);
                    last_flush_attempt = Instant::now();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !buffer.is_empty() {
                    try_flush(&config.url, &mut buffer);
                    last_flush_attempt = Instant::now();
                }
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
/// On success, buffer is cleared. On failure, buffer is retained for next attempt.
fn try_flush(url: &str, buffer: &mut Vec<LogRow>) {
    let mut delay = INITIAL_RETRY_DELAY;

    for attempt in 0..MAX_RETRIES {
        // Clone the buffer contents for the attempt
        let batch: Vec<LogRow> = buffer.clone();

        match send_batch(url, &batch) {
            Ok(()) => {
                buffer.clear(); // Only clear on success
                return;
            }
            Err(e) => {
                if attempt < MAX_RETRIES - 1 {
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

    // All retries failed - buffer is retained for next attempt
    eprintln!(
        "Log server temporarily unavailable. {} logs buffered.",
        buffer.len()
    );
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
const EXCLUDED_TARGETS: &[&str] = &["ureq", "rustls"];

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

        let mut message = String::new();
        let mut visitor = MessageVisitor(&mut message);
        event.record(&mut visitor);

        let row = LogRow {
            timestamp: chrono::Utc::now().timestamp_millis(),
            device_id: self.device_id.clone(),
            level: event.metadata().level().to_string(),
            message,
        };

        // Non-blocking send - if channel is full, drop the log rather than blocking
        // This ensures logging never impacts app performance
        if self.sender.send(row).is_err() {
            // Channel disconnected - worker thread has exited
            // We don't log this to avoid recursive issues.
        }
    }
}

/// Simple visitor that extracts only the message field
struct MessageVisitor<'a>(&'a mut String);

impl tracing::field::Visit for MessageVisitor<'_> {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            *self.0 = format!("{:?}", value);
            // Remove surrounding quotes if present (from debug formatting)
            if self.0.starts_with('"') && self.0.ends_with('"') && self.0.len() >= 2 {
                *self.0 = self.0[1..self.0.len() - 1].to_string();
            }
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            *self.0 = value.to_string();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_row_serialization() {
        let row = LogRow {
            timestamp: 1234567890123,
            device_id: "test-device-id".to_string(),
            level: "INFO".to_string(),
            message: "test message".to_string(),
        };

        let json = serde_json::to_string(&row).unwrap();
        assert!(json.contains("\"timestamp\":1234567890123"));
        assert!(json.contains("\"device_id\":\"test-device-id\""));
        assert!(json.contains("\"level\":\"INFO\""));
        assert!(json.contains("\"message\":\"test message\""));
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
                },
                LogRow {
                    timestamp: 1234567890124,
                    device_id: "device-1".to_string(),
                    level: "ERROR".to_string(),
                    message: "message 2".to_string(),
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
