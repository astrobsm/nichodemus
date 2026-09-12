/**
 * Demonstration data (spec S71).
 *
 * Every row written here carries is_demo = 1 so it can be removed again
 * without touching a single real clinical record. The UI shows a permanent
 * DEMO DATA ribbon while demo mode is on.
 */
import { transaction, run, count } from '../db/sqlite'
import { audit, AUDIT_ACTIONS } from '../core/audit'
import { setSetting } from '../db/repo/settings'
import { SETTING_KEYS } from '../core/constants'
import { registerParticipant, moveParticipant } from '../db/repo/participants'
import { recordVitals, recordGlucose, recordBreastExamination, createWound, recordWoundAssessment, saveEncounter } from '../db/repo/clinical'
import { createReferral, saveFacility } from '../db/repo/referrals'
import { createInventoryItem } from '../db/repo/inventory'
import { saveTeamMember, saveTask, saveMobilisation } from '../db/repo/planning'
import type { Project } from '../db/repo/projects'
import type { ClinicalThresholds } from '../core/clinicalRules'

const SURNAMES = [
  'Okeke', 'Eze', 'Nwosu', 'Ugwu', 'Onyeka', 'Aneke', 'Chukwu', 'Obi', 'Nnaji',
  'Agu', 'Mbah', 'Okafor', 'Ezeani', 'Nwankwo', 'Odo',
]
const FEMALE_NAMES = [
  'Ngozi', 'Chidinma', 'Adaeze', 'Uchenna', 'Ifeoma', 'Nneka', 'Chiamaka',
  'Amaka', 'Oluchi', 'Chinwe',
]
const MALE_NAMES = [
  'Emeka', 'Obinna', 'Chidi', 'Ikenna', 'Nnamdi', 'Uche', 'Chukwudi',
  'Ebuka', 'Kelechi', 'Ifeanyi',
]
const COMMUNITIES = ['Umunna', 'Umuhu', 'Owelli', 'Amoli', 'Ihe', 'Agbogugu', 'Mgbowo']
const OCCUPATIONS = ['Farmer', 'Trader', 'Teacher', 'Artisan', 'Student', 'Retired', 'Civil servant']

