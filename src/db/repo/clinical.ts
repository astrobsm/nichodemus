/**
 * Clinical records: vital signs, blood glucose, consultations, wound care
 * and breast health (spec S20-S24).
 *
 * Every write stores the alert the configurable rule engine produced at the
 * time of entry, so a later threshold change does not silently rewrite what
 * the clinician was shown. Repeat measurements are inserted as new rows -
 * an earlier reading is never overwritten (spec S20, S52).
 */
import { query, queryOne, count, transaction } from '../sqlite'
import {
  boolInt,
  findAll,
  insertEnvelope,
  insertRow,
  nullIfBlank,
  softDelete,
  updateEnvelope,
  updateRow,
  type Value,
} from './base'
import { audit, AUDIT_ACTIONS, auditActor } from '../../core/audit'
import { nowIso } from '../../core/datetime'
import { woundCode } from '../../core/ids'
import { calculateBmi, glucoseToMmol, woundArea } from '../../core/validation'
import {
  evaluateBloodPressure,
  evaluateBreast,
  evaluateGlucose,
  evaluateWound,
  type Alert,
  type ClinicalThresholds,
  type FastingStatus,
} from '../../core/clinicalRules'

// --------------------------------------------------------------- vitals

export interface Vitals {
  id: number
  participant_id: number
  project_id: number
  reading_index: number
  bp_systolic: number | null
  bp_diastolic: number | null
  pulse: number | null
  weight_kg: number | null
  height_cm: number | null
  bmi: number | null
  temperature_c: number | null
  spo2: number | null
  arm: string | null
  posture: string | null
  device_label: string | null
  recorded_at: string
  recorded_by: string | null
  alert_level: string | null
  alert_message: string | null
  notes: string | null
}

export interface VitalsInput {
  systolic: number | null
  diastolic: number | null
  pulse?: number | null
  weightKg?: number | null
  heightCm?: number | null
  temperatureC?: number | null
  spo2?: number | null
  arm?: string
  posture?: string
  deviceLabel?: string
  stationId?: number | null
  notes?: string
}

export async function recordVitals(
  participantId: number,
  projectId: number,
  input: VitalsInput,
  thresholds: ClinicalThresholds,
  isDemo = false,
): Promise<{ id: number; alert: Alert }> {
  const alert = evaluateBloodPressure(input.systolic, input.diastolic, thresholds)
  const bmi = calculateBmi(input.weightKg ?? null, input.heightCm ?? null)

  const id = await transaction(() => {
    const readingIndex =
      count(
        'SELECT COALESCE(MAX(reading_index), 0) AS c FROM vitals WHERE participant_id = ?',
        [participantId],
      ) + 1

    const newId = insertRow('vitals', {
      ...insertEnvelope(),
      participant_id: participantId,
      project_id: projectId,
      reading_index: readingIndex,
      bp_systolic: input.systolic,
      bp_diastolic: input.diastolic,
      pulse: input.pulse ?? null,
      weight_kg: input.weightKg ?? null,
      height_cm: input.heightCm ?? null,
      bmi,
      temperature_c: input.temperatureC ?? null,
      spo2: input.spo2 ?? null,
      arm: nullIfBlank(input.arm),
      posture: nullIfBlank(input.posture),
      device_label: nullIfBlank(input.deviceLabel),
      station_id: input.stationId ?? null,
      recorded_at: nowIso(),
      recorded_by: auditActor().username,
      alert_level: alert.level,
      alert_message: alert.level === 'NORMAL' ? null : alert.message,
      notes: nullIfBlank(input.notes),
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'vitals',
      entityId: newId,
      summary: `Vital signs reading ${readingIndex} recorded (alert: ${alert.level})`,
      newValue: { systolic: input.systolic, diastolic: input.diastolic, reading: readingIndex },
    })
    return newId
  })

  return { id, alert }
}

export function vitalsFor(participantId: number): Vitals[] {
  return findAll<Vitals>('vitals', 'participant_id = ?', [participantId], 'reading_index, id')
}

export function latestVitals(participantId: number): Vitals | null {
  return queryOne<Vitals>(
    `SELECT * FROM vitals WHERE participant_id = ? AND deleted_at IS NULL
      ORDER BY reading_index DESC, id DESC LIMIT 1`,
    [participantId],
  )
}

// -------------------------------------------------------------- glucose

export interface GlucoseResult {
  id: number
  participant_id: number
  project_id: number
  test_type: string
  fasting_status: string
  value: number
  unit: string
  value_mmol: number
  device_label: string | null
  strip_lot: string | null
  tested_at: string
  operator: string | null
  alert_level: string | null
  alert_message: string | null
  notes: string | null
}

