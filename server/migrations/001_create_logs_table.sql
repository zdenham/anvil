-- Migration: 001_create_logs_table
-- Description: Creates the logs table for storing application logs

CREATE TABLE IF NOT EXISTS logs (
    timestamp DateTime64(3),
    level LowCardinality(String),
    message String
) ENGINE = MergeTree()
ORDER BY timestamp
TTL timestamp + INTERVAL 30 DAY
