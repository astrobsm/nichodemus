/** Vitals, glucose, wound, breast and referral behaviour (spec S95). */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDatabase, teardown, type Fixture } from './helpers'
import { registerParticipant, type Participant } from '../src/db/repo/participants'
import {
  createWound,
  glucoseFor,
  latestVitals,
  recordBreastExamination,
  recordGlucose,
  recordVitals,
  recordWoundAssessment,
  vitalsFor,
  saveEncounter,
  encountersFor,
} from '../src/db/repo/clinical'
import { createReferral, followupsFor, listFollowups, referralsFor, updateFollowup, updateReferralStatus } from '../src/db/repo/referrals'
import {
  validateBloodPressure,
  validateGlucose,
  calculateBmi,
  woundArea,
  glucoseToMmol,
} from '../src/core/validation'
import { updateThreshold, loadThresholds } from '../src/db/repo/settings'
import { transaction } from '../src/db/sqlite'

let fx: Fixture
let participant: Participant

beforeEach(async () => {
  fx = await freshDatabase()
  participant = await registerParticipant(
    fx.project,
    {
      firstName: 'Ada',
      lastName: 'Obi',
      sex: 'FEMALE',
      ageYears: 52,
      phone: '08030000001',
      consentStatus: 'GIVEN',
    },
    { overrideDuplicate: true },
  )
})

afterAll(teardown)

describe('blood pressure', () => {
  it('accepts a normal reading and raises no alert', async () => {
    const { alert } = await recordVitals(
      participant.id,
      fx.project.id,
      { systolic: 118, diastolic: 76, pulse: 72 },
      fx.thresholds,
    )
    expect(alert.level).toBe('NORMAL')
    expect(alert.suggestReferral).toBe(false)
  })

  it('flags an elevated reading as a screening finding, not a diagnosis', async () => {
    const { alert } = await recordVitals(
      participant.id,
      fx.project.id,
      { systolic: 168, diastolic: 96 },
      fx.thresholds,
    )
    expect(alert.level).toBe('ATTENTION')
    expect(alert.message).toMatch(/screening/i)
    expect(alert.message).not.toMatch(/hypertension|diagnos/i)
  })

  it('raises an urgent prompt above the urgent threshold', async () => {
    const { alert } = await recordVitals(
      participant.id,
      fx.project.id,
      { systolic: 190, diastolic: 115 },
      fx.thresholds,
    )
    expect(alert.level).toBe('URGENT')
    expect(alert.suggestReferral).toBe(true)
    expect(alert.suggestedUrgency).toBe('URGENT')
  })

  it('rejects impossible values with an explanation', () => {
    const tooHigh = validateBloodPressure(999, 80)
    expect(tooHigh.ok).toBe(false)
    expect(tooHigh.message).toMatch(/verify the measurement/i)

    const inverted = validateBloodPressure(120, 130)
    expect(inverted.ok).toBe(false)
    expect(inverted.message).toMatch(/not lower than/i)
  })

  it('keeps a repeat reading without overwriting the first', async () => {
    await recordVitals(participant.id, fx.project.id, { systolic: 168, diastolic: 96 }, fx.thresholds)
    await recordVitals(participant.id, fx.project.id, { systolic: 154, diastolic: 88 }, fx.thresholds)

    const readings = vitalsFor(participant.id)
    expect(readings).toHaveLength(2)
    expect(readings[0].bp_systolic).toBe(168)
    expect(readings[0].reading_index).toBe(1)
    expect(readings[1].bp_systolic).toBe(154)
    expect(readings[1].reading_index).toBe(2)
    expect(latestVitals(participant.id)?.bp_systolic).toBe(154)
  })

  it('calculates BMI from weight and height', async () => {
    await recordVitals(
      participant.id,
      fx.project.id,
      { systolic: 120, diastolic: 80, weightKg: 70, heightCm: 165 },
      fx.thresholds,
    )
    expect(latestVitals(participant.id)?.bmi).toBeCloseTo(25.7, 1)
    expect(calculateBmi(70, 165)).toBeCloseTo(25.7, 1)
    expect(calculateBmi(70, 0)).toBeNull()
  })

  it('honours a changed alert threshold', async () => {
    await transaction(() => updateThreshold('bpSystolicElevated', 130))
    const thresholds = loadThresholds()
    expect(thresholds.bpSystolicElevated).toBe(130)

    const { alert } = await recordVitals(
      participant.id,
      fx.project.id,
      { systolic: 134, diastolic: 84 },
      thresholds,
    )
    expect(alert.level).toBe('ATTENTION')
  })
})