export interface GlucoseInput {
  value: number
  unit: string
  fastingStatus: FastingStatus
  testType?: string
  deviceLabel?: string
  stripLot?: string
  stationId?: number | null
  notes?: string
}

export async function recordGlucose(
  participantId: number,
  projectId: number,
  input: GlucoseInput,
  thresholds: ClinicalThresholds,
  isDemo = false,
): Promise<{ id: number; alert: Alert; valueMmol: number }> {
  const valueMmol = glucoseToMmol(input.value, input.unit)
  const alert = evaluateGlucose(valueMmol, input.fastingStatus, thresholds)

  const id = await transaction(() => {
    const newId = insertRow('glucose_results', {
      ...insertEnvelope(),
      participant_id: participantId,
      project_id: projectId,
      test_type: input.testType ?? 'CAPILLARY',
      fasting_status: input.fastingStatus,
      value: input.value,
      unit: input.unit,
      value_mmol: valueMmol,
      device_label: nullIfBlank(input.deviceLabel),
      strip_lot: nullIfBlank(input.stripLot),
      station_id: input.stationId ?? null,
      tested_at: nowIso(),
      operator: auditActor().username,
      alert_level: alert.level,
      alert_message: alert.level === 'NORMAL' ? null : alert.message,
      notes: nullIfBlank(input.notes),
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'glucose_result',
      entityId: newId,
      summary: `Glucose screening recorded (alert: ${alert.level})`,
      newValue: { value: input.value, unit: input.unit, fasting: input.fastingStatus },
    })
    return newId
  })

  return { id, alert, valueMmol }
}

export function glucoseFor(participantId: number): GlucoseResult[] {
  return findAll<GlucoseResult>(
    'glucose_results',
    'participant_id = ?',
    [participantId],
    'tested_at, id',
  )
}

export function latestGlucose(participantId: number): GlucoseResult | null {
  return queryOne<GlucoseResult>(
    `SELECT * FROM glucose_results WHERE participant_id = ? AND deleted_at IS NULL
      ORDER BY tested_at DESC, id DESC LIMIT 1`,
    [participantId],
  )
}

// ------------------------------------------------- clinical encounters

export interface ClinicalEncounter {
  id: number
  participant_id: number
  project_id: number
  encounter_at: string
  clinician: string | null
  presenting_concerns: string | null
  history: string | null
  examination: string | null
  screening_summary: string | null
  assessment: string | null
  advice: string | null
  treatment_given: string | null
  counselling_given: string | null
  referral_required: number
  followup_required: number
  notes: string | null
  version: number
}

export interface EncounterInput {
  presentingConcerns?: string
  history?: string
  examination?: string
  screeningSummary?: string
  assessment?: string
  advice?: string
  treatmentGiven?: string
  counsellingGiven?: string
  referralRequired?: boolean
  followupRequired?: boolean
  notes?: string
}

export async function saveEncounter(
  participantId: number,
  projectId: number,
  input: EncounterInput,
  encounterId?: number,
  isDemo = false,
): Promise<number> {
  return transaction(() => {
    const payload: Record<string, Value> = {
      presenting_concerns: nullIfBlank(input.presentingConcerns),
      history: nullIfBlank(input.history),
      examination: nullIfBlank(input.examination),
      screening_summary: nullIfBlank(input.screeningSummary),
      assessment: nullIfBlank(input.assessment),
      advice: nullIfBlank(input.advice),
      treatment_given: nullIfBlank(input.treatmentGiven),
      counselling_given: nullIfBlank(input.counsellingGiven),
      referral_required: boolInt(input.referralRequired),
      followup_required: boolInt(input.followupRequired),
      notes: nullIfBlank(input.notes),
    }

    if (encounterId) {
      const before = queryOne<ClinicalEncounter>(
        'SELECT * FROM clinical_encounters WHERE id = ?',
        [encounterId],
      )
      updateRow('clinical_encounters', encounterId, {
        ...updateEnvelope(before?.version),
        ...payload,
      })
      audit({
        action: AUDIT_ACTIONS.UPDATE,
        entityType: 'clinical_encounter',
        entityId: encounterId,
        summary: 'Clinical consultation amended',
      })
      return encounterId
    }

    const id = insertRow('clinical_encounters', {
      ...insertEnvelope(),
      participant_id: participantId,
      project_id: projectId,
      encounter_at: nowIso(),
      clinician: auditActor().username,
      ...payload,
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'clinical_encounter',
      entityId: id,
      summary: 'Clinical consultation documented',
    })
    return id
  })
}

