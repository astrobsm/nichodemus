# Cloud sync, hosting and the desktop application

**Nichodemus Ugbor Memorial Community Health Outreach**

This document covers the three optional pieces added on top of the offline
application: a hosted database, a hosted web address, and a desktop program.

> **Read this first.** None of it changes how the outreach runs. The phones
> keep their own SQLite database and keep working at zero bars. Sync is a
> reconciliation that happens when a connection exists. If the cloud is never
> reachable — which is a realistic possibility in Awgu LGA — the outreach is
> unaffected and the data is still on the devices.

---

## 1. How the pieces fit together

```
  PHONE (Umuhu village, no signal)          CLOUD (when a signal exists)
 ┌──────────────────────────────┐          ┌────────────────────────────┐
 │  local SQLite  ●●●●●●●●●●    │          │  Turso (libSQL)            │
 │  the source of truth         │ ──push──▶│  the shared copy           │
 │  registration never blocked  │◀──pull── │                            │
 └──────────────────────────────┘          └─────────────┬──────────────┘
                                                          │
  DESKTOP (clinic office)                                 │
 ┌──────────────────────────────┐                         │
 │  local SQLite, same engine   │ ◀───────sync────────────┘
 └──────────────────────────────┘                         │
                                                          │
                                        Vercel: hosts the app and the
                                        /api/sync endpoint. The database
                                        credentials live only here.
```

Devices never talk to Turso directly. They call `/api/sync` on Vercel with a
device key; the Turso credentials stay in server environment variables. A lost
phone therefore holds a revocable key, not database access.

---

## 2. Set up the cloud database (about ten minutes)

### 2.1 Create a free Turso database

```bash
# Install the CLI
irm get.tur.so/install.ps1 | iex                 # Windows PowerShell
brew install tursodatabase/tap/turso             # macOS
curl -sSfL https://get.tur.so/install.sh | bash  # Linux

turso auth signup
turso db create nug-outreach

turso db show nug-outreach --url        # libsql://nug-outreach-<org>.turso.io
turso db tokens create nug-outreach     # the auth token
```

The free tier is far beyond what this outreach needs: 9 GB of storage and a
billion row reads a month, against a database that stays under 5 MB.

### 2.2 Point the project at it

Create `.env.local` next to `package.json`:

```
TURSO_DATABASE_URL=libsql://nug-outreach-<your-org>.turso.io
TURSO_AUTH_TOKEN=<the token from the command above>
```

This file is git-ignored. Never commit it.

### 2.3 Create the tables

```bash
npm run cloud:setup
```

It builds the cloud tables from the same `src/db/schema.sql` the phones use,
adds the change log, and prints a generated `SYNC_TOKEN` for you to use. Run it
again whenever you like — it is idempotent.

---

## 3. Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel link          # answer the prompts once
```

Set the three environment variables, in the Vercel dashboard under
**Project → Settings → Environment Variables**, or from the terminal:

```bash
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add SYNC_TOKEN production
```

| Variable | What it is |
| --- | --- |
| `TURSO_DATABASE_URL` | The `libsql://…` address |
| `TURSO_AUTH_TOKEN` | The database token |
| `SYNC_TOKEN` | The key every device presents. `npm run cloud:setup` suggests one |

Then deploy:

```bash
npm run cloud:deploy
```

Vercel builds the same web application and serves `/api/sync` beside it. The
free hobby tier is sufficient.

> **`SYNC_TOKEN` is how you revoke a device.** Change it on Vercel and every
> device stops syncing immediately until it is given the new value. If a phone
> is lost, change it that day.

---

## 4. Connect the devices

There are two kinds of device, and only the first one needs any setting up.

### 4.1 The device that sets the outreach up (once, by the administrator)

1. Open the address, choose **Set up a new outreach** and complete the wizard.
2. Create an account for every member of the team:
   **Settings → Users → Add user account**.
3. **Settings → Cloud sync** — enter the web address and the `SYNC_TOKEN` as
   the device key, **Save cloud settings**, then **Synchronise now**.

That last step is what puts the outreach and the accounts into the cloud.
Until it has run, nobody else can sign in, because there is nothing to sign
in to.

### 4.2 Everyone else (a nurse, a doctor, a pharmacist, a volunteer)

Open the same web address and sign in with the username and PIN the
administrator issued. That is the whole procedure.

The device is not set up, no project is created, no web address is typed and
no device key is entered. The application asks the address it was served from
whether an outreach is already running there; when there is one it goes
straight to a sign-in screen. Signing in brings down the project, the team,
the settings and the records, and the device then works offline exactly like
every other.

A device that is **not** served from the cloud — the Android build or the
desktop application, which run from their own private addresses — asks for the
web address once on that first sign-in, and remembers it.

### 4.3 The number block is allocated for you

Two phones registering people at the same time with no signal between them
would both issue NUG-0001, and the merge would have to discard one of two real
participants. Each device therefore issues from its own block:

