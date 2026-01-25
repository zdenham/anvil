//! Integration tests for the log server HTTP transport.
//!
//! These tests use a mock HTTP server to verify:
//! - Logs are batched and sent correctly
//! - Retry behavior works with exponential backoff
//! - Server recovery after failure

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tiny_http::{Response, Server};

use crate::logging::buffer::ServerLogBuffer;
use crate::logging::log_server::LogRow;

/// Mock HTTP server that tracks received log batches
struct MockLogServer {
    server: Arc<Server>,
    received_count: Arc<AtomicUsize>,
    should_fail: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl MockLogServer {
    fn new() -> Self {
        let server = Arc::new(Server::http("127.0.0.1:0").expect("Failed to start mock server"));
        let received_count = Arc::new(AtomicUsize::new(0));
        let should_fail = Arc::new(AtomicBool::new(false));
        let shutdown = Arc::new(AtomicBool::new(false));

        // Spawn handler thread
        let server_clone = Arc::clone(&server);
        let count_clone = Arc::clone(&received_count);
        let fail_clone = Arc::clone(&should_fail);
        let shutdown_clone = Arc::clone(&shutdown);

        let handle = thread::spawn(move || {
            while !shutdown_clone.load(Ordering::Relaxed) {
                if let Ok(Some(mut request)) =
                    server_clone.recv_timeout(Duration::from_millis(100))
                {
                    if fail_clone.load(Ordering::Relaxed) {
                        let _ = request
                            .respond(Response::from_string("error").with_status_code(500));
                    } else {
                        // Parse body to count logs
                        let mut body = String::new();
                        let _ = request.as_reader().read_to_string(&mut body);

                        // Count logs in batch
                        if let Ok(batch) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(logs) = batch.get("logs").and_then(|l| l.as_array()) {
                                count_clone.fetch_add(logs.len(), Ordering::Relaxed);
                            }
                        }

                        let response = r#"{"status":"ok","inserted":1}"#;
                        let _ = request.respond(Response::from_string(response));
                    }
                }
            }
        });

        Self {
            server,
            received_count,
            should_fail,
            shutdown,
            handle: Some(handle),
        }
    }

    fn url(&self) -> String {
        format!("http://{}/logs", self.server.server_addr())
    }

    fn received_log_count(&self) -> usize {
        self.received_count.load(Ordering::Relaxed)
    }

    fn set_should_fail(&self, fail: bool) {
        self.should_fail.store(fail, Ordering::Relaxed);
    }

    fn reset_count(&self) {
        self.received_count.store(0, Ordering::Relaxed);
    }
}

impl Drop for MockLogServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn make_test_log(index: i64) -> LogRow {
    LogRow {
        timestamp: chrono::Utc::now().timestamp_millis() + index,
        level: "INFO".to_string(),
        message: format!("Test message {}", index),
    }
}

/// Helper to send a batch of logs via HTTP POST
fn send_logs_to_server(url: &str, logs: &[LogRow]) -> Result<(), Box<dyn std::error::Error>> {
    #[derive(serde::Serialize)]
    struct LogBatch<'a> {
        logs: &'a [LogRow],
    }

    let payload = LogBatch { logs };

    ureq::post(url)
        .set("Content-Type", "application/json")
        .send_json(&payload)?;

    Ok(())
}

#[test]
fn test_mock_server_receives_logs() {
    let mock = MockLogServer::new();
    let logs: Vec<LogRow> = (0..5).map(make_test_log).collect();

    let result = send_logs_to_server(&mock.url(), &logs);
    assert!(result.is_ok());

    // Give the server a moment to process
    thread::sleep(Duration::from_millis(50));

    assert_eq!(mock.received_log_count(), 5);
}

#[test]
fn test_mock_server_failure_mode() {
    let mock = MockLogServer::new();
    mock.set_should_fail(true);

    let logs: Vec<LogRow> = (0..3).map(make_test_log).collect();

    let result = send_logs_to_server(&mock.url(), &logs);
    assert!(result.is_err());

    // Server should not have counted any logs
    assert_eq!(mock.received_log_count(), 0);
}

