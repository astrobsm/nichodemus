# Database documentation

**Nichodemus Ugbor Memorial Community Health Outreach Management System**

SQLite, held on the device. Schema defined in `src/db/schema.sql`, applied by
the versioned migrations in `src/db/migrations.ts`.

---

## 1. Conventions

### The sync envelope

Every substantive table carries these columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | INTEGER PK | Local autoincrement key |
| `uuid` | TEXT UNIQUE | Globally unique identity |
| `created_at` | TEXT | ISO-8601 local time with offset |
| `updated_at` | TEXT | ISO-8601 local time with offset |
| `device_id` | TEXT | Device that last wrote the row |
| `created_by` | TEXT | Username that created it |
| `updated_by` | TEXT | Username that last updated it |
| `version` | INTEGER | Incremented on every update |
| `deleted_at` | TEXT NULL | Soft deletion timestamp; NULL means live |

Clinical rows are **never** hard-deleted. `deleted_at` is set and every read
path filters on `deleted_at IS NULL`.

### Timestamps

ISO-8601 in device local time with an explicit offset:
`2026-12-29T09:41:07+01:00`. Dates alone are `YYYY-MM-DD`. Never compare a
timestamp with a bare date string; compare instants.

### Booleans

Stored as INTEGER 0/1. Helpers `boolInt()` and `toBool()` in
`src/db/repo/base.ts`.

### Demonstration data

Tables that can hold practice records carry `is_demo INTEGER NOT NULL DEFAULT
0`. Clearing demonstration data deletes only `is_demo = 1` rows.

---

## 2. Entity relationships

```
projects
   ├── stations                (station_id referenced by queue, vitals, glucose)
   ├── team_members ── attendance
   │        └── users.team_member_id
   ├── tasks
   ├── event_checklists
   ├── logistics_items
   ├── mobilisation_activities
   ├── budget_categories ── budget_items ── expenses
   ├── suppliers ── inventory_items ── inventory_transactions
   │                      └── procurement
   └── participants
            ├── consents
            ├── vitals                  (many per participant: repeat readings)
            ├── glucose_results
            ├── clinical_encounters
            ├── wounds ── wound_assessments
            ├── breast_examinations
            ├── referrals ──┐
            ├── followups ──┘           (followups.referral_id)
            └── queue_events

roles ── role_permissions ── permissions
users → roles

audit_logs, backups, app_settings, clinical_configurations, schema_migrations
```

---

## 3. Tables

### `projects`

One row per outreach. `participant_prefix` (default `NUG`) drives every
generated code. `status` is one of PLANNING, APPROVAL_PENDING, APPROVED,
PREPARATION, ACTIVE, COMPLETED, FOLLOW_UP, CLOSED.

Creating a project also seeds nine stations, a 19-item event checklist, a
14-item logistics list and 15 budget categories.

### `participants`

The centre of the clinical model.

| Column | Notes |
| --- | --- |
| `participant_code` | `NUG-0001`. Unique per project. |
| `serial_no` | Integer sequence, unique per project. Read inside the transaction that creates the row. |
| `age_years`, `age_is_estimated` | Age from date of birth when known, otherwise a stated approximate age. |
| `workflow_status` | Current stage of the journey. |
| `search_key` | Normalised lowercase alphanumerics of the names plus phone digits. Indexed; drives offline search and duplicate detection. |
| `duplicate_override_by`, `duplicate_override_reason` | Set when a duplicate warning was overridden. |

Constraints: `UNIQUE (project_id, participant_code)`,
`UNIQUE (project_id, serial_no)`.

Indexes: `search_key`; `(project_id, workflow_status)`; `phone`;
`(last_name, first_name)`.

### `vitals`

**One row per reading.** `reading_index` is 1, 2, 3 … per participant. A repeat
blood pressure inserts a new row; it never updates the previous one.

`bmi` is computed on write. `alert_level` and `alert_message` store the alert
the rule engine produced **at the time of entry**, so a later threshold change
does not rewrite history.

### `glucose_results`

`value` and `unit` store what was entered; `value_mmol` stores the normalised
mmol/L value that thresholds are compared against, so mg/dL entries are
comparable without repeated conversion.

`fasting_status` is FASTING, NON_FASTING or UNKNOWN and selects which threshold
pair applies.

### `clinical_encounters`

Free-text consultation record with structured fields where they help.
`screening_summary` snapshots the screening findings shown to the clinician.

### `wounds` and `wound_assessments`

A wound is the thing; an assessment is one examination of it. `area_cm2` is
length × width, stored and labelled as approximate.

`alert_level` is derived from infection signs, necrosis, odour, pain score,
surface area and exudate volume against the configured thresholds.

### `breast_examinations`

Structured findings. `no_abnormality` is the fast path. `referral_required` is
set by the rule engine. There is no column, and no code path, that classifies a
finding as malignant.

### `referrals`

`referral_code` is `NUG-REF-0001`, unique per project.

`status`: RECOMMENDED, ISSUED, PATIENT_INFORMED, ATTENDED, NOT_ATTENDED,
COMPLETED, CANCELLED, UNKNOWN.
`urgency`: ROUTINE, PRIORITY, URGENT, EMERGENCY.

Creating a referral creates a matching `followups` row in the same transaction
unless explicitly suppressed.

