-- =====================================================================
-- Migration 003 - synchronisation support
--
-- Adds the bookkeeping the sync engine needs. It does NOT change a single
-- existing table: every record already carries the uuid, timestamps,
-- device_id and version that a merge needs (schema migration 001).
--
-- Nothing here makes the application depend on a network. With no cloud
-- configured the outbox simply accumulates and is never read.
-- =====================================================================

-- One row per locally-changed record, awaiting push. Written at the single
-- choke point every repository already goes through (db/repo/base.ts), so a
-- new repository cannot forget to register its changes.
CREATE TABLE IF NOT EXISTS sync_outbox (
  table_name  TEXT NOT NULL,
  row_uuid    TEXT NOT NULL,
  changed_at  TEXT NOT NULL,
  PRIMARY KEY (table_name, row_uuid)
);
CREATE INDEX IF NOT EXISTS idx_outbox_changed ON sync_outbox(changed_at);

-- History of sync attempts, so an administrator can see what happened and
-- when - including failures, which matter most.
CREATE TABLE IF NOT EXISTS sync_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  direction     TEXT NOT NULL,
  pushed        INTEGER NOT NULL DEFAULT 0,
  pulled        INTEGER NOT NULL DEFAULT 0,
  conflicts     INTEGER NOT NULL DEFAULT 0,
  ok            INTEGER NOT NULL DEFAULT 0,
  message       TEXT,
  server_cursor INTEGER,
  actor         TEXT,
  device_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_syncruns_time ON sync_runs(started_at);
