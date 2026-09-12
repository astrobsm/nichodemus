# Architecture

**Nichodemus Ugbor Memorial Community Health Outreach Management System**

---

## 1. The governing constraint

The application must run the complete outreach — planning through post-event
follow-up — on a single phone with no internet connection. Everything else
follows from that.

This is not an online application that caches. **The local SQLite database is
the source of truth.** There is no server, no API client, no sync queue and no
authentication provider. Nothing in the codebase makes an outbound network
request.

---

## 2. Layers

```
                    React UI  (mobile-first, role-aware)
                          │
                Application state  (src/ui/AppState.tsx)
                          │
   ┌──────────────────────┼──────────────────────────┐
   │                      │                          │
Repositories        Domain core                  Services
(src/db/repo)      (src/core)                 (src/services)
   │                      │                          │
   │            validation, clinical rules,   backup, export,
   │            permissions, audit, ids,      PDF, demo data,
   │            date/time, crypto             file I/O
   │
SQLite engine  (src/db/sqlite.ts — sql.js, SQLite compiled to WebAssembly)
   │
Persistence  (src/db/persistence.ts — OPFS, falling back to IndexedDB)
   │
Device storage
```

Rules that keep the layers honest:

- The UI never writes SQL. It calls repository functions.
- Repositories never render. They return plain data.
- The clinical rule engine is pure: thresholds in, an alert out. It touches
  neither the database nor the DOM, which is what makes it straightforward to
  test and to reason about clinically.
- Services compose repositories; repositories do not call services.

---

## 3. Why SQLite in WebAssembly

The specification calls for an embedded relational database on the device.
sql.js is SQLite itself — the same C library, the same query planner, the same
`PRAGMA integrity_check` — compiled to WebAssembly. It gives us real foreign
keys, real transactions, real indexes and a real `.sqlite` file.

The database image is held in memory and flushed to device storage after every
committed write.

### Why not IndexedDB directly

IndexedDB is a key-value store. Producing the analytics this project needs —
"count participants, not readings, whose blood pressure alert was ATTENTION or
URGENT, grouped by age band" — would mean reimplementing a query engine in
JavaScript. SQLite already has one.

### Why not a native SQLite plugin

It would work, and the Capacitor build could use one. But it would tie the
application to a native build toolchain, and version 1 needs to be installable
from a phone browser with no Android SDK anywhere. The persistence layer is a
separate module precisely so a native driver can be slotted in later.

---

## 4. Durability

This is the part that matters most in a field setting with unreliable power.

### Transactions

```ts
await transaction(async () => {
  const id = insertRow('participants', { ... })
  insertRow('consents', { participant_id: id, ... })
  insertRow('queue_events', { participant_id: id, ... })
  audit({ action: 'CREATE', entityType: 'participant', entityId: id })
})
```

The participant, their consent, their first queue event and the audit entry
commit together or not at all. A crash halfway cannot leave a participant
without consent, and cannot consume a participant number — the serial is read
inside the transaction, so two rapid registrations can never collide.

### Flushing

`transaction()` writes the SQLite image to device storage **on commit**, before
it returns. A caller that has been told the save succeeded knows it is on disk.

Concurrent flushes coalesce onto a single trailing write, so a burst of
inserts produces one file write, but no caller returns early.

The application also flushes on `visibilitychange` and `pagehide` — when the
user switches app or the phone locks.

### Atomic file writes

On OPFS the image is written to a temporary file and then moved into place. A
crash between the two leaves the temporary file, which `openBytes` recovers on
the next start. On IndexedDB a single `put` is atomic by definition.

### Corruption

`openDatabase` probes the restored image and raises a clear error rather than
failing halfway through the first clinical write. `replaceDatabase` runs
`PRAGMA integrity_check` on a candidate backup **before** replacing anything —
a corrupt backup is refused and the live database is untouched.

---

## 5. The clinical rule engine

`src/core/clinicalRules.ts` is the only place that decides whether something is
abnormal. It is pure, and every threshold is a parameter read from the
`clinical_configurations` table.

```ts
evaluateBloodPressure(systolic, diastolic, thresholds) → Alert
evaluateGlucose(valueMmol, fastingStatus, thresholds)  → Alert
evaluateWound(signals, thresholds)                     → Alert
evaluateBreast(signals, thresholds)                    → Alert
```

An `Alert` carries a level (`NORMAL`/`INFO`/`ATTENTION`/`URGENT`), a title, a
message written for a clinician to read aloud, whether a referral is suggested,
and at what urgency.

Three design decisions that exist for clinical safety:

1. **No threshold is hard-coded as policy.** The defaults are seeded into the
   database on first run, and a clinical administrator can change any of them.
   Every change is audited with the previous and new value.

