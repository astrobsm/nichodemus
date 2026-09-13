# Nichodemus Ugbor Memorial Community Health Outreach

**Offline-first management system for a community health outreach at Umunna
community, Umuhu village, Owelli Court, Awgu Local Government Area, Enugu
State — last week of December 2026, approximately 500 beneficiaries.**

The complete outreach — planning, event-day operations, clinical records,
referral, follow-up and final reporting — runs on a single mobile phone with no
internet connection, no mobile data and no server.

---

## Ways to run it

| | Command | Result |
| --- | --- | --- |
| **Android app** | `npm run apk` | An installable `.apk` |
| **Phone, from the browser** | `npm run serve` | Installed from Chrome, no Android tooling |
| **Desktop** | `npm run desktop:build` | A Windows installer (macOS/Linux targets configured) |
| **Hosted** | `npm run cloud:deploy` | The app on Vercel, with optional multi-device sync |

All four are the same application with the same local database. Cloud sync is
optional and never required to run the outreach.

## Get the app onto a phone

Two routes, one command each.

```bash
npm install

npm run apk                # builds release/nug-outreach-1.0.0-debug-<date>.apk
npm run apk -- --install   # ...and pushes it to a phone over USB
```

`npm run apk` finds your JDK and Android SDK itself, creates the Android
project on first run, generates the launcher icons and hands you a finished
APK. Android Studio is not needed. If something is missing it tells you exactly
what to install.

No Android tooling on the machine? Install it from the browser instead:

```bash
npm run build
npm run serve              # prints the Wi-Fi address to open on the phone
npm run serve -- --usb     # over a cable, and enables the real "Install app" prompt
```

Either way the result is the same offline application. Full detail, including
signing a release build: **[docs/INSTALL.md](docs/INSTALL.md)**.

## Desktop and cloud

```bash
npm run desktop            # run the desktop application now
npm run desktop:build      # → release/desktop/NUG-Outreach-Setup-1.0.0.exe

npm run cloud:setup        # create the Turso tables (free tier)
npm run cloud:deploy       # deploy the app and /api/sync to Vercel

npm run release            # build all three from one commit, and publish
```

`npm run release` is how an update reaches devices that are already in use.
It builds the web application, the Android package and the desktop installer
from the same commit so that all three carry one build identity, then deploys
and publishes them. Browser and home-screen copies download the update in the
background and offer it; desktop copies install on next close; Android copies
offer a one-tap download, because Android does not permit a sideloaded app to
install an update unattended.

Once the outreach is in the cloud, every other member of staff opens the same
web address and signs in with the username and PIN the administrator gave
them. No wizard, no device key, and each device is reserved its own
participant-number block automatically.

Full walkthrough: **[docs/CLOUD.md](docs/CLOUD.md)**.

## Developing

```bash
npm run dev        # http://localhost:5173
npm run build      # dist/ — the web application, ~2 MB
npm test           # 240 tests against a real SQLite database
npm run typecheck
```

---

## What it does

| Module | |
| --- | --- |
| Project management | Details, status lifecycle, objectives, closure |
| Tasks | Assignment, priority, due dates, overdue tracking |
| Team and volunteers | Roster, roles, stations, shifts, daily attendance |
| Community mobilisation | Activities, expected and actual reach, cost |
| Event planning | 19-item checklist with mandatory items, 14-item logistics list |
| Participant registration | Automatic IDs, duplicate detection, consent |
| Screening | Blood pressure with repeat readings, capillary glucose |
| Clinical consultation | Structured and free-text documentation |
| Wound care | Measurement, characteristics, dressing, approximate surface area |
| Breast health | Private structured examination with referral prompts |
| Referrals | Offline facility directory, urgency, status tracking |
| Follow-up | Automatic queue, contact attempts, outcomes, overdue flags |
| Inventory | Stock movement, low-stock and expiry control |
| Procurement | Requests through to delivery, feeding stock automatically |
| Budget | Budget against expenditure by category |
| Event-day operations | Station queues, live dashboard, urgent alert list |
| Analytics | Reach, demographics, screening findings, referral rate, data quality |
| Reports | 15 PDF reports and 16 CSV datasets, generated on the device |
| Backup and restore | AES-256-GCM encrypted backup files |
| Security and audit | PIN authentication, nine roles, app lock, full audit trail |

---

## The two principles everything else follows from

### 1. The local database is the source of truth

Real SQLite — the same C library, compiled to WebAssembly — with foreign keys,
transactions, indexes and `PRAGMA integrity_check`. It is written to the
device's own filesystem (OPFS, falling back to IndexedDB) after every committed
write, before the caller is told the save succeeded.

Registration, screening and every clinical record work with no connection at
all. Cloud sync, when it is configured, is a reconciliation that runs
afterwards — never on the path of caring for somebody. With sync switched off
the application makes no outbound network request whatsoever.

### 2. Screening findings are not diagnoses

