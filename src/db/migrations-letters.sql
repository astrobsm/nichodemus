
-- ---------------------------------------------------------------------------
-- Official correspondence (spec S18).
--
-- Letters are kept because an outreach is answerable for them: somebody will
-- ask what was written to the Ministry, when, and who signed it. They carry
-- the sync envelope like every other record, so the letter written on the
-- planning laptop is on the administrator's phone at the meeting.
--
-- The body is stored as written, not as a template reference. A template that
-- changes in a later version of the application must never silently change
-- what a letter already sent to a Commissioner is recorded as saying.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS letters (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid                  TEXT NOT NULL UNIQUE,
  project_id            INTEGER NOT NULL REFERENCES projects(id),
  template_key          TEXT,
  reference             TEXT,
  letter_date           TEXT,
  recipient_name        TEXT,
  recipient_title       TEXT,
  recipient_organisation TEXT,
  recipient_address     TEXT,
  salutation            TEXT,
  subject               TEXT,
  body                  TEXT NOT NULL DEFAULT '',
  closing               TEXT,
  signatory_name        TEXT,
  signatory_title       TEXT,
  enclosures            TEXT,
  copies                TEXT,
  status                TEXT NOT NULL DEFAULT 'DRAFT',
  sent_at               TEXT,
  delivered_by          TEXT,
  notes                 TEXT,
  is_demo               INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  device_id             TEXT,
  created_by            TEXT,
  updated_by            TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  deleted_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_letters_project ON letters(project_id, letter_date);
