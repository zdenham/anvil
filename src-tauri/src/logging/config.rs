//! Configuration for log server transport.
//!
//! The log server receives logs via HTTP POST and forwards them to ClickHouse.
//! This keeps ClickHouse credentials server-side and reduces client dependencies.
//!
//! Environment variables:
//! - LOG_SERVER_ENABLED: Set to "true" or "1" to enable log server transport
//! - LOG_SERVER_URL: Full URL to the log endpoint (e.g., http://localhost:3000/logs)

/// Configuration for log server transport.
#[derive(Debug, Clone)]
pub struct LogServerConfig {
    pub url: String,
}

impl LogServerConfig {
    /// Attempts to load configuration from environment variables.
    ///
    /// Returns None if:
    /// - LOG_SERVER_ENABLED is not "true" or "1"
    /// - LOG_SERVER_URL is missing
    ///
    /// This allows the app to run normally without log server configured.
    pub fn from_env() -> Option<Self> {
        // Check if explicitly enabled
        let enabled = std::env::var("LOG_SERVER_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        if !enabled {
            return None;
        }

        // Required field - return None if missing
        let url = std::env::var("LOG_SERVER_URL").ok()?;

        // Validate URL format
        if !url.starts_with("http://") && !url.starts_with("https://") {
            eprintln!(
                "Warning: LOG_SERVER_URL should include protocol (http:// or https://). Got: {}",
                url
            );
        }

        Some(Self { url })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn clear_env_vars() {
        env::remove_var("LOG_SERVER_ENABLED");
        env::remove_var("LOG_SERVER_URL");
    }

    #[test]
    fn test_config_from_env_disabled() {
        clear_env_vars();
        assert!(LogServerConfig::from_env().is_none());
    }

    #[test]
    fn test_config_from_env_enabled_but_missing_url() {
        clear_env_vars();
        env::set_var("LOG_SERVER_ENABLED", "true");
        // Missing URL
        assert!(LogServerConfig::from_env().is_none());
    }

    #[test]
    fn test_config_from_env_complete() {
        clear_env_vars();
        env::set_var("LOG_SERVER_ENABLED", "true");
        env::set_var("LOG_SERVER_URL", "http://localhost:3000/logs");

        let config = LogServerConfig::from_env();
        assert!(config.is_some());
        let config = config.unwrap();
        assert_eq!(config.url, "http://localhost:3000/logs");
    }

    #[test]
    fn test_config_from_env_with_https() {
        clear_env_vars();
        env::set_var("LOG_SERVER_ENABLED", "1");
        env::set_var("LOG_SERVER_URL", "https://logs.example.com/logs");

        let config = LogServerConfig::from_env();
        assert!(config.is_some());
        let config = config.unwrap();
        assert_eq!(config.url, "https://logs.example.com/logs");
    }
}