export function encountersFor(participantId: number): ClinicalEncounter[] {
  return findAll<ClinicalEncounter>(
    'clinical_encounters',
    'participant_id = ?',
    [participantId],
    'encounter_at DESC, id DESC',
  )
}

// --------------------------------------------------------------- wounds

export interface Wound {
  id: number
  wound_code: string
  participant_id: number
  project_id: number
  location: string | null
  side: string | null
  duration_text: string | null
  cause: string | null
  status: string
  version: number
}

export interface WoundAssessment {
  id: number
  wound_id: number
  participant_id: number
  project_id: number
  assessed_at: string
  assessed_by: string | null
  length_cm: number | null
  width_cm: number | null
  depth_cm: number | null
  area_cm2: number | null
  tissue_type: string | null
  exudate_amount: string | null
  exudate_type: string | null
  odour: string | null
  wound_edge: string | null
  surrounding_skin: string | null
  infection_signs: string | null
  pain_score: number | null
  swelling: string | null
  necrosis: string | null
  previous_treatment: string | null
  cleansing_done: string | null
  dressing_applied: number
  dressing_type: string | null
  advice: string | null
  next_dressing_date: string | null
  referral_required: number
  alert_level: string | null
  alert_message: string | null
  notes: string | null
}

export interface WoundInput {
  location: string
  side?: string
  durationText?: string
  cause?: string
}

export interface WoundAssessmentInput {
  lengthCm?: number | null
  widthCm?: number | null
  depthCm?: number | null
  tissueType?: string
  exudateAmount?: string
  exudateType?: string
  odour?: string
  woundEdge?: string
  surroundingSkin?: string
  infectionSigns?: string
  painScore?: number | null
  swelling?: string
  necrosis?: string
  previousTreatment?: string
  cleansingDone?: string
  dressingApplied?: boolean
  dressingType?: string
  advice?: string
  nextDressingDate?: string
  notes?: string
}

export async function createWound(
  participantId: number,
  projectId: number,
  prefix: string,
  input: WoundInput,
  isDemo = false,
): Promise<Wound> {
  return transaction(() => {
    const serial =
      count('SELECT COUNT(*) AS c FROM wounds WHERE project_id = ?', [projectId]) + 1
    const code = woundCode(prefix, serial)
    const id = insertRow('wounds', {
      ...insertEnvelope(),
      wound_code: code,
      participant_id: participantId,
      project_id: projectId,
      location: input.location,
      side: nullIfBlank(input.side),
      duration_text: nullIfBlank(input.durationText),
      cause: nullIfBlank(input.cause),
      status: 'OPEN',
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'wound',
      entityId: id,
      summary: `Wound ${code} recorded at ${input.location}`,
    })
    return queryOne<Wound>('SELECT * FROM wounds WHERE id = ?', [id])!
  })
}

export async function recordWoundAssessment(
  wound: Wound,
  input: WoundAssessmentInput,
  thresholds: ClinicalThresholds,
  isDemo = false,
): Promise<{ id: number; alert: Alert; areaCm2: number | null }> {
  const areaCm2 = woundArea(input.lengthCm ?? null, input.widthCm ?? null)
  const alert = evaluateWound(
    {
      areaCm2,
      painScore: input.painScore ?? null,
      infectionSigns: input.infectionSigns ?? null,
      necrosis: input.necrosis ?? null,
      odour: input.odour ?? null,
      exudateAmount: input.exudateAmount ?? null,
    },
    thresholds,
  )

  const id = await transaction(() => {
    const newId = insertRow('wound_assessments', {
      ...insertEnvelope(),
      wound_id: wound.id,
      participant_id: wound.participant_id,
      project_id: wound.project_id,
      assessed_at: nowIso(),
      assessed_by: auditActor().username,
      length_cm: input.lengthCm ?? null,
      width_cm: input.widthCm ?? null,
      depth_cm: input.depthCm ?? null,
      area_cm2: areaCm2,
      tissue_type: nullIfBlank(input.tissueType),
      exudate_amount: nullIfBlank(input.exudateAmount),
      exudate_type: nullIfBlank(input.exudateType),
      odour: nullIfBlank(input.odour),
      wound_edge: nullIfBlank(input.woundEdge),
      surrounding_skin: nullIfBlank(input.surroundingSkin),
      infection_signs: nullIfBlank(input.infectionSigns),
      pain_score: input.painScore ?? null,
      swelling: nullIfBlank(input.swelling),
      necrosis: nullIfBlank(input.necrosis),
      previous_treatment: nullIfBlank(input.previousTreatment),
      cleansing_done: nullIfBlank(input.cleansingDone),
      dressing_applied: boolInt(input.dressingApplied),
      dressing_type: nullIfBlank(input.dressingType),
      advice: nullIfBlank(input.advice),
      next_dressing_date: nullIfBlank(input.nextDressingDate),
      referral_required: boolInt(alert.suggestReferral),
      alert_level: alert.level,
      alert_message: alert.level === 'NORMAL' ? null : alert.message,
      notes: nullIfBlank(input.notes),
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'wound_assessment',
      entityId: newId,
      summary: `Wound assessment for ${wound.wound_code} recorded (alert: ${alert.level})`,
    })
    return newId
  })

  return { id, alert, areaCm2 }
}