/** Deterministic pseudo-random generator so demo runs are reproducible. */
function makeRandom(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

export interface DemoOptions {
  participants: number
  seed?: number
}

export async function generateDemoData(
  project: Project,
  thresholds: ClinicalThresholds,
  options: DemoOptions,
): Promise<{ participants: number }> {
  const rand = makeRandom(options.seed ?? 20261229)

  // Reference data first, so clinical rows can point at it.
  await transaction(() => {
    setSetting(SETTING_KEYS.DEMO_MODE, 'true')
    saveFacility(
      {
        name: 'Awgu General Hospital (DEMO)',
        facility_type: 'General hospital',
        location: 'Awgu',
        phone: '08030000001',
        services: 'Medical outpatient, laboratory, minor surgery',
        project_id: project.id,
      },
      undefined,
      true,
    )
    saveFacility(
      {
        name: 'Owelli Primary Health Centre (DEMO)',
        facility_type: 'Primary health centre',
        location: 'Owelli Court, Awgu LGA',
        phone: '08030000002',
        services: 'Primary care, wound dressing, antenatal',
        project_id: project.id,
      },
      undefined,
      true,
    )
  })

  const demoItems = [
    { name: 'Glucometer test strips (DEMO)', category: 'Glucose supplies', unit: 'strip', qty: 600, min: 100 },
    { name: 'Lancets (DEMO)', category: 'Glucose supplies', unit: 'piece', qty: 600, min: 100 },
    { name: 'Examination gloves (DEMO)', category: 'PPE', unit: 'pair', qty: 400, min: 80 },
    { name: 'Gauze swabs (DEMO)', category: 'Wound care supplies', unit: 'pack', qty: 120, min: 25 },
    { name: 'Normal saline 500ml (DEMO)', category: 'Wound care supplies', unit: 'bottle', qty: 60, min: 12 },
    { name: 'Digital BP machine (DEMO)', category: 'Medical equipment', unit: 'unit', qty: 6, min: 2 },
  ]
  for (const it of demoItems) {
    await createInventoryItem(
      project.id,
      {
        name: it.name,
        category: it.category,
        unit: it.unit,
        openingQty: it.qty,
        minStock: it.min,
      },
      true,
    )
  }

  const demoTeam = [
    { fullName: 'Dr A. Demo', role: 'Doctor', professionalCategory: 'Medical' },
    { fullName: 'Nurse B. Demo', role: 'Nurse', professionalCategory: 'Nursing' },
    { fullName: 'Lab C. Demo', role: 'Medical Laboratory Scientist', professionalCategory: 'Laboratory' },
    { fullName: 'Volunteer D. Demo', role: 'Volunteer', professionalCategory: 'Volunteer', isVolunteer: true },
  ]
  for (const t of demoTeam) {
    await saveTeamMember(project.id, project.participant_prefix, t, undefined, true)
  }

  await saveTask(
    project.id,
    project.participant_prefix,
    {
      title: 'Confirm referral facility arrangements (DEMO)',
      category: 'Clinical preparation',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
    },
    undefined,
    true,
  )
  await saveMobilisation(
    project.id,
    {
      activity: 'Church announcements (DEMO)',
      activityType: 'Church announcement',
      expectedReach: 300,
      actualReach: 260,
      status: 'COMPLETED',
    },
    undefined,
    true,
  )

  // Participants and their clinical records.
  let created = 0
  for (let i = 0; i < options.participants; i++) {
    const female = rand() < 0.62
    const first = pick(rand, female ? FEMALE_NAMES : MALE_NAMES)
    const last = pick(rand, SURNAMES)
    const age = 18 + Math.floor(rand() * 62)

    const participant = await registerParticipant(
      project,
      {
        firstName: first,
        lastName: `${last} (DEMO)`,
        sex: female ? 'FEMALE' : 'MALE',
        ageYears: age,
        ageIsEstimated: true,
        community: pick(rand, COMMUNITIES),
        occupation: pick(rand, OCCUPATIONS),
        phone: `080${String(30000000 + Math.floor(rand() * 9999999)).slice(0, 8)}`,
        knownHypertension: rand() < 0.15 ? 'YES' : 'NO',
        knownDiabetes: rand() < 0.06 ? 'YES' : 'NO',
        consentStatus: 'GIVEN',
        consentObtainedBy: 'Demo data',
      },
      { overrideDuplicate: true, overrideReason: 'Demonstration data', isDemo: true },
    )
    created++

    // Blood pressure - a realistic mix, skewed by age.
    const sys = Math.round(105 + rand() * 55 + (age > 45 ? 12 : 0))
    const dia = Math.round(65 + rand() * 30 + (age > 45 ? 6 : 0))
    const { alert: bpAlert } = await recordVitals(
      participant.id,
      project.id,
      {
        systolic: sys,
        diastolic: Math.min(dia, sys - 15),
        pulse: Math.round(62 + rand() * 30),
        weightKg: Math.round((50 + rand() * 40) * 10) / 10,
        heightCm: Math.round(150 + rand() * 25),
        deviceLabel: 'DEMO BP unit',
      },
      thresholds,
      true,
    )

    if (rand() < 0.9) {
      await recordGlucose(
        participant.id,
        project.id,
        {
          value: Math.round((4.2 + rand() * 6.5) * 10) / 10,
          unit: 'mmol/L',
          fastingStatus: rand() < 0.3 ? 'FASTING' : 'NON_FASTING',
          deviceLabel: 'DEMO glucometer',
        },
        thresholds,
        true,
      )
    }

    if (female && age >= 25 && rand() < 0.45) {
      const lump = rand() < 0.08
      await recordBreastExamination(
        participant.id,
        project.id,
        {
          breastExamined: 'BILATERAL',
          chaperonePresent: true,
          noAbnormality: !lump,
          lumpPresent: lump,
          lumpSide: lump ? (rand() < 0.5 ? 'LEFT' : 'RIGHT') : undefined,
          lumpLocation: lump ? 'Upper outer quadrant' : undefined,
          lumpSizeMm: lump ? Math.round(10 + rand() * 25) : null,
          bseTaught: true,
        },
        thresholds,
        true,
      )
    }

    if (rand() < 0.1) {
      const wound = await createWound(
        participant.id,
        project.id,
        project.participant_prefix,
        { location: 'Lower leg', side: rand() < 0.5 ? 'LEFT' : 'RIGHT', cause: 'Trauma' },
        true,
      )
      await recordWoundAssessment(
        wound,
        {
          lengthCm: Math.round((2 + rand() * 6) * 10) / 10,
          widthCm: Math.round((1 + rand() * 4) * 10) / 10,
          tissueType: 'Granulating',
          exudateAmount: 'MODERATE',
          painScore: Math.floor(rand() * 8),
          dressingApplied: true,
          dressingType: 'Saline gauze',
        },
        thresholds,
        true,
      )
    }

    await saveEncounter(
      participant.id,
      project.id,
      {
        presentingConcerns: 'Demonstration record - routine screening review.',
        assessment: 'Screening findings reviewed with the participant.',
        advice: 'Lifestyle advice provided. Demonstration data only.',
        referralRequired: bpAlert.suggestReferral,
      },
      undefined,
      true,
    )

    if (bpAlert.suggestReferral || rand() < 0.08) {
      await createReferral(
        participant.id,
        project.id,
        project.participant_prefix,
        {
          reason: bpAlert.suggestReferral
            ? 'Elevated blood pressure screening measurement'
            : 'Further clinical assessment required',
          urgency: bpAlert.level === 'URGENT' ? 'URGENT' : 'PRIORITY',
          sourceModule: 'DEMO',
          facilityName: 'Awgu General Hospital (DEMO)',
        },
        thresholds,
        true,
      )
    }

    await moveParticipant(participant.id, rand() < 0.82 ? 'COMPLETED' : 'CLINICAL_REVIEW')
  }

  await transaction(() => {
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'demo_data',
      entityId: project.id,
      summary: `Demonstration data generated: ${created} participants`,
    })
  })

  return { participants: created }
}

