//! Configuration for ClickHouse log transport.
//!
//! Environment variables are shared with the orb CLI tool:
//! - CLICKHOUSE_HOST: ClickHouse server URL (e.g., https://host:8443)
//! - CLICKHOUSE_USER: Username for authentication
//! - CLICKHOUSE_PASSWORD: Password for authentication
//! - CLICKHOUSE_DATABASE: Database name (default: "default")
//! - CLICKHOUSE_LOG_TABLE: Table name (default: "logs")

/// Configuration for ClickHouse log transport.
#[derive(Debug, Clone)]
pub struct ClickHouseConfig {
    pub host: String,
    pub user: String,
    pub password: String,
    pub database: String,
    pub table: String,
}

impl ClickHouseConfig {
    /// Attempts to load configuration from environment variables.
    ///
    /// Returns None if:
    /// - CLICKHOUSE_ENABLED is not "true" or "1"
    /// - Required variables (HOST, USER, PASSWORD) are missing
    ///
    /// This allows the app to run normally without ClickHouse configured.
    pub fn from_env() -> Option<Self> {
        // Check if explicitly enabled
        let enabled = std::env::var("CLICKHOUSE_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        if !enabled {
            return None;
        }

        // Required fields - return None if any are missing
        let host = std::env::var("CLICKHOUSE_HOST").ok()?;
        let user = std::env::var("CLICKHOUSE_USER").ok()?;
        let password = std::env::var("CLICKHOUSE_PASSWORD").ok()?;

        // Optional fields with defaults
        let database = std::env::var("CLICKHOUSE_DATABASE").unwrap_or_else(|_| "default".into());
        let table = std::env::var("CLICKHOUSE_LOG_TABLE").unwrap_or_else(|_| "logs".into());

        // Validate host URL format
        if !host.starts_with("http://") && !host.starts_with("https://") {
            eprintln!(
                "Warning: CLICKHOUSE_HOST should include protocol (http:// or https://). Got: {}",
                host
            );
        }

        Some(Self {
            host,
            user,
            password,
            database,
            table,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn clear_env_vars() {
        env::remove_var("CLICKHOUSE_ENABLED");
        env::remove_var("CLICKHOUSE_HOST");
        env::remove_var("CLICKHOUSE_USER");
        env::remove_var("CLICKHOUSE_PASSWORD");
        env::remove_var("CLICKHOUSE_DATABASE");
        env::remove_var("CLICKHOUSE_LOG_TABLE");
    }

    #[test]
    fn test_config_from_env_disabled() {
        clear_env_vars();
        assert!(ClickHouseConfig::from_env().is_none());
    }

    #[test]
    fn test_config_from_env_enabled_but_missing_required() {
        clear_env_vars();
        env::set_var("CLICKHOUSE_ENABLED", "true");
        // Missing HOST, USER, PASSWORD
        assert!(ClickHouseConfig::from_env().is_none());
    }

    #[test]
    fn test_config_from_env_missing_host() {
        clear_env_vars();
        env::set_var("CLICKHOUSE_ENABLED", "true");
        env::set_var("CLICKHOUSE_USER", "test_user");
        env::set_var("CLICKHOUSE_PASSWORD", "test_pass");
        assert!(ClickHouseConfig::from_env().is_none());
    }

    #[test]
    fn test_config_from_env_complete() {
        clear_env_vars();
        env::set_var("CLICKHOUSE_ENABLED", "true");
        env::set_var("CLICKHOUSE_HOST", "https://localhost:8443");
        env::set_var("CLICKHOUSE_USER", "test_user");
        env::set_var("CLICKHOUSE_PASSWORD", "test_pass");

        let config = ClickHouseConfig::from_env();
        assert!(config.is_some());
        let config = config.unwrap();
        assert_eq!(config.host, "https://localhost:8443");
        assert_eq!(config.user, "test_user");
        assert_eq!(config.password, "test_pass");
        assert_eq!(config.database, "default");
        assert_eq!(config.table, "logs");
    }

    #[test]
    fn test_config_from_env_with_custom_database_and_table() {
        clear_env_vars();
        env::set_var("CLICKHOUSE_ENABLED", "1");
        env::set_var("CLICKHOUSE_HOST", "https://localhost:8443");
        env::set_var("CLICKHOUSE_USER", "test_user");
        env::set_var("CLICKHOUSE_PASSWORD", "test_pass");
        env::set_var("CLICKHOUSE_DATABASE", "observability");
        env::set_var("CLICKHOUSE_LOG_TABLE", "app_logs");

        let config = ClickHouseConfig::from_env();
        assert!(config.is_some());
        let config = config.unwrap();
        assert_eq!(config.database, "observability");
        assert_eq!(config.table, "app_logs");
    }
}
