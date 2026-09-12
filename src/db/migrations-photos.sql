-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinical_photos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  wound_id       INTEGER REFERENCES wounds(id),
  context        TEXT NOT NULL DEFAULT 'WOUND',
  body_site      TEXT,
  caption        TEXT,
  captured_at    TEXT NOT NULL,
  captured_by    TEXT,
  consent_uuid   TEXT,
  mime_type      TEXT NOT NULL DEFAULT 'image/jpeg',
  width          INTEGER,
  height         INTEGER,
  size_bytes     INTEGER,
  checksum       TEXT,
  image_data     TEXT NOT NULL,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_photos_participant ON clinical_photos(participant_id);
CREATE INDEX IF NOT EXISTS idx_photos_wound ON clinical_photos(wound_id);
CREATE INDEX IF NOT EXISTS idx_photos_project ON clinical_photos(project_id);
