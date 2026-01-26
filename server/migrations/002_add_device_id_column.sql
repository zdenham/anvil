-- Migration: 002_add_device_id_column
-- Description: Adds device_id column for user/device tracking

ALTER TABLE logs ADD COLUMN IF NOT EXISTS device_id String DEFAULT '' AFTER timestamp;