const DEMO_TABLES = [
  'queue_events',
  'consents',
  'vitals',
  'glucose_results',
  'clinical_encounters',
  'wound_assessments',
  'wounds',
  'breast_examinations',
  'followups',
  'referrals',
  'inventory_transactions',
  'inventory_items',
  'procurement',
  'expenses',
  'budget_items',
  'mobilisation_activities',
  'logistics_items',
  'event_checklists',
  'tasks',
  'attendance',
  'team_members',
  'participants',
  'facilities',
  'suppliers',
]

export function demoRecordCount(): number {
  let total = 0
  for (const table of DEMO_TABLES) {
    try {
      total += count(`SELECT COUNT(*) AS c FROM ${table} WHERE is_demo = 1`)
    } catch {
      // Table has no is_demo column; nothing to count.
    }
  }
  return total
}

/**
 * Removes demonstration rows only. Real clinical records are untouched
 * because they carry is_demo = 0.
 */
export async function clearDemoData(): Promise<{ removed: number }> {
  const before = demoRecordCount()
  await transaction(() => {
    for (const table of DEMO_TABLES) {
      try {
        run(`DELETE FROM ${table} WHERE is_demo = 1`)
      } catch {
        // Table has no is_demo column; skip it.
      }
    }
    setSetting(SETTING_KEYS.DEMO_MODE, 'false')
    audit({
      action: AUDIT_ACTIONS.DEMO_CLEAR,
      entityType: 'demo_data',
      summary: `Demonstration data cleared: ${before} rows removed`,
    })
  })
  return { removed: before }
}

export function setDemoMode(on: boolean): void {
  setSetting(SETTING_KEYS.DEMO_MODE, on ? 'true' : 'false')
}
