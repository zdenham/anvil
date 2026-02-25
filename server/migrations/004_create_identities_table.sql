-- Migration: 004_create_identities_table
-- Description: Creates identity mapping from device_id to GitHub handle

CREATE TABLE IF NOT EXISTS identities (
    device_id String,
    github_handle String,
    registered_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(registered_at)
ORDER BY device_id