describe('blood glucose', () => {
  it('records a normal non-fasting result', async () => {
    const { alert, valueMmol } = await recordGlucose(
      participant.id,
      fx.project.id,
      { value: 5.6, unit: 'mmol/L', fastingStatus: 'NON_FASTING' },
      fx.thresholds,
    )
    expect(valueMmol).toBe(5.6)
    expect(alert.level).toBe('NORMAL')
  })

  it('applies the fasting thresholds when the sample is fasting', async () => {
    const fasting = await recordGlucose(
      participant.id,
      fx.project.id,
      { value: 6.5, unit: 'mmol/L', fastingStatus: 'FASTING' },
      fx.thresholds,
    )
    expect(fasting.alert.level).toBe('ATTENTION')

    const random = await recordGlucose(
      participant.id,
      fx.project.id,
      { value: 6.5, unit: 'mmol/L', fastingStatus: 'NON_FASTING' },
      fx.thresholds,
    )
    expect(random.alert.level).toBe('NORMAL')
  })

  it('converts mg/dL to mmol/L for comparison', async () => {
    const { valueMmol } = await recordGlucose(
      participant.id,
      fx.project.id,
      { value: 200, unit: 'mg/dL', fastingStatus: 'NON_FASTING' },
      fx.thresholds,
    )
    expect(valueMmol).toBeCloseTo(11.1, 1)
    expect(glucoseToMmol(200, 'mg/dL')).toBeCloseTo(11.1, 1)
    expect(glucoseFor(participant.id)[0].unit).toBe('mg/dL')
  })

  it('raises an urgent alert for a low result', async () => {
    const { alert } = await recordGlucose(
      participant.id,
      fx.project.id,
      { value: 2.9, unit: 'mmol/L', fastingStatus: 'UNKNOWN' },
      fx.thresholds,
    )
    expect(alert.level).toBe('URGENT')
    expect(alert.message).toMatch(/hypoglycaemia/i)
  })

  it('states that abnormal results need confirmatory testing', async () => {
    const { alert } = await recordGlucose(
      participant.id,
      fx.project.id,
      { value: 13.0, unit: 'mmol/L', fastingStatus: 'NON_FASTING' },
      fx.thresholds,
    )
    expect(alert.message).toMatch(/confirmatory/i)
    expect(alert.message).not.toMatch(/diabetes/i)
  })

  it('rejects an implausible value', () => {
    expect(validateGlucose(120, 'mmol/L').ok).toBe(false)
    expect(validateGlucose(12, 'mmol/L').ok).toBe(true)
    expect(validateGlucose(1200, 'mg/dL').ok).toBe(false)
  })
})

describe('wound care', () => {
  it('calculates an approximate surface area from length and width', async () => {
    const wound = await createWound(
      participant.id,
      fx.project.id,
      fx.project.participant_prefix,
      { location: 'Left lower leg', side: 'LEFT', cause: 'Trauma' },
    )
    expect(wound.wound_code).toBe('NUG-WND-0001')

    const { areaCm2 } = await recordWoundAssessment(
      wound,
      { lengthCm: 5, widthCm: 3, tissueType: 'Granulating', dressingApplied: true },
      fx.thresholds,
    )
    expect(areaCm2).toBe(15)
    expect(woundArea(5, 3)).toBe(15)
    expect(woundArea(null, 3)).toBeNull()
  })

  it('raises a review prompt when infection signs are recorded', async () => {
    const wound = await createWound(
      participant.id,
      fx.project.id,
      fx.project.participant_prefix,
      { location: 'Foot' },
    )
    const { alert } = await recordWoundAssessment(
      wound,
      { lengthCm: 2, widthCm: 2, infectionSigns: 'Purulent discharge' },
      fx.thresholds,
    )
    expect(alert.level).toBe('URGENT')
    expect(alert.suggestReferral).toBe(true)
    expect(alert.message).toMatch(/infection/i)
  })

  it('accepts an assessment without measurements', async () => {
    const wound = await createWound(
      participant.id,
      fx.project.id,
      fx.project.participant_prefix,
      { location: 'Hand' },
    )
    const { alert, areaCm2 } = await recordWoundAssessment(wound, { dressingApplied: true }, fx.thresholds)
    expect(areaCm2).toBeNull()
    expect(alert.level).toBe('NORMAL')
  })
})

