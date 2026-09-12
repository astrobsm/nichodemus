# User manual

**Nichodemus Ugbor Memorial Community Health Outreach**

For registration volunteers, nurses, laboratory staff, clinicians and data
officers working on the day.

---

## Before anything else

**This application never needs the internet.** If the phone has no signal, keep
working exactly as normal. Everything you enter is saved onto the device the
moment you tap Save.

The blue strip below the header tells you the state:

> All data is stored on this device only. Nothing is uploaded.

or, when there is no connection:

> Offline mode — all data is being stored securely on this device.

Both are normal. Neither stops you working.

---

## Signing in

Enter your username and your PIN. You choose your own PIN the first time you
sign in; nobody else knows it, and the administrator cannot read it.

After five wrong PIN entries the account locks for five minutes. If that
happens, ask the administrator to reset it.

The app locks itself after a period of inactivity (five minutes by default).
Enter your PIN to carry on — nothing is lost while it is locked. You can also
lock it deliberately with the ⎉ button in the header whenever you put the phone
down.

---

## The five main screens

Along the bottom of the screen:

| | Screen | What it is for |
| --- | --- | --- |
| ⌂ | **Home** | The dashboard: how many people, how many screened, what needs attention |
| ☷ | **People** | Search, filter and open a participant |
| ✚ | **Clinical** | Station queues, referrals, follow-up, urgent alerts |
| ☰ | **Operations** | Inventory, procurement, budget, tasks, team, logistics, checklist |
| ▤ | **Reports** | Statistics, PDF reports, data export, data quality |

You will only see the parts your role is allowed to use. If a screen says "Not
available for your role", that is deliberate — ask an administrator if you need
access.

---

## Registering a participant

1. From Home or People, tap **Register participant**.
2. The form is in five sections. Tap a heading to open it.

   - **Identity** — first and last name are required.
   - **Demographics** — sex is required. Enter a date of birth if the person
     knows it (the age calculates itself), otherwise just enter an approximate
     age. Never hold anyone up over an exact date.
   - **Contact** — a telephone number matters: without it nobody can follow the
     person up after the outreach.
   - **Medical history** — known high blood pressure, known diabetes,
     medications.
   - **Consent** — confirm they agree to be seen and to have their information
     recorded.

3. Tap **Save participant**.

The participant number is created automatically — NUG-0001, NUG-0002 and so on.
You never type it.

### If it says "Possible duplicate"

Somebody with a very similar name, telephone number or age is already
registered. The application shows you who.

- Tap the existing person to open their record — this is usually the right
  answer, and means they are already registered.
- If they genuinely are a different person, a data officer, medical director or
  administrator can enter a reason and register them anyway. That reason is
  recorded.

### If a value is refused

The application tells you what is wrong in plain words, for example:

> Systolic blood pressure of 999 mmHg is outside the range this application
> accepts (50–300 mmHg). Please verify the measurement.

Your entry is not lost. Correct the number and carry on.

---

## Moving people through the outreach

The normal path is:

```
Registration → Vitals → Glucose → Clinical review → Counselling → Completed
```

with wound care and breast clinic taken as required.

Two ways to move somebody:

- From the **participant's profile**, tap a station under "Send to".
- From **Clinical → Queues**, open a station and tap the → button on their row.

The queue screens show how many people are waiting at each station. This is the
fastest way to see where the bottleneck is.

---

## Vital signs

1. Open the participant, tap **Vital signs**.
2. Enter systolic and diastolic blood pressure. Pulse, weight, height,
   temperature and oxygen saturation are optional.
3. BMI calculates itself from weight and height.
4. Tap **Save reading**.

### Repeat measurements

If you take the blood pressure again, just record it again. It is saved as
reading 2 — **the first reading is never overwritten**. Both stay in the record,
which is exactly what a clinician reviewing the person needs to see.

### What the alert means

An elevated reading shows:

> **Attention required** — Blood pressure screening result is elevated at
> 168/96 mmHg. Repeat measurement and clinical assessment are recommended.

This is a **screening finding**, not a diagnosis of hypertension. Nobody is
told they have high blood pressure by this application. Repeat the measurement
after the person has rested, and send them for clinical review.

A reading at or above the urgent threshold offers a **Create referral** button
straight away.

---

## Blood glucose

1. Open the participant, tap **Glucose**.
2. Record whether they are **fasting** — it changes which thresholds apply.
   Fasting means nothing but water for at least 8 hours.
