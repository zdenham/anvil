//! Centralized logging system with dual output streams.
//!
//! Provides structured JSON logs for LLM querying and colored console output
//! for human readability. Uses the `tracing` crate for structured logging.
//!
//! Also maintains an in-memory log buffer that emits events to the frontend
//! for the Logs tab display.
//!
//! Note: This module initializes before paths::initialize() is called,
//! so we use a fallback path resolution that matches paths.rs logic.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tracing_subscriber::fmt::format::FmtSpan;
use tracing_subscriber::fmt::time::FormatTime;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter, Layer};

/// Global start time for uptime display in console logs
static START_TIME: OnceLock<Instant> = OnceLock::new();

/// Global throttle state for throttled logging
static THROTTLE_STATE: OnceLock<Mutex<HashMap<&'static str, Instant>>> = OnceLock::new();

fn get_throttle_state() -> &'static Mutex<HashMap<&'static str, Instant>> {
    THROTTLE_STATE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Check if a log with the given key should be emitted based on throttle interval.
/// Returns true if enough time has passed since the last log with this key.
pub fn should_log_throttled(key: &'static str, interval_ms: u64) -> bool {
    let now = Instant::now();
    let interval = Duration::from_millis(interval_ms);

    if let Ok(mut state) = get_throttle_state().lock() {
        if let Some(last_time) = state.get(key) {
            if now.duration_since(*last_time) < interval {
                return false;
            }
        }
        state.insert(key, now);
        true
    } else {
        // If we can't acquire the lock, allow the log
        true
    }
}

/// Macro for throttled debug logging.
/// Only emits the log if the specified interval has passed since the last log with this key.
///
/// Usage:
/// ```
/// throttle_debug!("window_resize", 500, "Window resized to {}x{}", width, height);
/// ```
#[macro_export]
macro_rules! throttle_debug {
    ($key:expr, $interval_ms:expr, $($arg:tt)*) => {
        if $crate::logging::should_log_throttled($key, $interval_ms) {
            tracing::debug!($($arg)*);
        }
    };
}

/// Macro for throttled info logging.
#[macro_export]
macro_rules! throttle_info {
    ($key:expr, $interval_ms:expr, $($arg:tt)*) => {
        if $crate::logging::should_log_throttled($key, $interval_ms) {
            tracing::info!($($arg)*);
        }
    };
}

/// Macro for throttled warn logging.
#[macro_export]
macro_rules! throttle_warn {
    ($key:expr, $interval_ms:expr, $($arg:tt)*) => {
        if $crate::logging::should_log_throttled($key, $interval_ms) {
            tracing::warn!($($arg)*);
        }
    };
}

/// Maximum number of logs to keep in memory
const MAX_BUFFERED_LOGS: usize = 10000;

/// Log entry format for frontend display
#[derive(Clone, serde::Serialize)]
pub struct LogEvent {
    pub timestamp: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

/// In-memory log buffer for frontend display
struct LogBuffer {
    logs: Mutex<Vec<LogEvent>>,
    app_handle: Mutex<Option<AppHandle>>,
    /// Tracks last emit time for each unique log message (for throttling duplicates)
    last_emit: Mutex<HashMap<String, (Instant, u64)>>, // (last_time, suppressed_count)
}

/// Minimum interval between identical log messages (in ms)
const LOG_DEDUP_INTERVAL_MS: u64 = 500;

impl LogBuffer {
    fn new() -> Self {
        Self {
            logs: Mutex::new(Vec::new()),
            app_handle: Mutex::new(None),
            last_emit: Mutex::new(HashMap::new()),
        }
    }

    fn set_app_handle(&self, handle: AppHandle) {
        if let Ok(mut guard) = self.app_handle.lock() {
            *guard = Some(handle);
        }
    }

    /// Check if this log should be emitted (throttle duplicates).
    /// Returns Some(suppressed_count) if should emit, None if should skip.
    fn should_emit(&self, key: &str) -> Option<u64> {
        let now = Instant::now();
        let interval = Duration::from_millis(LOG_DEDUP_INTERVAL_MS);

        if let Ok(mut state) = self.last_emit.lock() {
            if let Some(&(last_time, suppressed)) = state.get(key) {
                if now.duration_since(last_time) < interval {
                    // Too soon - increment suppressed count and skip
                    state.insert(key.to_string(), (last_time, suppressed + 1));
                    return None;
                }
                // Enough time passed - emit with suppressed count
                state.insert(key.to_string(), (now, 0));
                return Some(suppressed);
            }
            // First time seeing this log
            state.insert(key.to_string(), (now, 0));
            Some(0)
        } else {
            // Lock failed, allow the log
            Some(0)
        }
    }

    fn push(&self, mut log: LogEvent) {
        // Create a key from target + message for deduplication
        let dedup_key = format!("{}:{}", log.target, log.message);

        // Check throttling
        let suppressed_count = match self.should_emit(&dedup_key) {
            Some(count) => count,
            None => return, // Skip this log (throttled)
        };

        // If we suppressed logs, append count to message
        if suppressed_count > 0 {
            log.message = format!("{} (repeated {} times)", log.message, suppressed_count + 1);
        }

        // Emit to frontend if app handle is available
        if let Ok(guard) = self.app_handle.lock() {
            if let Some(handle) = guard.as_ref() {
                let _ = handle.emit("log-event", &log);
            }
        }

        // Add to buffer (circular)
        if let Ok(mut logs) = self.logs.lock() {
            if logs.len() >= MAX_BUFFERED_LOGS {
                logs.remove(0);
            }
            logs.push(log);
        }
    }

    fn get_all(&self) -> Vec<LogEvent> {
        self.logs.lock().map(|g| g.clone()).unwrap_or_default()
    }

    fn clear(&self) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.clear();
        }
    }
}