describe('breast health', () => {
  it('records a normal examination with no referral prompt', async () => {
    const { alert } = await recordBreastExamination(
      participant.id,
      fx.project.id,
      { breastExamined: 'BILATERAL', noAbnormality: true, bseTaught: true },
      fx.thresholds,
    )
    expect(alert.level).toBe('NORMAL')
    expect(alert.suggestReferral).toBe(false)
  })

  it('prompts referral for a lump without calling it cancer', async () => {
    const { alert } = await recordBreastExamination(
      participant.id,
      fx.project.id,
      {
        breastExamined: 'BILATERAL',
        noAbnormality: false,
        lumpPresent: true,
        lumpSide: 'RIGHT',
        lumpSizeMm: 22,
      },
      fx.thresholds,
    )
    expect(alert.suggestReferral).toBe(true)
    expect(alert.message).toMatch(/further breast evaluation|referral/i)
    expect(alert.message.toLowerCase()).not.toContain('cancer')
    expect(alert.message).toMatch(/not a diagnosis/i)
  })
})

describe('referral and follow-up', () => {
  it('creates a referral with a follow-up entry due after the configured interval', async () => {
    const referral = await createReferral(
      participant.id,
      fx.project.id,
      fx.project.participant_prefix,
      { reason: 'Elevated blood pressure screening measurement', urgency: 'PRIORITY' },
      fx.thresholds,
    )
    expect(referral.referral_code).toBe('NUG-REF-0001')
    expect(referral.status).toBe('RECOMMENDED')

    const followups = followupsFor(participant.id)
    expect(followups).toHaveLength(1)
    expect(followups[0].outcome).toBe('PENDING')
    expect(followups[0].due_date).toBeTruthy()
  })

  it('uses the shorter interval for an urgent referral', async () => {
    const urgent = await createReferral(
      participant.id,
      fx.project.id,
      fx.project.participant_prefix,
      { reason: 'Urgent review', urgency: 'URGENT' },
      fx.thresholds,
    )
    const routine = await createReferral(
      participant.id,
      fx.project.id,
      fx.project.participant_prefix,
      { reason: 'Routine review', urgency: 'ROUTINE' },
      fx.thresholds,
    )
    const all = followupsFor(participant.id)
    const urgentDue = all.find((f) => f.referral_id === urgent.id)!.due_date!
    const routineDue = all.find((f) => f.referral_id === routine.id)!.due_date!
    expect(urgentDue < routineDue).toBe(true)
  })

  it('updates the referral status directly', async () => {
    const referral = await createReferral(
      participant.id,
      fx.project.id,
      fx.project.participant_prefix,
      { reason: 'Assessment', urgency: 'ROUTINE' },
      fx.thresholds,
    )
    await updateReferralStatus(referral.id, 'ISSUED')
    expect(referralsFor(participant.id)[0].status).toBe('ISSUED')
  })

  it('keeps the referral status aligned when a follow-up outcome is recorded', async () => {
    const referral = await createReferral(
      participant.id,
      fx.project.id,
      fx.project.participant_prefix,
      { reason: 'Assessment', urgency: 'ROUTINE' },
      fx.thresholds,
    )
    const followup = followupsFor(participant.id)[0]

    await updateFollowup(followup.id, { outcome: 'ATTENDED_FACILITY', recordContactAttempt: true })

    expect(referralsFor(participant.id)[0].status).toBe('ATTENDED')
    const updated = followupsFor(participant.id)[0]
    expect(updated.contact_attempts).toBe(1)
    expect(updated.last_contact_at).toBeTruthy()
    void referral
  })

  it('closes a follow-up when the outcome is completed', async () => {
    await createReferral(
      participant.id,
      fx.project.id,
      fx.project.participant_prefix,
      { reason: 'Assessment', urgency: 'ROUTINE' },
      fx.thresholds,
    )
    const followup = followupsFor(participant.id)[0]
    await updateFollowup(followup.id, { outcome: 'COMPLETED' })

    const closed = followupsFor(participant.id)[0]
    expect(closed.outcome).toBe('COMPLETED')
    expect(closed.closed_at).toBeTruthy()
    expect(listFollowups(fx.project.id, { outcome: 'PENDING' })).toHaveLength(0)
  })
})

describe('clinical consultation', () => {
  it('stores a consultation and amends it without creating a second record', async () => {
    const id = await saveEncounter(participant.id, fx.project.id, {
      presentingConcerns: 'Headache',
      assessment: 'Screening findings reviewed',
    })
    await saveEncounter(
      participant.id,
      fx.project.id,
      { presentingConcerns: 'Headache and dizziness', assessment: 'Reviewed' },
      id,
    )
    const rows = encountersFor(participant.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].presenting_concerns).toBe('Headache and dizziness')
  })
})
