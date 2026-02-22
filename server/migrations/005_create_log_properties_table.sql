-- Migration: 005_create_log_properties_table
-- Description: EAV table for optional structured properties on log rows

CREATE TABLE IF NOT EXISTS log_properties (
    log_id String,
    device_id String,
    timestamp DateTime64(3),
    key LowCardinality(String),
    value_string String DEFAULT '',
    value_number Float64 DEFAULT 0,
    value_bool UInt8 DEFAULT 0
) ENGINE = MergeTree()
ORDER BY (device_id, log_id, key)
TTL timestamp + INTERVAL 30 DAY