export function woundsFor(participantId: number): Wound[] {
  return findAll<Wound>('wounds', 'participant_id = ?', [participantId], 'id DESC')
}

export function assessmentsForWound(woundId: number): WoundAssessment[] {
  return findAll<WoundAssessment>(
    'wound_assessments',
    'wound_id = ?',
    [woundId],
    'assessed_at DESC, id DESC',
  )
}

export function woundAssessmentsFor(participantId: number): WoundAssessment[] {
  return findAll<WoundAssessment>(
    'wound_assessments',
    'participant_id = ?',
    [participantId],
    'assessed_at DESC, id DESC',
  )
}

export async function setWoundStatus(woundId: number, status: string): Promise<void> {
  const before = queryOne<Wound>('SELECT * FROM wounds WHERE id = ?', [woundId])
  await transaction(() => {
    updateRow('wounds', woundId, { ...updateEnvelope(before?.version), status })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'wound',
      entityId: woundId,
      summary: `Wound status changed to ${status}`,
      previousValue: before?.status,
      newValue: status,
    })
  })
}

// --------------------------------------------------------------- breast

export interface BreastExamination {
  id: number
  participant_id: number
  project_id: number
  examined_at: string
  examiner: string | null
  chaperone_present: number
  breast_examined: string
  no_abnormality: number
  lump_present: number
  lump_side: string | null
  lump_location: string | null
  lump_size_mm: number | null
  lump_mobility: string | null
  lump_tenderness: string | null
  lump_consistency: string | null
  nipple_discharge: string | null
  skin_change: string | null
  nipple_change: string | null
  axillary_finding: string | null
  pain: string | null
  other_finding: string | null
  bse_taught: number
  referral_required: number
  alert_level: string | null
  alert_message: string | null
  notes: string | null
}

export interface BreastInput {
  breastExamined: string
  chaperonePresent?: boolean
  noAbnormality?: boolean
  lumpPresent?: boolean
  lumpSide?: string
  lumpLocation?: string
  lumpSizeMm?: number | null
  lumpMobility?: string
  lumpTenderness?: string
  lumpConsistency?: string
  nippleDischarge?: string
  skinChange?: string
  nippleChange?: string
  axillaryFinding?: string
  pain?: string
  otherFinding?: string
  bseTaught?: boolean
  notes?: string
}

export async function recordBreastExamination(
  participantId: number,
  projectId: number,
  input: BreastInput,
  thresholds: ClinicalThresholds,
  isDemo = false,
): Promise<{ id: number; alert: Alert }> {
  const alert = evaluateBreast(
    {
      noAbnormality: Boolean(input.noAbnormality),
      lumpPresent: Boolean(input.lumpPresent),
      lumpSizeMm: input.lumpSizeMm ?? null,
      nippleDischarge: input.nippleDischarge ?? null,
      skinChange: input.skinChange ?? null,
      nippleChange: input.nippleChange ?? null,
      axillaryFinding: input.axillaryFinding ?? null,
      otherFinding: input.otherFinding ?? null,
    },
    thresholds,
  )

  const id = await transaction(() => {
    const newId = insertRow('breast_examinations', {
      ...insertEnvelope(),
      participant_id: participantId,
      project_id: projectId,
      examined_at: nowIso(),
      examiner: auditActor().username,
      chaperone_present: boolInt(input.chaperonePresent),
      breast_examined: input.breastExamined,
      no_abnormality: boolInt(input.noAbnormality),
      lump_present: boolInt(input.lumpPresent),
      lump_side: nullIfBlank(input.lumpSide),
      lump_location: nullIfBlank(input.lumpLocation),
      lump_size_mm: input.lumpSizeMm ?? null,
      lump_mobility: nullIfBlank(input.lumpMobility),
      lump_tenderness: nullIfBlank(input.lumpTenderness),
      lump_consistency: nullIfBlank(input.lumpConsistency),
      nipple_discharge: nullIfBlank(input.nippleDischarge),
      skin_change: nullIfBlank(input.skinChange),
      nipple_change: nullIfBlank(input.nippleChange),
      axillary_finding: nullIfBlank(input.axillaryFinding),
      pain: nullIfBlank(input.pain),
      other_finding: nullIfBlank(input.otherFinding),
      bse_taught: boolInt(input.bseTaught),
      referral_required: boolInt(alert.suggestReferral),
      alert_level: alert.level,
      alert_message: alert.level === 'NORMAL' ? null : alert.message,
      notes: nullIfBlank(input.notes),
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'breast_examination',
      entityId: newId,
      summary: `Breast examination recorded (alert: ${alert.level})`,
    })
    return newId
  })

  return { id, alert }
}