2. **Alerts are stored with the record.** `vitals.alert_level` and
   `vitals.alert_message` hold what the clinician was shown at the time.
   Changing a threshold next week does not rewrite last week's record.

3. **The language never crosses into diagnosis.** The engine emits "elevated
   blood pressure screening measurement", "abnormal glucose screening result
   requiring further assessment", "abnormal finding identified … not a
   diagnosis". It never emits "hypertension", "diabetes" or "cancer". Tests
   assert this.

---

## 6. Security

| Concern | Approach |
| --- | --- |
| Authentication | PBKDF2-SHA256, 150,000 iterations, random 16-byte per-user salt. PINs are never stored. Constant-time comparison. |
| Brute force | Five failed attempts locks the account for five minutes. |
| Session | Configurable inactivity lock; PIN required to resume. |
| Authorisation | Role-based permissions from a single source of truth (`src/core/permissions.ts`), used by both the seeder and every UI check. |
| Backups | AES-256-GCM under a PBKDF2 key, 250,000 iterations. Integrity is authenticated: a tampered file fails to decrypt. |
| Identifiable data | Exports and reports are de-identified unless the user holds `reports.identifiable` and explicitly opts in. |
| Audit | Every significant action, with before/after values. Patient names are deliberately excluded from audit entries. |
| Deletion | Clinical records are soft-deleted with a reason and an actor. |
| Logs | No patient data is written to the console or into error messages. |

All cryptography uses the platform WebCrypto implementation. Nothing is
hand-rolled except the backup container framing, which is documented in
`src/core/crypto.ts`.

---

## 7. Offline behaviour

A service worker caches the application shell — HTML, JavaScript, CSS, the
SQLite WebAssembly binary and icons. It caches **only application files**;
patient data lives in OPFS/IndexedDB and never enters a cache, a request or a
response.

The application never displays "no internet". It shows:

> Offline mode — all data is being stored securely on this device.

and carries on. When a connection reappears, nothing is uploaded — network
availability changes the status line and nothing else. Any future
synchronisation would be an explicitly authorised feature, not a silent one.

---

## 8. Designed for a synchronisation that does not exist yet

Every substantive table carries the same envelope:

| Column | Purpose |
| --- | --- |
| `uuid` | Globally unique identity, independent of the local autoincrement |
| `created_at`, `updated_at` | ISO-8601 local time with offset |
| `device_id` | Which device wrote the row |
| `created_by`, `updated_by` | Which user |
| `version` | Incremented on every update, for conflict detection |
| `deleted_at` | Soft deletion, so a deletion can itself be replicated |

Version 1 does not synchronise. But a future device-to-device merge needs no
schema change, which was the point.

---

## 9. State management

No state library. `AppState.tsx` holds a small context: boot phase, session,
active project, cached clinical thresholds, lock state and a `dataVersion`
counter.

`useQuery(fn, deps)` re-runs a database read whenever `dataVersion` changes.
After a write, the caller calls `refresh()` and every dependent view re-reads.

This is deliberately simple. SQLite reads are sub-millisecond at this data
volume; a cache-invalidation layer would add risk without adding speed.

---

## 10. Performance

`tests/performance.test.ts` seeds 1,000 participants with roughly 4,500
clinical records and asserts hard timing budgets:

| Operation | Budget |
| --- | --- |
| Search by name | 400 ms |
| Search by participant code | 400 ms |
| Filtered count and list | 500 ms |
| Dashboard figures | 800 ms |
| Full analytics set | 1,500 ms |
| Referral list | 500 ms |

Actual measurements are far below these. Indexes cover the search key, the
participant code, telephone, names, and every foreign key used for counting.

---

## 11. Layout of the code

```
src/
  core/            pure domain logic, no database and no React
    clinicalRules.ts   configurable alert engine
    constants.ts       vocabularies shared by seed, UI and reports
    crypto.ts          PIN hashing, encrypted backups
    datetime.ts        local-time ISO handling, age calculation
    ids.ts             UUIDs, participant codes, search keys
    permissions.ts     roles and permissions, single source of truth
    validation.ts      field validation with plain-language messages
    audit.ts           the audit trail

  db/
    schema.sql         the baseline schema
    migrations.ts      versioned, transactional migrations
    sqlite.ts          engine, queries, transactions, flushing
    persistence.ts     OPFS / IndexedDB
    repo/              one repository per domain area

  services/
    backup.ts          encrypted backup and restore
    exporter.ts        CSV datasets with permission-aware de-identification
    pdfReport.ts       fifteen on-device PDF reports
    demoData.ts        demonstration data, generated and removable
    fileIo.ts          file picker with a download fallback

  ui/
    AppState.tsx       boot, session, lock, project
    router.tsx         hash router
    components/ui.tsx  shared presentational components
    screens/           one file per major area

  scripts/
    build-apk.mjs      one-command Android build, toolchain discovery included
    serve-lan.mjs      serves the build to a phone for browser installation
    android-icons.mjs  launcher icons, generated not vendored
    copy-wasm.mjs      publishes the SQLite binaries into public/

tests/               88 tests against a real SQLite database
docs/                these documents
```

