//! Configuration for log server transport.
//!
//! The log server receives logs via HTTP POST and forwards them to ClickHouse.
//! This keeps ClickHouse credentials server-side and reduces client dependencies.
//!
//! Environment variables:
//! - LOG_SERVER_URL: Full URL to the log endpoint (e.g., http://localhost:3000/logs)
//!   If set, enables log server transport.

/// Configuration for log server transport.
#[derive(Debug, Clone)]
pub struct LogServerConfig {
    pub url: String,
}

impl LogServerConfig {
    /// Default log server URL (baked in at compile time).
    /// Can be overridden via LOG_SERVER_URL environment variable.
    const DEFAULT_LOG_SERVER_URL: &'static str = "https://anvil-server.fly.dev/logs";

    /// Checks whether telemetry is enabled by reading workspace settings from disk.
    ///
    /// This runs before paths::initialize() and the JS settings store are ready,
    /// so it reads the JSON file directly (same pattern as get_logs_dir).
    ///
    /// Returns true (telemetry enabled) if:
    /// - The file doesn't exist or can't be read
    /// - The JSON can't be parsed
    /// - The `telemetryEnabled` field is absent or true
    ///
    /// Returns false only when `telemetryEnabled` is explicitly `false`.
    fn is_telemetry_enabled() -> bool {
        let suffix = crate::build_info::app_suffix();
        let dir_name = if suffix.is_empty() {
            ".anvil".to_string()
        } else {
            format!(".anvil-{}", suffix)
        };

        let settings_path = std::env::var("ANVIL_DATA_DIR")
            .map(|s| std::path::PathBuf::from(shellexpand::tilde(&s).into_owned()))
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_else(|| std::path::PathBuf::from("."))
                    .join(dir_name)
            })
            .join("settings")
            .join("workspace.json");

        let contents = match std::fs::read_to_string(&settings_path) {
            Ok(c) => c,
            Err(_) => return true, // file missing or unreadable → fail-open
        };

        let json: serde_json::Value = match serde_json::from_str(&contents) {
            Ok(v) => v,
            Err(_) => return true, // malformed JSON → fail-open
        };

        // Field absent → true; explicitly false → false; anything else → true
        json.get("telemetryEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
    }

    /// Attempts to load configuration from environment or uses the default.
    ///
    /// Priority:
    /// 1. LOG_SERVER_URL environment variable (for local development/testing)
    /// 2. Built-in default URL
    ///
    /// Returns None if LOG_SERVER_DISABLED=true or telemetryEnabled=false in workspace settings.
    pub fn from_env() -> Option<Self> {
        // Allow disabling via env var for local testing
        if std::env::var("LOG_SERVER_DISABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false)
        {
            return None;
        }

        // Check workspace settings for user opt-out
        if !Self::is_telemetry_enabled() {
            tracing::info!("Telemetry disabled by user setting");
            return None;
        }

        let url = std::env::var("LOG_SERVER_URL")
            .unwrap_or_else(|_| Self::DEFAULT_LOG_SERVER_URL.to_string());

        // Validate URL format
        if !url.starts_with("http://") && !url.starts_with("https://") {
            tracing::warn!(
                "LOG_SERVER_URL should include protocol (http:// or https://). Got: {}",
                url
            );
        }

        Some(Self { url })
    }

    /// Returns config without checking the telemetry workspace setting.
    /// Used when re-enabling telemetry at runtime (the user just toggled it on).
    pub fn from_env_force() -> Option<Self> {
        if std::env::var("LOG_SERVER_DISABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false)
        {
            return None;
        }
        let url = std::env::var("LOG_SERVER_URL")
            .unwrap_or_else(|_| Self::DEFAULT_LOG_SERVER_URL.to_string());
        Some(Self { url })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn clear_env_vars() {
        env::remove_var("LOG_SERVER_URL");
        env::remove_var("LOG_SERVER_DISABLED");
    }

    #[test]
    fn test_config_uses_default_when_no_env() {
        clear_env_vars();
        let config = LogServerConfig::from_env();
        assert!(config.is_some());
        let config = config.unwrap();
        assert_eq!(config.url, LogServerConfig::DEFAULT_LOG_SERVER_URL);
    }

    #[test]
    fn test_config_disabled_via_env() {
        clear_env_vars();
        env::set_var("LOG_SERVER_DISABLED", "true");
        assert!(LogServerConfig::from_env().is_none());
        clear_env_vars();
    }

    #[test]
    fn test_config_from_env_with_http_url() {
        clear_env_vars();
        env::set_var("LOG_SERVER_URL", "http://localhost:3000/logs");

        let config = LogServerConfig::from_env();
        assert!(config.is_some());
        let config = config.unwrap();
        assert_eq!(config.url, "http://localhost:3000/logs");
        clear_env_vars();
    }

    #[test]
    fn test_config_from_env_with_https_url() {
        clear_env_vars();
        env::set_var("LOG_SERVER_URL", "https://logs.example.com/logs");

        let config = LogServerConfig::from_env();
        assert!(config.is_some());
        let config = config.unwrap();
        assert_eq!(config.url, "https://logs.example.com/logs");
        clear_env_vars();
    }
}