### `followups`

`outcome`: PENDING, CONTACTED, ATTENDED_FACILITY, NOT_ATTENDED, UNREACHABLE,
DECLINED, COMPLETED. Recording an outcome also updates the linked referral's
status, in the same transaction, so the two cannot disagree.

`due_date` is set from the configured follow-up interval for the referral's
urgency.

### `queue_events`

Append-only movement log: `from_status`, `to_status`, `station_id`,
`occurred_at`, `actor`. Drives the History tab and throughput analysis.

### `inventory_items` and `inventory_transactions`

Remaining stock is derived, never stored:

```
remaining = opening_qty + qty_purchased - qty_used
```

Every movement writes an `inventory_transactions` row with `balance_after` and
updates the item totals in one transaction. Issuing expired stock is refused at
the repository level; wastage is still allowed so it can be written off.

### `procurement`

Receiving a procurement linked to an inventory item adds the quantity to stock
and writes the stock transaction in the same transaction as the status change.

### `budget_categories`, `budget_items`, `expenses`

Budget per category, expenditure per expense. `budgetSummary()` derives budget,
committed, spent and balance per category with SQL aggregation, and adds
uncategorised expenses into the totals so nothing is silently omitted.

### `clinical_configurations`

One row per threshold, keyed by the `ClinicalThresholds` field name. Seeded
with defaults on first run. Every change writes an audit row with previous and
new value, and updates `clinical.config_updated_at` / `_by` in `app_settings`.

### `audit_logs`

| Column | Notes |
| --- | --- |
| `occurred_at`, `username`, `user_role` | Who and when |
| `action` | LOGIN, LOGIN_FAILED, CREATE, UPDATE, SOFT_DELETE, REFERRAL_CREATE, REFERRAL_STATUS_CHANGE, CONFIG_CHANGE, BACKUP_CREATE, BACKUP_RESTORE, EXPORT, DUPLICATE_OVERRIDE, PROJECT_CLOSE, … |
| `entity_type`, `entity_id` | Which record |
| `previous_value`, `new_value` | JSON diff of changed fields only |
| `device_id`, `project_id` | Context |

Not soft-deleted and not editable through the application. Patient names are
deliberately never written here.

### `users`, `roles`, `permissions`, `role_permissions`

`users` stores `pin_hash`, `pin_salt` and `pin_iterations` — never a PIN.
`failed_attempts` and `locked_until` implement the lockout.

Roles and permissions are re-seeded from `src/core/permissions.ts` on every
start, so a permission added in a new build reaches existing databases without
a schema bump.

### `app_settings`

Key/value. Keys are listed in `SETTING_KEYS` in `src/core/constants.ts`:
setup completion, active project, session timeout, last backup, backup reminder
interval, demo mode, clinical config provenance.

### `backups`

A record that a backup was taken: filename, size, checksum of the plaintext,
record counts, who and when. The backup files themselves live wherever the
administrator saved them.

---

## 4. Migrations

```ts
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'baseline schema', up: () => exec(baselineSql) },
  { version: 2, name: 'seed roles, permissions and clinical thresholds', up: ... },
]
```

Each migration runs inside one transaction and records itself in
`schema_migrations`. An interrupted upgrade either applies completely or not at
all. `migrate()` is idempotent and runs on every start.

To add a migration: append an entry with the next version number. Never edit an
applied migration — existing devices have already run it.

---

## 5. Integrity

- `PRAGMA foreign_keys = ON` is set on open and after every migration.
- Unique constraints prevent duplicate participant, referral, wound, staff and
  station codes.
- `PRAGMA integrity_check` and `PRAGMA foreign_key_check` are available from
  Settings → About, and run automatically before a backup is restored.
- Every multi-row write is transactional.

---

## 6. Querying safely

All access goes through `src/db/sqlite.ts`, which uses prepared statements with
bound parameters:

```ts
query<Participant>(
  'SELECT * FROM participants WHERE project_id = ? AND workflow_status = ?',
  [projectId, status],
)
```

String interpolation into SQL appears nowhere in the repositories. Table names
in the small number of generic helpers come from internal constants, never from
user input.

---

## 7. Reporting

Every figure shown or printed is derived with SQL in
`src/db/repo/analytics.ts`. Nothing is tallied by hand in the UI.

One rule worth stating explicitly: **abnormal-finding figures count people, not
readings.** A participant with three elevated blood pressure readings is one
participant with an elevated screening finding:

```sql
SELECT COUNT(DISTINCT participant_id) FROM vitals
 WHERE project_id = ? AND deleted_at IS NULL
   AND alert_level IN ('ATTENTION', 'URGENT')
```

`tests/operations.test.ts` asserts this directly.

---

## 8. Growth

Approximate sizes for a 500-participant outreach:

| Data | Rows | Size |
| --- | --- | --- |
| Participants | 500 | ~250 KB |
| Vitals (with repeats) | ~700 | ~150 KB |
| Glucose | ~450 | ~90 KB |
| Consultations | ~450 | ~200 KB |
| Referrals and follow-ups | ~120 | ~40 KB |
| Audit log | ~4,000 | ~600 KB |
| **Total** | | **under 2 MB** |

Measured at 1,000 participants the database stays under 4 MB, comfortably
within any device's storage and fast enough to flush on every write.