/// Global log buffer instance
static LOG_BUFFER: LazyLock<LogBuffer> = LazyLock::new(LogBuffer::new);

/// Sets the app handle for emitting log events to frontend.
/// Called during app setup.
pub fn set_app_handle(handle: AppHandle) {
    LOG_BUFFER.set_app_handle(handle);
}

/// Custom timer that shows seconds since app start
struct UptimeTimer;

impl FormatTime for UptimeTimer {
    fn format_time(&self, w: &mut fmt::format::Writer<'_>) -> std::fmt::Result {
        let elapsed = START_TIME.get().map(|s| s.elapsed()).unwrap_or_default();
        write!(w, "{:>6.3}s", elapsed.as_secs_f64())
    }
}

/// Custom tracing layer that captures logs and pushes them to the in-memory buffer
struct BufferLayer;

impl<S> tracing_subscriber::Layer<S> for BufferLayer
where
    S: tracing::Subscriber,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        // Extract message from event
        let mut message = String::new();
        let mut visitor = MessageVisitor(&mut message);
        event.record(&mut visitor);

        let log = LogEvent {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: event.metadata().level().to_string().to_uppercase(),
            target: event.metadata().target().to_string(),
            message,
        };

        LOG_BUFFER.push(log);
    }
}

/// Visitor to extract the message field from a tracing event
struct MessageVisitor<'a>(&'a mut String);

impl tracing::field::Visit for MessageVisitor<'_> {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            *self.0 = format!("{:?}", value);
            // Remove surrounding quotes if present
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

/// Gets or creates the logs directory.
/// Uses the same path derivation logic as paths.rs but doesn't require
/// paths::initialize() to have been called (since logging starts first).
fn get_logs_dir() -> io::Result<PathBuf> {
    // Read suffix directly from baked env var (same as build_info::APP_SUFFIX)
    let suffix = env!("MORT_APP_SUFFIX");
    let dir_name = if suffix.is_empty() {
        "mortician".to_string()
    } else {
        format!("mortician-{}", suffix)
    };

    // Check for runtime env var override first (same as paths.rs)
    let config_dir = std::env::var("MORT_CONFIG_DIR")
        .map(|s| PathBuf::from(shellexpand::tilde(&s).into_owned()))
        .unwrap_or_else(|_| {
            dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(dir_name)
        });

    let logs_dir = config_dir.join("logs");
    fs::create_dir_all(&logs_dir)?;
    Ok(logs_dir)
}

/// Initializes the dual-output logging system.
///
/// Sets up two output streams:
/// - JSON Lines file (`logs/structured.jsonl`) for programmatic analysis
/// - Colored console output for human readability
pub fn initialize() {
    let _ = START_TIME.set(Instant::now());

    // Set up the console layer with colored, compact output
    let console_layer = fmt::layer()
        .with_timer(UptimeTimer)
        .with_target(true)
        .with_level(true)
        .with_ansi(true)
        .compact()
        .with_filter(EnvFilter::new("debug"));

    // Set up the JSON file layer
    let json_layer = match setup_json_layer() {
        Ok(layer) => Some(layer),
        Err(e) => {
            eprintln!("Warning: Could not set up JSON logging: {}", e);
            None
        }
    };

    // Initialize the subscriber with all layers
    tracing_subscriber::registry()
        .with(console_layer)
        .with(json_layer)
        .with(BufferLayer)
        .init();

    tracing::info!("Logging initialized");
}

/// Sets up the JSON file layer for structured logging.
fn setup_json_layer<S>() -> io::Result<impl Layer<S>>
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    let logs_dir = get_logs_dir()?;
    let log_file = File::create(logs_dir.join("structured.jsonl"))?;

    Ok(fmt::layer()
        .json()
        .with_writer(log_file)
        .with_thread_ids(true)
        .with_target(true)
        .with_span_events(FmtSpan::CLOSE)
        .with_filter(EnvFilter::new("debug")))
}

/// Logs a message from the web frontend.
///
/// Bridges frontend logging calls to the centralized logging system.
/// The source parameter identifies which window the log came from (e.g., "spotlight", "main").
pub fn log_from_web(level: &str, message: &str, source: &str) {
    // tracing requires static string targets, so we include source in the message
    // and use a generic "web" target, but prefix with the source for clarity
    let prefixed = format!("[{}] {}", source, message);
    match level {
        "error" => tracing::error!(target: "web", "{}", prefixed),
        "warn" => tracing::warn!(target: "web", "{}", prefixed),
        "info" => tracing::info!(target: "web", "{}", prefixed),
        "debug" => tracing::debug!(target: "web", "{}", prefixed),
        _ => tracing::info!(target: "web", "{}", prefixed),
    }
}

/// Get all buffered logs (for initial load when Logs tab opens)
#[tauri::command]
pub fn get_buffered_logs() -> Vec<LogEvent> {
    LOG_BUFFER.get_all()
}

/// Clear all buffered logs permanently
#[tauri::command]
pub fn clear_logs() {
    LOG_BUFFER.clear();
}
