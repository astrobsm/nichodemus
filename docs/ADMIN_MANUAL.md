# Administrator manual

**Nichodemus Ugbor Memorial Community Health Outreach Management System**

For the project administrator and the medical director.

---

## 1. Your responsibilities

| Responsibility | Why it matters |
| --- | --- |
| Backups | The database lives only on this device. No backup, no recovery. |
| Clinical thresholds | They decide when the application raises an alert or prompts a referral. |
| User accounts | Each person needs their own account so the audit trail means something. |
| Referral facilities | A referral with no working telephone number is not a referral. |
| Closing the outreach | Reconciles the record before the final report. |

---

## 2. Setting up before the outreach

### 2.1 Create the user accounts

**Settings → Users → Add user account.**

Give every person their own account. Shared accounts destroy the audit trail:
if two nurses share one login, nobody can tell who recorded which reading.

Set an initial PIN and hand it over privately. The person is required to choose
their own PIN when they first sign in, and from that point you cannot see it.

#### Roles

| Role | Can do |
| --- | --- |
| **Administrator** | Everything, including backup, restore, users, thresholds and audit |
| **Medical Director** | All clinical records, referrals, reports, identifiable exports, clinical thresholds, audit |
| **Doctor** | Clinical assessment, all clinical records, referrals |
| **Nurse** | Vitals, glucose, wound care, consultations, registration, referrals |
| **Laboratory user** | Glucose screening only |
| **Breast health user** | Breast examinations and related referrals |
| **Data officer** | Registration, editing, follow-up management, reporting, export, backup |
| **Logistics user** | Inventory, procurement, budget, logistics, mobilisation, tasks |
| **Volunteer** | Registration and moving people between stations only |

Only Administrator, Medical Director and Data Officer can override a duplicate
warning. Only Administrator and Medical Director can export data containing
patient names and telephone numbers.

Give people the narrowest role that lets them do their job.

### 2.2 Review the clinical thresholds

**Settings → Clinical.**

Every alert this application raises comes from these numbers. They ship with
widely used screening values, but the decision to use them is a clinical
governance decision that belongs to your medical director, not to this
software.

| Group | What the thresholds control |
| --- | --- |
| Blood pressure | When a reading is elevated, markedly elevated, urgent, or unusually low |
| Blood glucose | Low, elevated and markedly elevated, separately for fasting and non-fasting; urgent |
| Wound care | Pain score and surface area that trigger a review prompt |
| Breast health | Lump size that triggers a referral prompt (zero means any lump) |
| Follow-up | Days until a routine and an urgent follow-up fall due |

Every change is written to the audit trail with the previous and the new value,
and the screen shows who last changed the configuration and when. Print that
screen for your clinical governance file before the outreach.

**A reading is stored with the alert that was shown at the time.** Changing a
threshold later does not silently rewrite what a clinician saw.

### 2.3 Referral facilities

**Settings → Facilities.**

Add every facility you may refer to, with a telephone number that works. This
directory is on the device and needs no connection.

### 2.4 Stations

**Settings → Stations.** The nine default stations map to the stages of the
participant journey. Add or remove them to match the venue layout.

### 2.5 Inventory and budget

**Operations → Inventory** — enter the opening stock of everything you are
taking, with a minimum stock level so the application warns you before you run
out, and expiry dates for anything that has one.

**Operations → Budget** — set budget lines per category, then record expenses
against them as they happen.

### 2.6 Training with demonstration data

**Settings → Demo data → Generate demonstration data** creates realistic
practice records so volunteers can rehearse.

Demonstration records are clearly marked, their names end in "(DEMO)", and a
purple ribbon appears across the top of the app while any exist.

**Clear demonstration data before the outreach begins.** Clearing removes only
demonstration rows; real clinical records are untouched.

---

## 3. Backups

This is the single most important thing you do.

### Taking a backup

**Settings → Backup → Back up database.**

Choose a password. The backup is sealed with AES-256-GCM under a key derived
from that password with 250,000 rounds of PBKDF2. Then choose where to save it.

> **Without the password the backup cannot be opened. There is no recovery, no
> reset and no back door.** Write it down and keep it somewhere safe and
> separate from the device.

### How often

| When | What to do |
| --- | --- |
| After setup | One backup, copied off the device |
| Night before | One backup, copied off the device |
| During the outreach | Every two to three hours, or each time the queue empties |
| End of each day | One backup, copied to two separate places |
| At closure | The closure backup, kept permanently |

The dashboard warns you when a backup is due. The reminder interval is set in
Settings → Security.

### Where the backup file goes

| How the app was installed | Where files are written |
| --- | --- |
| **Android app (APK)** | `Documents/NUG Outreach`, and the share sheet opens straight away so you can send the backup to another phone, a laptop or a memory card without hunting for it |
| **Chrome on Android** | the Downloads folder |
| **Desktop or laptop browser** | a folder you choose — USB stick, SD card, anywhere |

The Backup screen tells you which of these applies on the device in your hand.

### Getting backups off the device