export function breastExamsFor(participantId: number): BreastExamination[] {
  return findAll<BreastExamination>(
    'breast_examinations',
    'participant_id = ?',
    [participantId],
    'examined_at DESC, id DESC',
  )
}

// -------------------------------------------------------- soft deletion

export async function softDeleteClinicalRecord(
  table: 'vitals' | 'glucose_results' | 'clinical_encounters' | 'wound_assessments' | 'breast_examinations',
  id: number,
  reason: string,
): Promise<void> {
  await transaction(() => {
    softDelete(table, id)
    audit({
      action: AUDIT_ACTIONS.DELETE,
      entityType: table,
      entityId: id,
      summary: `Record marked deleted. Reason: ${reason}`,
    })
  })
}

/** Screening summary text a clinician can paste into a consultation note. */
export function screeningSummaryText(participantId: number): string {
  const v = latestVitals(participantId)
  const g = latestGlucose(participantId)
  const parts: string[] = []
  if (v && v.bp_systolic !== null) {
    parts.push(`BP ${v.bp_systolic}/${v.bp_diastolic} mmHg${v.pulse ? `, pulse ${v.pulse}` : ''}`)
    const all = vitalsFor(participantId)
    if (all.length > 1) parts.push(`(${all.length} readings recorded)`)
  }
  if (v?.bmi) parts.push(`BMI ${v.bmi}`)
  if (g) {
    parts.push(
      `Capillary glucose ${g.value} ${g.unit} (${g.fasting_status.toLowerCase().replace('_', '-')})`,
    )
  }
  return parts.length ? parts.join('; ') : 'No screening measurements recorded yet.'
}

export function projectClinicalCounts(projectId: number): {
  vitals: number
  glucose: number
  encounters: number
  wounds: number
  breast: number
} {
  const c = (t: string) =>
    count(`SELECT COUNT(*) AS c FROM ${t} WHERE project_id = ? AND deleted_at IS NULL`, [projectId])
  return {
    vitals: c('vitals'),
    glucose: c('glucose_results'),
    encounters: c('clinical_encounters'),
    wounds: c('wound_assessments'),
    breast: c('breast_examinations'),
  }
}

export function urgentAlerts(projectId: number, limit = 20): {
  participant_code: string
  participant_id: number
  source: string
  alert_level: string
  alert_message: string
  occurred_at: string
}[] {
  return query(
    `SELECT p.participant_code, p.id AS participant_id, 'Blood pressure' AS source,
            v.alert_level, v.alert_message, v.recorded_at AS occurred_at
       FROM vitals v JOIN participants p ON p.id = v.participant_id
      WHERE v.project_id = ? AND v.deleted_at IS NULL AND v.alert_level = 'URGENT'
      UNION ALL
     SELECT p.participant_code, p.id, 'Blood glucose', g.alert_level, g.alert_message, g.tested_at
       FROM glucose_results g JOIN participants p ON p.id = g.participant_id
      WHERE g.project_id = ? AND g.deleted_at IS NULL AND g.alert_level = 'URGENT'
      UNION ALL
     SELECT p.participant_code, p.id, 'Wound care', w.alert_level, w.alert_message, w.assessed_at
       FROM wound_assessments w JOIN participants p ON p.id = w.participant_id
      WHERE w.project_id = ? AND w.deleted_at IS NULL AND w.alert_level = 'URGENT'
      ORDER BY occurred_at DESC LIMIT ?`,
    [projectId, projectId, projectId, limit],
  )
}