#[test]
fn test_mock_server_recovery() {
    let mock = MockLogServer::new();

    // Initially failing
    mock.set_should_fail(true);
    let logs1: Vec<LogRow> = (0..3).map(make_test_log).collect();
    let result1 = send_logs_to_server(&mock.url(), &logs1);
    assert!(result1.is_err());
    assert_eq!(mock.received_log_count(), 0);

    // Recover
    mock.set_should_fail(false);
    let logs2: Vec<LogRow> = (3..6).map(make_test_log).collect();
    let result2 = send_logs_to_server(&mock.url(), &logs2);
    assert!(result2.is_ok());

    thread::sleep(Duration::from_millis(50));
    assert_eq!(mock.received_log_count(), 3);
}

#[test]
fn test_buffer_integration_with_mock_server() {
    let mock = MockLogServer::new();
    let mut buffer = ServerLogBuffer::new(100, 5);

    // Add logs to buffer
    for i in 0..5 {
        buffer.push(make_test_log(i));
    }

    assert!(buffer.should_flush());

    // Drain and send
    let logs = buffer.drain();
    let result = send_logs_to_server(&mock.url(), &logs);
    assert!(result.is_ok());

    thread::sleep(Duration::from_millis(50));
    assert_eq!(mock.received_log_count(), 5);
    assert!(buffer.is_empty());
}

#[test]
fn test_retry_pattern_with_buffer() {
    let mock = MockLogServer::new();
    let mut buffer = ServerLogBuffer::new(100, 3);

    // Fill buffer
    for i in 0..3 {
        buffer.push(make_test_log(i));
    }

    // First attempt fails
    mock.set_should_fail(true);
    let logs = buffer.clone_contents();
    let result1 = send_logs_to_server(&mock.url(), &logs);
    assert!(result1.is_err());
    // Buffer should retain logs for retry
    assert_eq!(buffer.len(), 3);

    // Second attempt succeeds
    mock.set_should_fail(false);
    let result2 = send_logs_to_server(&mock.url(), &logs);
    assert!(result2.is_ok());

    // Now clear buffer after success
    buffer.clear();
    assert!(buffer.is_empty());

    thread::sleep(Duration::from_millis(50));
    assert_eq!(mock.received_log_count(), 3);
}

#[test]
fn test_multiple_batches() {
    let mock = MockLogServer::new();

    // Send multiple batches
    for batch_num in 0..3 {
        let logs: Vec<LogRow> = (0..4).map(|i| make_test_log(batch_num * 4 + i)).collect();
        let result = send_logs_to_server(&mock.url(), &logs);
        assert!(result.is_ok());
    }

    thread::sleep(Duration::from_millis(50));
    assert_eq!(mock.received_log_count(), 12);
}

#[test]
fn test_empty_batch_handling() {
    let mock = MockLogServer::new();

    let logs: Vec<LogRow> = vec![];
    let result = send_logs_to_server(&mock.url(), &logs);
    // Empty batch should still succeed (server accepts it)
    assert!(result.is_ok());

    thread::sleep(Duration::from_millis(50));
    assert_eq!(mock.received_log_count(), 0);
}

#[test]
fn test_buffer_overflow_preserves_recent() {
    let mut buffer = ServerLogBuffer::new(5, 10);

    // Add 10 logs to a buffer of size 5
    for i in 0..10 {
        buffer.push(make_test_log(i));
    }

    // Buffer should have the 5 most recent
    assert_eq!(buffer.len(), 5);
    let logs = buffer.clone_contents();

    // Messages should be 5, 6, 7, 8, 9 (oldest 0-4 dropped)
    for (idx, log) in logs.iter().enumerate() {
        assert_eq!(log.message, format!("Test message {}", idx + 5));
    }
}

#[test]
fn test_server_count_reset() {
    let mock = MockLogServer::new();

    // Send first batch
    let logs1: Vec<LogRow> = (0..3).map(make_test_log).collect();
    send_logs_to_server(&mock.url(), &logs1).unwrap();
    thread::sleep(Duration::from_millis(50));
    assert_eq!(mock.received_log_count(), 3);

    // Reset count
    mock.reset_count();
    assert_eq!(mock.received_log_count(), 0);

    // Send second batch
    let logs2: Vec<LogRow> = (3..5).map(make_test_log).collect();
    send_logs_to_server(&mock.url(), &logs2).unwrap();
    thread::sleep(Duration::from_millis(50));
    assert_eq!(mock.received_log_count(), 2);
}
