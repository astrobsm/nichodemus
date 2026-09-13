-- =====================================================================
-- NICHODEMUS UGBOR MEMORIAL COMMUNITY HEALTH OUTREACH
-- Local SQLite schema (migration 001 - baseline)
--
-- Conventions
--   * Every substantive table carries the sync envelope required by
--     master spec S91: uuid, created_at, updated_at, device_id,
--     created_by, updated_by, version, deleted_at (soft delete).
--   * Timestamps are ISO-8601 strings in local device time with offset.
--   * Clinical rows are NEVER hard deleted; deleted_at is set instead.
-- =====================================================================

-- ---------------------------------------------------------------- meta
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

-- --------------------------------------------------------------- roles
CREATE TABLE IF NOT EXISTS roles (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_system   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS permissions (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code       TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

-- ------------------------------------------------------------ projects
CREATE TABLE IF NOT EXISTS projects (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid                  TEXT NOT NULL UNIQUE,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  memorial_honouree     TEXT,
  location              TEXT,
  lga                   TEXT,
  state                 TEXT,
  country               TEXT DEFAULT 'Nigeria',
  proposed_date         TEXT,
  end_date              TEXT,
  start_time            TEXT,
  end_time              TEXT,
  expected_participants INTEGER DEFAULT 0,
  max_capacity          INTEGER,
  objectives            TEXT,
  theme                 TEXT,
  status                TEXT NOT NULL DEFAULT 'PLANNING',
  project_director      TEXT,
  medical_director      TEXT,
  participant_prefix    TEXT NOT NULL DEFAULT 'NUG',
  currency              TEXT NOT NULL DEFAULT 'NGN',
  is_active             INTEGER NOT NULL DEFAULT 1,
  is_demo               INTEGER NOT NULL DEFAULT 0,
  closed_at             TEXT,
  notes                 TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  device_id             TEXT,
  created_by            TEXT,
  updated_by            TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  deleted_at            TEXT
);

-- ------------------------------------------------------------ stations
CREATE TABLE IF NOT EXISTS stations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid        TEXT NOT NULL UNIQUE,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  stage       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  device_id   TEXT,
  created_by  TEXT,
  updated_by  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT,
  UNIQUE (project_id, code)
);

-- -------------------------------------------------------- team members
CREATE TABLE IF NOT EXISTS team_members (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid                  TEXT NOT NULL UNIQUE,
  project_id            INTEGER NOT NULL REFERENCES projects(id),
  staff_code            TEXT NOT NULL,
  full_name             TEXT NOT NULL,
  role                  TEXT,
  professional_category TEXT,
  phone                 TEXT,
  email                 TEXT,
  organisation          TEXT,
  licence_number        TEXT,
  assigned_station_id   INTEGER REFERENCES stations(id),
  shift                 TEXT,
  status                TEXT NOT NULL DEFAULT 'CONFIRMED',
  is_volunteer          INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  is_demo               INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  device_id             TEXT,
  created_by            TEXT,
  updated_by            TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  deleted_at            TEXT,
  UNIQUE (project_id, staff_code)
);
CREATE INDEX IF NOT EXISTS idx_team_project ON team_members(project_id);

-- --------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid            TEXT NOT NULL UNIQUE,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name       TEXT NOT NULL,
  role_code       TEXT NOT NULL REFERENCES roles(code),
  pin_hash        TEXT NOT NULL,
  pin_salt        TEXT NOT NULL,
  pin_iterations  INTEGER NOT NULL DEFAULT 150000,
  phone           TEXT,
  email           TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  must_change_pin INTEGER NOT NULL DEFAULT 0,
  -- Set when an administrator issues a temporary PIN. The PIN stops working
  -- at this moment whether it has been used or not, so one sent through a
  -- chat application does not stay usable in that history for ever.
  pin_expires_at  TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  team_member_id  INTEGER REFERENCES team_members(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  device_id       TEXT,
  created_by      TEXT,
  updated_by      TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_code);

CREATE TABLE IF NOT EXISTS attendance (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  team_member_id INTEGER NOT NULL REFERENCES team_members(id),
  date           TEXT NOT NULL,
  time_in        TEXT,
  time_out       TEXT,
  station_id     INTEGER REFERENCES stations(id),
  status         TEXT NOT NULL DEFAULT 'PRESENT',
  notes          TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_attendance_day ON attendance(project_id, date);

-- --------------------------------------------------------------- tasks
CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid          TEXT NOT NULL UNIQUE,
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  code          TEXT,
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  assignee_id   INTEGER REFERENCES team_members(id),
  assignee_name TEXT,
  priority      TEXT NOT NULL DEFAULT 'MEDIUM',
  start_date    TEXT,
  due_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'NOT_STARTED',
  completed_at  TEXT,
  notes         TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  device_id     TEXT,
  created_by    TEXT,
  updated_by    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);

-- -------------------------------------------------------- participants
CREATE TABLE IF NOT EXISTS participants (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid                    TEXT NOT NULL UNIQUE,
  project_id              INTEGER NOT NULL REFERENCES projects(id),
  participant_code        TEXT NOT NULL,
  serial_no               INTEGER NOT NULL,
  first_name              TEXT NOT NULL,
  middle_name             TEXT,
  last_name               TEXT NOT NULL,
  preferred_name          TEXT,
  sex                     TEXT NOT NULL,
  date_of_birth           TEXT,
  age_years               INTEGER,
  age_is_estimated        INTEGER NOT NULL DEFAULT 0,
  community               TEXT,
  phone                   TEXT,
  occupation              TEXT,
  contact_person          TEXT,
  contact_phone           TEXT,
  known_hypertension      TEXT NOT NULL DEFAULT 'UNKNOWN',
  known_diabetes          TEXT NOT NULL DEFAULT 'UNKNOWN',
  previous_breast_problem TEXT NOT NULL DEFAULT 'UNKNOWN',
  current_medications     TEXT,
  medical_history         TEXT,
  workflow_status         TEXT NOT NULL DEFAULT 'REGISTERED',
  current_station_id      INTEGER REFERENCES stations(id),
  registered_at           TEXT NOT NULL,
  completed_at            TEXT,
  duplicate_override_by   TEXT,
  duplicate_override_reason TEXT,
  search_key              TEXT,
  is_demo                 INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  device_id               TEXT,
  created_by              TEXT,
  updated_by              TEXT,
  version                 INTEGER NOT NULL DEFAULT 1,
  deleted_at              TEXT,
  UNIQUE (project_id, participant_code),
  UNIQUE (project_id, serial_no)
);
CREATE INDEX IF NOT EXISTS idx_participants_search ON participants(search_key);
CREATE INDEX IF NOT EXISTS idx_participants_status ON participants(project_id, workflow_status);
CREATE INDEX IF NOT EXISTS idx_participants_phone ON participants(phone);
CREATE INDEX IF NOT EXISTS idx_participants_names ON participants(last_name, first_name);

CREATE TABLE IF NOT EXISTS consents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  consent_type   TEXT NOT NULL DEFAULT 'GENERAL_CARE',
  status         TEXT NOT NULL,
  obtained_by    TEXT,
  obtained_at    TEXT NOT NULL,
  notes          TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_consents_participant ON consents(participant_id);

-- -------------------------------------------------------------- vitals
CREATE TABLE IF NOT EXISTS vitals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  reading_index  INTEGER NOT NULL DEFAULT 1,
  bp_systolic    INTEGER,
  bp_diastolic   INTEGER,
  pulse          INTEGER,
  weight_kg      REAL,
  height_cm      REAL,
  bmi            REAL,
  temperature_c  REAL,
  spo2           INTEGER,
  arm            TEXT,
  posture        TEXT,
  device_label   TEXT,
  station_id     INTEGER REFERENCES stations(id),
  recorded_at    TEXT NOT NULL,
  recorded_by    TEXT,
  alert_level    TEXT,
  alert_message  TEXT,
  notes          TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_vitals_participant ON vitals(participant_id);
CREATE INDEX IF NOT EXISTS idx_vitals_project ON vitals(project_id);

-- ----------------------------------------------------- glucose results
CREATE TABLE IF NOT EXISTS glucose_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  test_type      TEXT NOT NULL DEFAULT 'CAPILLARY',
  fasting_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  value          REAL NOT NULL,
  unit           TEXT NOT NULL DEFAULT 'mmol/L',
  value_mmol     REAL NOT NULL,
  device_label   TEXT,
  strip_lot      TEXT,
  station_id     INTEGER REFERENCES stations(id),
  tested_at      TEXT NOT NULL,
  operator       TEXT,
  alert_level    TEXT,
  alert_message  TEXT,
  notes          TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_glucose_participant ON glucose_results(participant_id);
CREATE INDEX IF NOT EXISTS idx_glucose_project ON glucose_results(project_id);

-- ------------------------------------------------- clinical encounters
CREATE TABLE IF NOT EXISTS clinical_encounters (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid                TEXT NOT NULL UNIQUE,
  participant_id      INTEGER NOT NULL REFERENCES participants(id),
  project_id          INTEGER NOT NULL REFERENCES projects(id),
  encounter_at        TEXT NOT NULL,
  clinician           TEXT,
  presenting_concerns TEXT,
  history             TEXT,
  examination         TEXT,
  screening_summary   TEXT,
  assessment          TEXT,
  advice              TEXT,
  treatment_given     TEXT,
  counselling_given   TEXT,
  referral_required   INTEGER NOT NULL DEFAULT 0,
  followup_required   INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  is_demo             INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  device_id           TEXT,
  created_by          TEXT,
  updated_by          TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_encounters_participant ON clinical_encounters(participant_id);
CREATE INDEX IF NOT EXISTS idx_encounters_project ON clinical_encounters(project_id);

-- -------------------------------------------------------------- wounds
CREATE TABLE IF NOT EXISTS wounds (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  wound_code     TEXT NOT NULL,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  location       TEXT,
  side           TEXT,
  duration_text  TEXT,
  cause          TEXT,
  status         TEXT NOT NULL DEFAULT 'OPEN',
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT,
  UNIQUE (project_id, wound_code)
);
CREATE INDEX IF NOT EXISTS idx_wounds_participant ON wounds(participant_id);

CREATE TABLE IF NOT EXISTS wound_assessments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid               TEXT NOT NULL UNIQUE,
  wound_id           INTEGER NOT NULL REFERENCES wounds(id),
  participant_id     INTEGER NOT NULL REFERENCES participants(id),
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  assessed_at        TEXT NOT NULL,
  assessed_by        TEXT,
  length_cm          REAL,
  width_cm           REAL,
  depth_cm           REAL,
  area_cm2           REAL,
  tissue_type        TEXT,
  exudate_amount     TEXT,
  exudate_type       TEXT,
  odour              TEXT,
  wound_edge         TEXT,
  surrounding_skin   TEXT,
  infection_signs    TEXT,
  pain_score         INTEGER,
  swelling           TEXT,
  necrosis           TEXT,
  previous_treatment TEXT,
  cleansing_done     TEXT,
  dressing_applied   INTEGER NOT NULL DEFAULT 0,
  dressing_type      TEXT,
  advice             TEXT,
  next_dressing_date TEXT,
  referral_required  INTEGER NOT NULL DEFAULT 0,
  alert_level        TEXT,
  alert_message      TEXT,
  notes              TEXT,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  device_id          TEXT,
  created_by         TEXT,
  updated_by         TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_woundassess_wound ON wound_assessments(wound_id);
CREATE INDEX IF NOT EXISTS idx_woundassess_project ON wound_assessments(project_id);

-- ------------------------------------------------- breast examinations
CREATE TABLE IF NOT EXISTS breast_examinations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid              TEXT NOT NULL UNIQUE,
  participant_id    INTEGER NOT NULL REFERENCES participants(id),
  project_id        INTEGER NOT NULL REFERENCES projects(id),
  examined_at       TEXT NOT NULL,
  examiner          TEXT,
  chaperone_present INTEGER NOT NULL DEFAULT 0,
  breast_examined   TEXT NOT NULL,
  no_abnormality    INTEGER NOT NULL DEFAULT 0,
  lump_present      INTEGER NOT NULL DEFAULT 0,
  lump_side         TEXT,
  lump_location     TEXT,
  lump_size_mm      REAL,
  lump_mobility     TEXT,
  lump_tenderness   TEXT,
  lump_consistency  TEXT,
  nipple_discharge  TEXT,
  skin_change       TEXT,
  nipple_change     TEXT,
  axillary_finding  TEXT,
  pain              TEXT,
  other_finding     TEXT,
  bse_taught        INTEGER NOT NULL DEFAULT 0,
  referral_required INTEGER NOT NULL DEFAULT 0,
  alert_level       TEXT,
  alert_message     TEXT,
  notes             TEXT,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  device_id         TEXT,
  created_by        TEXT,
  updated_by        TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_breast_participant ON breast_examinations(participant_id);
CREATE INDEX IF NOT EXISTS idx_breast_project ON breast_examinations(project_id);

-- ----------------------------------------------- facilities/referrals
CREATE TABLE IF NOT EXISTS facilities (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  project_id     INTEGER REFERENCES projects(id),
  name           TEXT NOT NULL,
  facility_type  TEXT,
  location       TEXT,
  phone          TEXT,
  contact_person TEXT,
  services       TEXT,
  notes          TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT
);

CREATE TABLE IF NOT EXISTS referrals (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid                TEXT NOT NULL UNIQUE,
  referral_code       TEXT NOT NULL,
  participant_id      INTEGER NOT NULL REFERENCES participants(id),
  project_id          INTEGER NOT NULL REFERENCES projects(id),
  referral_date       TEXT NOT NULL,
  source_module       TEXT,
  reason              TEXT NOT NULL,
  clinical_summary    TEXT,
  urgency             TEXT NOT NULL DEFAULT 'ROUTINE',
  facility_id         INTEGER REFERENCES facilities(id),
  facility_name       TEXT,
  referring_clinician TEXT,
  instructions        TEXT,
  transport_required  INTEGER NOT NULL DEFAULT 0,
  transport_notes     TEXT,
  status              TEXT NOT NULL DEFAULT 'RECOMMENDED',
  status_updated_at   TEXT,
  notes               TEXT,
  is_demo             INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  device_id           TEXT,
  created_by          TEXT,
  updated_by          TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  deleted_at          TEXT,
  UNIQUE (project_id, referral_code)
);
CREATE INDEX IF NOT EXISTS idx_referrals_participant ON referrals(participant_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(project_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_urgency ON referrals(project_id, urgency);

-- ----------------------------------------------------------- followups
CREATE TABLE IF NOT EXISTS followups (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid               TEXT NOT NULL UNIQUE,
  participant_id     INTEGER NOT NULL REFERENCES participants(id),
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  referral_id        INTEGER REFERENCES referrals(id),
  reason             TEXT,
  due_date           TEXT,
  contact_attempts   INTEGER NOT NULL DEFAULT 0,
  last_contact_at    TEXT,
  contact_method     TEXT,
  outcome            TEXT NOT NULL DEFAULT 'PENDING',
  facility_attended  TEXT,
  further_treatment  TEXT,
  next_followup_date TEXT,
  closed_at          TEXT,
  notes              TEXT,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  device_id          TEXT,
  created_by         TEXT,
  updated_by         TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_followups_outcome ON followups(project_id, outcome);
CREATE INDEX IF NOT EXISTS idx_followups_due ON followups(due_date);

-- -------------------------------------------------------- queue events
CREATE TABLE IF NOT EXISTS queue_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  station_id     INTEGER REFERENCES stations(id),
  occurred_at    TEXT NOT NULL,
  actor          TEXT,
  notes          TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_queue_participant ON queue_events(participant_id);
CREATE INDEX IF NOT EXISTS idx_queue_project_time ON queue_events(project_id, occurred_at);

-- ----------------------------------------------------------- suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  project_id     INTEGER REFERENCES projects(id),
  name           TEXT NOT NULL,
  contact_person TEXT,
  phone          TEXT,
  address        TEXT,
  notes          TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT
);

-- --------------------------------------------------------- budget base
CREATE TABLE IF NOT EXISTS budget_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid       TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_demo    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  device_id  TEXT,
  created_by TEXT,
  updated_by TEXT,
  version    INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  UNIQUE (project_id, name)
);

-- ----------------------------------------------------------- inventory
CREATE TABLE IF NOT EXISTS inventory_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid          TEXT NOT NULL UNIQUE,
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'unit',
  opening_qty   REAL NOT NULL DEFAULT 0,
  qty_purchased REAL NOT NULL DEFAULT 0,
  qty_used      REAL NOT NULL DEFAULT 0,
  min_stock     REAL NOT NULL DEFAULT 0,
  supplier_id   INTEGER REFERENCES suppliers(id),
  unit_cost     REAL,
  batch_number  TEXT,
  expiry_date   TEXT,
  is_medical    INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  device_id     TEXT,
  created_by    TEXT,
  updated_by    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_inventory_project ON inventory_items(project_id, category);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid          TEXT NOT NULL UNIQUE,
  item_id       INTEGER NOT NULL REFERENCES inventory_items(id),
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  txn_type      TEXT NOT NULL,
  quantity      REAL NOT NULL,
  balance_after REAL,
  reason        TEXT,
  station_id    INTEGER REFERENCES stations(id),
  occurred_at   TEXT NOT NULL,
  actor         TEXT,
  notes         TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  device_id     TEXT,
  created_by    TEXT,
  updated_by    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_invtxn_item ON inventory_transactions(item_id, occurred_at);

-- --------------------------------------------------------- procurement
CREATE TABLE IF NOT EXISTS procurement (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid               TEXT NOT NULL UNIQUE,
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  code               TEXT,
  item_name          TEXT NOT NULL,
  inventory_item_id  INTEGER REFERENCES inventory_items(id),
  quantity           REAL NOT NULL DEFAULT 0,
  unit               TEXT,
  estimated_cost     REAL,
  actual_cost        REAL,
  supplier_id        INTEGER REFERENCES suppliers(id),
  request_date       TEXT,
  approved_by        TEXT,
  approval_date      TEXT,
  purchase_date      TEXT,
  delivery_status    TEXT NOT NULL DEFAULT 'PENDING',
  payment_status     TEXT NOT NULL DEFAULT 'UNPAID',
  status             TEXT NOT NULL DEFAULT 'REQUESTED',
  budget_category_id INTEGER REFERENCES budget_categories(id),
  notes              TEXT,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  device_id          TEXT,
  created_by         TEXT,
  updated_by         TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_procurement_project ON procurement(project_id, status);

CREATE TABLE IF NOT EXISTS budget_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid             TEXT NOT NULL UNIQUE,
  project_id       INTEGER NOT NULL REFERENCES projects(id),
  category_id      INTEGER NOT NULL REFERENCES budget_categories(id),
  description      TEXT NOT NULL,
  budget_amount    REAL NOT NULL DEFAULT 0,
  committed_amount REAL NOT NULL DEFAULT 0,
  notes            TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  device_id        TEXT,
  created_by       TEXT,
  updated_by       TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_budgetitems_cat ON budget_items(category_id);

CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  category_id    INTEGER REFERENCES budget_categories(id),
  budget_item_id INTEGER REFERENCES budget_items(id),
  procurement_id INTEGER REFERENCES procurement(id),
  description    TEXT NOT NULL,
  amount         REAL NOT NULL,
  spent_at       TEXT NOT NULL,
  paid_to        TEXT,
  receipt_ref    TEXT,
  recorded_by    TEXT,
  notes          TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT,
  created_by     TEXT,
  updated_by     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id, spent_at);

-- --------------------------------------------- mobilisation, logistics
CREATE TABLE IF NOT EXISTS mobilisation_activities (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid               TEXT NOT NULL UNIQUE,
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  activity           TEXT NOT NULL,
  activity_type      TEXT,
  activity_date      TEXT,
  location           TEXT,
  organisation       TEXT,
  responsible_person TEXT,
  expected_reach     INTEGER,
  actual_reach       INTEGER,
  cost               REAL,
  status             TEXT NOT NULL DEFAULT 'PLANNED',
  notes              TEXT,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  device_id          TEXT,
  created_by         TEXT,
  updated_by         TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  deleted_at         TEXT
);

CREATE TABLE IF NOT EXISTS logistics_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid               TEXT NOT NULL UNIQUE,
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  name               TEXT NOT NULL,
  category           TEXT,
  quantity_needed    TEXT,
  status             TEXT NOT NULL DEFAULT 'REQUIRED',
  responsible_person TEXT,
  phone              TEXT,
  cost               REAL,
  notes              TEXT,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  device_id          TEXT,
  created_by         TEXT,
  updated_by         TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  deleted_at         TEXT
);

CREATE TABLE IF NOT EXISTS event_checklists (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid         TEXT NOT NULL UNIQUE,
  project_id   INTEGER NOT NULL REFERENCES projects(id),
  title        TEXT NOT NULL,
  category     TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_mandatory INTEGER NOT NULL DEFAULT 0,
  is_done      INTEGER NOT NULL DEFAULT 0,
  done_at      TEXT,
  done_by      TEXT,
  notes        TEXT,
  is_demo      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  device_id    TEXT,
  created_by   TEXT,
  updated_by   TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  deleted_at   TEXT
);

-- --------------------------------------- clinical configuration, audit
CREATE TABLE IF NOT EXISTS clinical_configurations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid        TEXT NOT NULL UNIQUE,
  project_id  INTEGER REFERENCES projects(id),
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  value_type  TEXT NOT NULL DEFAULT 'NUMBER',
  label       TEXT,
  description TEXT,
  group_name  TEXT,
  unit        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  device_id   TEXT,
  created_by  TEXT,
  updated_by  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT NOT NULL UNIQUE,
  occurred_at    TEXT NOT NULL,
  user_id        INTEGER,
  username       TEXT,
  user_role      TEXT,
  action         TEXT NOT NULL,
  entity_type    TEXT,
  entity_id      TEXT,
  summary        TEXT,
  previous_value TEXT,
  new_value      TEXT,
  device_id      TEXT,
  project_id     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS backups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid          TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  filename      TEXT NOT NULL,
  size_bytes    INTEGER,
  encrypted     INTEGER NOT NULL DEFAULT 1,
  checksum      TEXT,
  record_counts TEXT,
  created_by    TEXT,
  kind          TEXT NOT NULL DEFAULT 'MANUAL',
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_backups_time ON backups(created_at);

-- ---------------------------------------------------------------------------
-- Clinical photographs (spec S31).
--
-- A photograph of a wound or a breast lesion is identifiable patient data of
-- the most sensitive kind, so three rules are enforced in code rather than
-- left to habit:
--
--   1. Nothing is captured without a recorded PHOTOGRAPHY consent for that
--      participant. Consent for care is not consent to be photographed.
--   2. The image is stored inside the local database, never in the device
--      gallery, so it leaves with an encrypted backup and with nothing else.
--   3. It is not synchronised unless an administrator turns that on. A
--      photograph is the one record whose default is that it never leaves
--      the device that took it.
--
-- The image itself is a downscaled JPEG held as base64 in image_data.
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
