-- Migration: 003_add_log_id_column
-- Description: Adds a unique log_id to the existing logs table for linking to log_properties

ALTER TABLE logs ADD COLUMN IF NOT EXISTS log_id String DEFAULT generateUUIDv4() FIRST;