3. Enter the value. Both mmol/L and mg/dL are accepted; mg/dL is converted
   automatically.
4. Tap **Save result**.

Abnormal results say so and recommend further assessment. They never say
"diabetes". A capillary glucose result always needs confirmatory testing before
anybody is diagnosed.

---

## Clinical consultation

Open the participant and tap **Consultation**. The screening findings recorded
so far are shown at the top so you do not have to hunt for them.

Fill in what is relevant: presenting concerns, history, examination,
assessment, advice, treatment, counselling. Free text is fine.

Tick **Referral required** and the referral form opens as soon as you save.

---

## Wound care

Open the participant and tap **Wound care**.

- For a new wound, record where it is, which side, how long it has been there
  and the cause.
- For a wound already recorded, choose it from the list so the assessments stay
  together.

Enter length and width, and the approximate surface area calculates itself —
it is labelled as approximate because length × width is an estimate, not a
measurement.

Record tissue type, exudate, odour, wound edge, surrounding skin, signs of
infection, pain score, swelling and necrosis; then the care you gave —
cleansing, dressing, advice, next dressing date.

Signs of infection or necrosis raise a **clinical review required** prompt and
offer a referral.

---

## Breast health

Carry this out in a private space. Record whether a chaperone was present.

- If the examination is normal, leave **No abnormality detected** on and save.
- Otherwise turn it off and record what you found: lump (with side, location,
  approximate size, mobility, consistency, tenderness), nipple discharge, skin
  change, nipple change, axillary finding.

Any abnormal finding produces:

> **Referral consideration** — Abnormal finding identified: a breast lump
> (approximately 22 mm). Clinical review and appropriate further breast
> evaluation or referral are recommended. This record documents a clinical
> finding only; it is not a diagnosis.

**The application never labels a breast finding as cancer.** It records what
you observed and prompts referral.

---

## Referrals

A referral can be raised from any clinical form, or from the participant's
profile.

Record the reason, the urgency (routine, priority, urgent, emergency), the
destination facility, any instructions for the person, and whether transport is
needed.

Creating a referral automatically adds the person to the **follow-up queue**,
due in 14 days for a routine referral or 3 days for an urgent one. Nobody who
needs further care can quietly fall off the list.

### Referral status

As you learn what happened, update the status: Recommended → Issued → Patient
informed → Attended / Not attended → Completed.

---

## Follow-up after the outreach

**Clinical → Follow-up** is the list of everyone who needs contacting.

Each row shows the participant, the reason, when it is due, how many times you
have tried, and the outcome so far. Overdue entries are flagged.

- Tap **Call** to dial their number directly.
- Tap **Update** to record what happened: contacted, attended a facility, not
  attended, unreachable, completed.

Recording an outcome also updates the referral, so the two never disagree.

---

## Finding somebody

**People** searches by participant number, name or telephone number as you
type. Filters let you narrow by sex, stage, community and age range.

Search works entirely on the device and stays fast with a thousand or more
participants.

---

## The participant record

Each participant's profile has tabs:

| Tab | Shows |
| --- | --- |
| Profile | Identity, contact, clinical background, consent |
| Screening | Every blood pressure reading and glucose result |
| Clinical | Consultation notes |
| Wound | Wounds and their assessments |
| Breast | Breast examinations |
| Referral | Referrals and their status |
| Follow-up | Follow-up entries |
| History | Their journey through the stations, and every change made to the record |

---

## If something goes wrong

**The app shows an error when I save.** Read the message — it explains what to
fix. Your information is not lost. Correct it and save again.

**I entered a reading against the wrong person.** Tell the data officer or
administrator. Clinical records are not deleted outright; they are marked as
removed, and the correction is recorded with your name against it.

**The phone died mid-entry.** Open the app again. Everything saved before the
power went is still there. A half-finished entry is discarded rather than
half-saved.

**The app says my account is locked.** Five wrong PIN entries. Wait five
minutes, or ask the administrator to reset it.

**I cannot see a screen somebody else can see.** Your role does not include it.
That is by design.

---

## Ending the day

- Tell the administrator so they can take a backup.
- Sign out with the ⏻ button, especially if the device is shared.

---

## Please remember

This device holds confidential health information about people from your
community. Do not lend it to anybody outside the team, do not share your PIN,
and do not share backup files.
