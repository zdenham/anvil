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
    pub timestamp: i64, // DateTime64(3) as milliseconds since epoch
    pub level: String,  // TRACE, DEBUG, INFO, WARN, ERROR
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
        let mut message = String::new();
        let mut visitor = MessageVisitor(&mut message);
        event.record(&mut visitor);

        let row = LogRow {
            timestamp: chrono::Utc::now().timestamp_millis(),
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
            level: "INFO".to_string(),
            message: "test message".to_string(),
        };

        let json = serde_json::to_string(&row).unwrap();
        assert!(json.contains("\"timestamp\":1234567890123"));
        assert!(json.contains("\"level\":\"INFO\""));
        assert!(json.contains("\"message\":\"test message\""));
    }

    #[test]
    fn test_log_batch_serialization() {
        let batch = LogBatch {
            logs: vec![
                LogRow {
                    timestamp: 1234567890123,
                    level: "INFO".to_string(),
                    message: "message 1".to_string(),
                },
                LogRow {
                    timestamp: 1234567890124,
                    level: "ERROR".to_string(),
                    message: "message 2".to_string(),
                },
            ],
        };

        let json = serde_json::to_string(&batch).unwrap();
        assert!(json.contains("\"logs\":["));
        assert!(json.contains("\"message 1\""));
        assert!(json.contains("\"message 2\""));
    }
}