---

## 12. Android packaging

The same build serves both delivery routes. `npm run apk` wraps `dist/` with
Capacitor and produces a signed debug APK; `npm run serve` hands the identical
files to a phone browser. Neither changes a line of application code.

Three details matter for the native build:

**`androidScheme: 'https'`.** Capacitor can serve the WebView over `http://` or
`https://localhost`. It must be `https`, because `crypto.subtle` — which hashes
every PIN and encrypts every backup — and OPFS, which stores the database, are
both restricted to secure contexts. Over `http` the application would fail at
its first sign-in. No network is involved either way; the scheme only decides
what the WebView considers trustworthy.

**File saving needs a native path.** An Android WebView silently ignores
`<a download>` on a blob URL. Left alone, a backup would report success and
produce no file — the worst possible failure for the one function the whole
recovery story depends on. `src/services/fileIo.ts` therefore detects Capacitor
and writes through the Filesystem plugin into `Documents/NUG Outreach`, then
offers the share sheet so a backup can be moved off the device immediately.
The browser routes are unchanged.

**Java toolchain.** Capacitor 8 compiles against Java 21. `scripts/build-apk.mjs`
searches for a suitable JDK — including ones Gradle has already provisioned
under `~/.gradle/jdks` — and adds the Foojay toolchain resolver to
`settings.gradle` so Gradle can fetch one itself. A machine with only JDK 17
otherwise fails deep in the build with `invalid source release: 21`, which says
nothing useful about what to install.

---

## 13. Optional cloud synchronisation

Added without disturbing principle 1: the local database is still the source
of truth, and nothing in the sync path sits between a clinician and a record.

### Change capture

`insertRow` and `updateRow` in `db/repo/base.ts` are the single choke point
every repository already writes through. Both record the changed row in
`sync_outbox`. A new repository therefore cannot forget to register its
changes — the alternative, remembering to call a tracker in thirty places,
fails silently and loses clinical records.

### Identity across devices

Primary keys are local autoincrement integers: device A's participant 12 is
not device B's. Rows are matched on `uuid` and the local `id` is never
transmitted. Foreign keys are translated to the referenced row's uuid on the
way out (`participant_id` becomes `participant_id__ref`) and resolved back to
a local id on the way in. A record whose parent has not arrived yet is
deferred and retried rather than dropped.

### Conflicts

Last-write-wins, computed by the same function (`incomingWins`) on the device
and on the server so the two can never disagree: higher `version`, then later
`updated_at` compared as instants, then `uuid` as a deterministic tie-break.

Two consequences shaped the code:

- **Soft deletion increments the version.** It did not originally, which meant
  a deletion carried the same version as the row it deleted and could lose the
  comparison — the record would quietly come back. Caught by the two-device
  test.
- **Timestamps carry milliseconds.** At one-second resolution two edits in the
  same second tie, and the tie-break falls through to uuid ordering, which is
  arbitrary rather than correct.

### Participant numbers

Two devices registering offline would both issue NUG-0001. Each device is
given a block of ten thousand numbers instead (`sync.serial_block`), so the
familiar format is unchanged and no coordination is needed at the moment of
registration. Project codes are derived from the project's uuid for the same
reason — a counter produces `PRJ-001` on every device.

### Trust boundary

Devices never hold Turso credentials. They call `/api/sync` on Vercel with a
shared `SYNC_TOKEN`; the database URL and auth token live only in server
environment variables. Revoking a lost phone is a matter of changing one
environment variable.

---

## 14. Decisions worth recording

**Hash routing.** The app must work when opened from a home-screen shortcut
with no server able to rewrite paths. Hash routes always resolve.

**No CSS framework.** The design system is about 700 lines of CSS with explicit
48px touch targets and a status system that never relies on colour alone —
every state carries a glyph and a word, for accessibility and for bright
sunlight.

**Colocated section state.** The registration form keeps its five sections in
component state rather than a store, because the whole form is one transaction.

**Both sql.js WASM variants are shipped.** The build publishes
`sql-wasm-browser.wasm` and `sql-wasm.wasm`, because which one a bundler
resolves depends on its export conditions. A missing binary would surface only
at runtime, on a device, in the field — the worst possible place to discover
it. The cost is 650 KB in the install; the alternative is an app that will not
start.