The application records that a blood pressure screening measurement was
elevated. It does not record that somebody has hypertension. It records an
abnormal glucose screening result requiring confirmatory testing, not diabetes.
It records a breast lump as a clinical finding and a referral indication, and
has no code path that calls anything cancer.

Every alert threshold is configurable by the clinical administrator and stored
in the database, not compiled into the source. Each reading keeps the alert
that was shown at the time, so changing a threshold later never rewrites what a
clinician saw. Every configuration change is audited with its previous and new
value.

---

## Verification

```
tests/registration.test.ts   11  registration, duplicates, search, queue
tests/clinical.test.ts       24  BP, glucose, wound, breast, referral, follow-up
tests/operations.test.ts     16  inventory, expiry, procurement, budget, analytics
tests/security.test.ts       29  PINs, lockout, roles, audit, backup, rollback
tests/performance.test.ts     8  1,000 participants, ~4,500 clinical records
tests/sync.test.ts           20  two-device merge, conflicts, number blocks
tests/syncServer.test.ts     23  the cloud endpoint: auth, push, pull, paging
tests/cloudSchema.test.ts     8  the generated cloud schema accepts every table
tests/cloudAuth.test.ts      20  cloud sign-in, lockout, CORS, block allocation
tests/photos.test.ts         19  photography consent, erasure, staying on device
tests/cloudBackup.test.ts    17  chunked off-site backup, pruning, ciphertext only
tests/appUpdate.test.ts      22  build stamping, the update check, what it reports
tests/accountRequests.test.ts 19  self-service requests grant nothing until approved
                            ───
                            240  all passing
```

The suites run against a real SQLite database, not a mock.

Also verified in Chrome against the production build: first-run wizard, sign-in,
registration, an elevated blood pressure alert, persistence across a full
reload, **registering a participant with the network completely disconnected**,
a 6-page PDF report, a de-identified CSV export, and an encrypted backup file
with no readable SQLite header inside it.

The staff workflow was verified end to end against the deployed application at
`https://nichodemus.vercel.app`, on three separate browser profiles standing in
for three devices: an administrator set the outreach up, created a Nurse and a
Pharmacy account and synchronised; the nurse and the pharmacist then opened the
same address on a device that had never run the application, were taken
straight to a sign-in screen with no wizard and no device key, and saw the
participant the administrator had registered. The nurse could not reach user
management, clinical thresholds, the cloud settings or the audit trail; the
pharmacist could manage medicines stock but could record no clinical finding.
The administrator's device issued NUG-0001 and the nurse's NUG-10001 — separate
blocks, allocated by the cloud rather than by hand.

Clinical photography and the off-site backup were verified against the same
deployment. A 2400px, 225 KB camera image was downscaled to 1440px and 86 KB
before anything was stored; the camera button did not exist until a separate
photography consent was recorded; withdrawing that consent erased the image
rather than hiding it; and photographs were confirmed to be excluded from
synchronisation by default. A 700 KB encrypted file was uploaded in three
parts, listed, fetched back and compared byte for byte against what was sent.

Automatic updating was verified across two real production deployments with
the application left open in between: a copy running build A showed no
banner; a new build B was deployed; the running copy noticed it, offered it,
and — importantly — did **not** swap the code underneath until the update was
accepted; after accepting, the same page was running build B and the banner
was gone.

The Android build was verified by deleting `android/` and running `npm run apk`
from scratch: 1m46s, package `org.nugoutreach.app`, labelled **NUG Outreach**,
signed with the debug key, 5.1 MB, carrying the web payload and both SQLite
WASM binaries, with generated launcher icons at all five densities.

> The APK has not been run on a physical handset — no Android device was
> connected to build it. Install it with `npm run apk -- --install` and open it
> once before the outreach, as the device checklist in
> [docs/INSTALL.md](docs/INSTALL.md) says.

---

## Documentation

| | |
| --- | --- |
| [INSTALL.md](docs/INSTALL.md) | Building, installing on a phone, Android APK, device preparation |
| [USER_MANUAL.md](docs/USER_MANUAL.md) | For volunteers, nurses, clinicians and data officers |
| [ADMIN_MANUAL.md](docs/ADMIN_MANUAL.md) | Users, clinical thresholds, backups, closure, audit |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, durability, rule engine, security, decisions |
| [DATABASE.md](docs/DATABASE.md) | Every table, relationships, migrations, reporting rules |
| [CLOUD.md](docs/CLOUD.md) | Turso, Vercel, the desktop build and multi-device sync |

---

## Not implemented in version 1

Stated plainly rather than stubbed with buttons that do nothing:

- **Clinical photography.** The architecture allows for it; the capture and
  storage path is not built.
- **Automatic background sync.** Synchronisation is deliberately a button
  somebody presses, not something that happens silently on a metered
  connection during a clinic.

Settings → About lists these in the application itself.

---

## Technology

React 18 · TypeScript · Vite · sql.js (SQLite/WebAssembly) · jsPDF · WebCrypto ·
Service Worker · Capacitor (Android) · Electron (desktop) · Turso/libSQL and
Vercel functions (optional cloud) · no UI framework, no state library.