A backup sitting only on the phone does not protect you from losing the phone.
Move every backup somewhere else: the share sheet on Android, or a USB stick or
memory card from a laptop.

Copying a backup to cloud storage is your decision, not the application's: it
never uploads anything itself. If you do, remember the file contains
confidential health information, even though it is encrypted.

### Restoring

**Settings → Backup → Restore database.**

> **Restoring replaces everything currently on the device.** Take a backup of
> the current data first unless you are certain you do not want it.

Choose the file, enter its password. The application verifies the file is a
real, undamaged SQLite database before it replaces anything — a corrupt backup
is refused and the live database is left alone. Migrations run automatically if
the backup came from an older version.

---

## 4. During the outreach

### The event-day dashboard

On the day (or whenever project status is Active) the Home screen adds a Today
panel: registered, screened, completed, still queueing, and the count of each
activity. All figures come straight from the database.

### Urgent alerts

**Clinical → Urgent** lists everyone whose screening measurement reached the
urgent threshold. Work this list down. Nobody should leave the venue on it
without being seen.

### Queue management

**Clinical → Queues** shows the number waiting at each station — the quickest
way to spot where you need to move a staff member.

### Stock

**Operations → Inventory** flags low stock, out of stock, expiring soon and
expired. The application refuses to record expired stock as used; record it as
wastage instead.

---

## 5. After the outreach

### 5.1 Data quality first

**Reports → Data quality.** Resolve what you can before generating the final
report:

- Missing blood pressure, glucose or clinical review
- Missing consent records
- Missing telephone numbers (these people cannot be followed up)
- Duplicate warnings that were overridden — check these are genuinely different people
- Referrals with no recorded outcome

### 5.2 Follow-up

**Clinical → Follow-up** is the post-event work. Contact everybody referred,
record what happened, and close each entry. The follow-up dashboard shows how
many were contacted, attended, could not be reached and completed.

### 5.3 Closing the outreach

**Reports → Close outreach** shows the final position and checks:

**Blocked until resolved:**
- All mandatory checklist items complete
- Every referral has a recorded outcome

**Flagged as worth checking:**
- Pending follow-ups
- Expired inventory
- Incomplete participant records

Take the closure backup, then close. The project is marked COMPLETED and stays
fully readable for reporting and continuing follow-up.

### 5.4 Reports

**Reports → PDF reports** generates fifteen reports on the device.

The executive and statistical reports contain **no patient identifiers**. Only
the referral and follow-up reports can include names and telephone numbers, and
only when a user with the identifiable-data permission deliberately turns that
on. The cover page of every report states which kind it is.

Report wording always distinguishes a screening finding from a diagnosis. The
reports say "127 participants had elevated blood pressure screening
measurements requiring clinical assessment", never "127 people had
hypertension". Please keep that distinction when you quote the figures.

**Reports → Export** produces CSV files for every dataset, honouring the same
permission rules.

---

## 6. Audit trail

**Settings → Audit** records who did what, to which record, and when:
sign-ins and failed sign-ins, record creation and modification, referral status
changes, configuration changes, duplicate overrides, backups, restores and
exports.

Changes show the previous and the new value. Patient names are deliberately
never written into audit entries — the participant code identifies the record.

Clinical records use soft deletion: a removed record stays in the database
marked as deleted, with the reason and the person who removed it.

You can export the whole audit trail as CSV.

---

## 7. Security settings

**Settings → Security.**

| Setting | Recommendation |
| --- | --- |
| Application lock | 5 minutes. Set 1 minute if the device is shared at a busy station. |
| Backup reminder | 12 hours in planning; consider 4 hours on the day. |
| Larger text / high contrast | Offer these to anybody who finds the screen hard to read. |

PINs are never stored. The application keeps a PBKDF2-SHA256 derivation with a
random per-user salt, so even with the database file an attacker cannot read
anybody's PIN.

---

## 8. Database health

**Settings → About → Run database check** runs SQLite's integrity check and a
referential integrity check, and reports storage use.

If either fails: stop entering data, restore the most recent backup, and record
what happened. This should not occur — writes are transactional and flushed to
device storage on commit — but the check is there so you can prove the record
is sound.

---

## 9. Known limits of version 1

Stated plainly so nobody is surprised on the day:

- **One device holds the real record.** There is no synchronisation between
  devices. Every record already carries a UUID, timestamps, a device
  identifier and a version number so synchronisation can be added later without
  changing the database, but it is not built.
- **No clinical photography.** The architecture allows for it; it is not
  implemented.
- **No cloud backup.** Deliberate. Backups are files you control.

Settings → About lists these as NOT IMPLEMENTED rather than hiding them.

---

## 10. If the worst happens

**The phone is lost or stolen.** The database is protected by the application
PIN and by the device lock. Restore your most recent backup onto another
device and carry on. Record the loss as an information governance incident.

**The phone breaks.** Restore the backup onto another device.

**The app will not open.** It reports a database problem rather than failing
silently. Restore a backup. Data is not deleted by a failed start.

**You forget a backup password.** That backup is unrecoverable. Use an earlier
one. This is why you keep more than one.