| Block | Participant numbers |
| --- | --- |
| 0 | NUG-0001 to NUG-10000 |
| 1 | NUG-10001 to NUG-20000 |
| 2 | NUG-20001 to NUG-30000 |

**You no longer assign these by hand.** The cloud reserves a free block for
each device the first time it signs in, and gives that same device the same
block every time afterwards. The device that set the outreach up keeps block 0
and claims it on its first synchronisation, so it can never be handed out
twice.

The field is still there under **Settings → Cloud sync** for the rare case of
a device that will never touch the cloud at all. If you do set one by hand and
it collides with a block already taken, the next synchronisation says so in
red — and you must stop registering on one of the two devices, because
numbers already issued cannot be renumbered.

---

## 5. What syncs, and what does not

**Synchronised** — 28 tables: the project, stations, team, tasks, users,
participants, consent, vitals, glucose, consultations, wounds, breast
examinations, facilities, referrals, follow-ups, queue movements, inventory,
procurement, budget, expenses, mobilisation, logistics and the event checklist.

**Kept on the device that wrote it** — the audit trail, backup records, local
application settings and the sync bookkeeping itself. The audit trail is
deliberately local: it is evidence of what happened on that device.

### How conflicts are decided

Last-write-wins, decided identically on the device and on the server:

1. Higher `version` wins. Every edit increments it, including a deletion.
2. Equal versions fall back to the later `updated_at`, compared as instants,
   not as text.
3. An exact tie breaks on `uuid`, so the outcome is deterministic rather than
   dependent on which device happened to connect first.

Deletions replicate as soft deletions — the row is marked, never removed —
so a delete on one device cannot be silently undone by a stale copy on another.

---

## 6. The desktop application

```bash
npm run desktop          # run it now
npm run desktop:build    # build an installer
```

The installer lands in `release/desktop/NUG-Outreach-Setup-1.0.0.exe`
(about 130 MB, because it bundles its own browser engine). macOS `.dmg` and
Linux `.AppImage` targets are configured too; build them on the matching
platform.

The desktop version is the same application with the same local SQLite
database. Two details make it behave correctly rather than merely run:

- It is served from a private `app://` scheme, not `file://`. A `file://`
  origin is opaque, so the database would not survive a restart, and
  `crypto.subtle` — which hashes every PIN and encrypts every backup — is
  unavailable outside a secure context.
- Backups, reports and exports go through a native save dialog, because an
  Electron window ignores browser downloads. Without it a backup would report
  success and write nothing.

Both are covered by the automated desktop test, which registers a participant,
closes the application, reopens it and checks the record is still there.

---

## 7. Running the outreach with several devices

1. **Before the day:** create the project on one device, set it up fully,
   create an account for every member of the team, then sync. Every other
   device pulls the project, stations, team, thresholds and facilities rather
   than being set up separately.
2. **Hand out usernames and initial PINs.** Each person opens the web address
   on their own device and signs in; the cloud reserves that device its own
   participant-number block automatically.
3. **On the day:** work entirely offline. Sync if and when a signal appears —
   there is no need, and no harm.
4. **End of day:** sync each device in turn, wherever there is a connection.
   Take an encrypted backup of each device as well. Sync is not a backup: it
   is a copy of the records, not of the audit trail.
5. **Reporting:** open the Vercel address on any computer to see the
   consolidated data.

> Sync does not replace backups, and backups do not replace sync. Keep doing
> both. A backup is the only thing that restores a device exactly as it was,
> audit trail included.

---

## 8. Privacy and security

- Patient records sent to the cloud include names and telephone numbers.
  That is inherent in consolidating data across devices; the alternative is to
  leave sync off.
- Devices hold only the sync token. Database credentials live in Vercel
  environment variables and are never shipped to a device.
- User accounts sync, including their PIN derivations, so staff can sign in on
  any device and the audit trail stays attributable to a real person. PINs
  themselves are never stored anywhere — only a PBKDF2-SHA256 derivation with
  a per-user random salt.
- The transport is HTTPS, provided by Vercel.
- Turn sync off entirely by clearing the web address in Settings. The
  application returns to being wholly offline, exactly as it shipped.

---

## 9. If something goes wrong

| Symptom | What it means |
| --- | --- |
| "The cloud could not be reached" | No connection. Nothing is lost; the changes stay queued. |
| "The cloud rejected this device's key" | `SYNC_TOKEN` differs between the device and Vercel. |
| "Waiting to send" keeps growing | Sync has not succeeded. Check the address and key. |
| Two participants with the same number | Two devices shared a number block. Fix the blocks, and reconcile the duplicates through the data quality screen. |
| Sync succeeded but a record is missing | Check whether its parent arrived — a record whose participant is not yet present is deferred and retried on the next run. |

The sync history at the bottom of **Settings → Cloud sync** records every
attempt, successful or not, with the reason for any failure.
