/**
 * Analytics (spec S42, S43, S75, S79).
 *
 * Every figure is derived from the database with SQL - nothing is counted by
 * hand in the UI. Language throughout distinguishes a SCREENING FINDING from
 * a CLINICAL DIAGNOSIS (spec S80).
 */
import { query, queryOne, count } from '../sqlite'
import { AGE_BANDS } from '../../core/constants'
import { today } from '../../core/datetime'

export interface ReachStats {
  expected: number
  registered: number
  screened: number
  completed: number
  waiting: number
  inProgress: number
}

export function reachStats(projectId: number, expected: number): ReachStats {
  const registered = count(
    'SELECT COUNT(*) AS c FROM participants WHERE project_id = ? AND deleted_at IS NULL',
    [projectId],
  )
  // "Screened" means at least one screening measurement exists.
  const screened = count(
    `SELECT COUNT(DISTINCT p.id) AS c FROM participants p
      WHERE p.project_id = ? AND p.deleted_at IS NULL
        AND (EXISTS (SELECT 1 FROM vitals v WHERE v.participant_id = p.id AND v.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM glucose_results g WHERE g.participant_id = p.id AND g.deleted_at IS NULL))`,
    [projectId],
  )
  const completed = count(
    `SELECT COUNT(*) AS c FROM participants
      WHERE project_id = ? AND deleted_at IS NULL AND workflow_status = 'COMPLETED'`,
    [projectId],
  )
  const waiting = count(
    `SELECT COUNT(*) AS c FROM participants
      WHERE project_id = ? AND deleted_at IS NULL AND workflow_status IN ('REGISTERED','WAITING')`,
    [projectId],
  )
  return {
    expected,
    registered,
    screened,
    completed,
    waiting,
    inProgress: registered - completed - waiting,
  }
}

export interface DemographicStats {
  total: number
  female: number
  male: number
  ageBands: { label: string; count: number; percent: number }[]
  ageNotRecorded: number
  meanAge: number | null
  communities: { community: string; count: number }[]
}

export function demographics(projectId: number): DemographicStats {
  const total = count(
    'SELECT COUNT(*) AS c FROM participants WHERE project_id = ? AND deleted_at IS NULL',
    [projectId],
  )
  const bySex = new Map<string, number>()
  for (const r of query<{ sex: string; c: number }>(
    `SELECT sex, COUNT(*) AS c FROM participants
      WHERE project_id = ? AND deleted_at IS NULL GROUP BY sex`,
    [projectId],
  )) {
    bySex.set(r.sex, Number(r.c))
  }

  const ageBands = AGE_BANDS.map((band) => {
    const n = count(
      `SELECT COUNT(*) AS c FROM participants
        WHERE project_id = ? AND deleted_at IS NULL
          AND age_years IS NOT NULL AND age_years BETWEEN ? AND ?`,
      [projectId, band.min, band.max],
    )
    return { label: band.label, count: n, percent: total ? round1((n / total) * 100) : 0 }
  })

  const ageNotRecorded = count(
    `SELECT COUNT(*) AS c FROM participants
      WHERE project_id = ? AND deleted_at IS NULL AND age_years IS NULL`,
    [projectId],
  )

  const meanRow = queryOne<{ m: number | null }>(
    `SELECT AVG(age_years) AS m FROM participants
      WHERE project_id = ? AND deleted_at IS NULL AND age_years IS NOT NULL`,
    [projectId],
  )

  const communities = query<{ community: string; count: number }>(
    `SELECT COALESCE(community, 'Not recorded') AS community, COUNT(*) AS count
       FROM participants WHERE project_id = ? AND deleted_at IS NULL
      GROUP BY COALESCE(community, 'Not recorded') ORDER BY count DESC LIMIT 15`,
    [projectId],
  )

  return {
    total,
    female: bySex.get('FEMALE') ?? 0,
    male: bySex.get('MALE') ?? 0,
    ageBands,
    ageNotRecorded,
    meanAge: meanRow?.m === null || meanRow?.m === undefined ? null : round1(Number(meanRow.m)),
    communities,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export interface ScreeningStats {
  bpParticipants: number
  bpReadings: number
  bpElevated: number
  bpUrgent: number
  bpRepeated: number
  glucoseParticipants: number
  glucoseTests: number
  glucoseAbnormal: number
  glucoseUrgent: number
  glucoseFasting: number
  breastExams: number
  breastAbnormal: number
  breastLumps: number
  woundsAssessed: number
  woundParticipants: number
  woundAlerts: number
  clinicalReviews: number
}

/**
 * Counts participants, not readings, for the "abnormal" figures: a person
 * with three elevated readings is one person with an elevated screening
 * result, not three.
 */
export function screeningStats(projectId: number): ScreeningStats {
  const distinct = (table: string, where = '') =>
    count(
      `SELECT COUNT(DISTINCT participant_id) AS c FROM ${table}
        WHERE project_id = ? AND deleted_at IS NULL ${where}`,
      [projectId],
    )
  const rows = (table: string, where = '') =>
    count(
      `SELECT COUNT(*) AS c FROM ${table} WHERE project_id = ? AND deleted_at IS NULL ${where}`,
      [projectId],
    )

  return {
    bpParticipants: distinct('vitals', 'AND bp_systolic IS NOT NULL'),
    bpReadings: rows('vitals', 'AND bp_systolic IS NOT NULL'),
    bpElevated: distinct('vitals', "AND alert_level IN ('ATTENTION','URGENT')"),
    bpUrgent: distinct('vitals', "AND alert_level = 'URGENT'"),
    bpRepeated: count(
      `SELECT COUNT(*) AS c FROM (
         SELECT participant_id FROM vitals
          WHERE project_id = ? AND deleted_at IS NULL AND bp_systolic IS NOT NULL
          GROUP BY participant_id HAVING COUNT(*) > 1)`,
      [projectId],
    ),
    glucoseParticipants: distinct('glucose_results'),
    glucoseTests: rows('glucose_results'),
    glucoseAbnormal: distinct('glucose_results', "AND alert_level IN ('ATTENTION','URGENT')"),
    glucoseUrgent: distinct('glucose_results', "AND alert_level = 'URGENT'"),
    glucoseFasting: rows('glucose_results', "AND fasting_status = 'FASTING'"),
    breastExams: rows('breast_examinations'),
    breastAbnormal: distinct('breast_examinations', 'AND no_abnormality = 0'),
    breastLumps: distinct('breast_examinations', 'AND lump_present = 1'),
    woundsAssessed: rows('wound_assessments'),
    woundParticipants: distinct('wound_assessments'),
    woundAlerts: distinct('wound_assessments', "AND alert_level IN ('ATTENTION','URGENT')"),
    clinicalReviews: distinct('clinical_encounters'),
  }
}

export interface DailyStats {
  date: string
  registered: number
  screened: number
  completed: number
  waiting: number
  bp: number
  glucose: number
  clinical: number
  wound: number
  breast: number
  referrals: number
  urgentReferrals: number
}

/** Event-day dashboard figures for one calendar day (spec S41). */
export function dailyStats(projectId: number, date = today()): DailyStats {
  const onDay = (table: string, column: string, extra = '') =>
    count(
      `SELECT COUNT(*) AS c FROM ${table}
        WHERE project_id = ? AND deleted_at IS NULL AND substr(${column}, 1, 10) = ? ${extra}`,
      [projectId, date],
    )

  const registered = onDay('participants', 'registered_at')
  const completed = onDay('participants', 'completed_at')
  const waiting = count(
    `SELECT COUNT(*) AS c FROM participants
      WHERE project_id = ? AND deleted_at IS NULL
        AND workflow_status NOT IN ('COMPLETED')`,
    [projectId],
  )
  const screened = count(
    `SELECT COUNT(DISTINCT p.id) AS c FROM participants p
      WHERE p.project_id = ? AND p.deleted_at IS NULL
        AND (EXISTS (SELECT 1 FROM vitals v WHERE v.participant_id = p.id
                       AND v.deleted_at IS NULL AND substr(v.recorded_at,1,10) = ?)
          OR EXISTS (SELECT 1 FROM glucose_results g WHERE g.participant_id = p.id
                       AND g.deleted_at IS NULL AND substr(g.tested_at,1,10) = ?))`,
    [projectId, date, date],
  )

  return {
    date,
    registered,
    screened,
    completed,
    waiting,
    bp: onDay('vitals', 'recorded_at'),
    glucose: onDay('glucose_results', 'tested_at'),
    clinical: onDay('clinical_encounters', 'encounter_at'),
    wound: onDay('wound_assessments', 'assessed_at'),
    breast: onDay('breast_examinations', 'examined_at'),
    referrals: onDay('referrals', 'referral_date'),
    urgentReferrals: onDay(
      'referrals',
      'referral_date',
      "AND urgency IN ('URGENT','EMERGENCY')",
    ),
  }
}

/** Referral rate as a percentage of screened participants (spec S75). */
export function referralRate(projectId: number, expected: number): number {
  const reach = reachStats(projectId, expected)
  const referred = count(
    `SELECT COUNT(DISTINCT participant_id) AS c FROM referrals
      WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId],
  )
  if (reach.screened === 0) return 0
  return round1((referred / reach.screened) * 100)
}

export function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0
  return round1((numerator / denominator) * 100)
}

// ------------------------------------------------------- data quality

export interface DataQualityReport {
  totalParticipants: number
  completeRecords: number
  incompleteRecords: number
  missingBp: number
  missingGlucose: number
  missingClinicalReview: number
  missingConsent: number
  missingAge: number
  missingPhone: number
  duplicateWarnings: number
  referralsWithoutOutcome: number
  openFollowups: number
  issues: { label: string; count: number; detail: string }[]
}

/**
 * The pre-report checklist (spec S76). "Complete" here means the participant
 * has consent recorded, an age, a BP reading and a clinical review.
 */
export function dataQuality(projectId: number): DataQualityReport {
  const total = count(
    'SELECT COUNT(*) AS c FROM participants WHERE project_id = ? AND deleted_at IS NULL',
    [projectId],
  )

  const missing = (sql: string) => count(sql, [projectId])

  const missingBp = missing(
    `SELECT COUNT(*) AS c FROM participants p
      WHERE p.project_id = ? AND p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM vitals v
                         WHERE v.participant_id = p.id AND v.deleted_at IS NULL
                           AND v.bp_systolic IS NOT NULL)`,
  )
  const missingGlucose = missing(
    `SELECT COUNT(*) AS c FROM participants p
      WHERE p.project_id = ? AND p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM glucose_results g
                         WHERE g.participant_id = p.id AND g.deleted_at IS NULL)`,
  )
  const missingClinical = missing(
    `SELECT COUNT(*) AS c FROM participants p
      WHERE p.project_id = ? AND p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM clinical_encounters e
                         WHERE e.participant_id = p.id AND e.deleted_at IS NULL)`,
  )
  const missingConsent = missing(
    `SELECT COUNT(*) AS c FROM participants p
      WHERE p.project_id = ? AND p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM consents c
                         WHERE c.participant_id = p.id AND c.deleted_at IS NULL
                           AND c.status = 'GIVEN')`,
  )
  const missingAge = missing(
    `SELECT COUNT(*) AS c FROM participants
      WHERE project_id = ? AND deleted_at IS NULL AND age_years IS NULL`,
  )
  const missingPhone = missing(
    `SELECT COUNT(*) AS c FROM participants
      WHERE project_id = ? AND deleted_at IS NULL AND (phone IS NULL OR phone = '')`,
  )
  const duplicateWarnings = missing(
    `SELECT COUNT(*) AS c FROM participants
      WHERE project_id = ? AND deleted_at IS NULL AND duplicate_override_by IS NOT NULL`,
  )
  const referralsWithoutOutcome = missing(
    `SELECT COUNT(*) AS c FROM referrals
      WHERE project_id = ? AND deleted_at IS NULL
        AND status IN ('RECOMMENDED','ISSUED','PATIENT_INFORMED','UNKNOWN')`,
  )
  const openFollowups = missing(
    `SELECT COUNT(*) AS c FROM followups
      WHERE project_id = ? AND deleted_at IS NULL
        AND outcome NOT IN ('COMPLETED','DECLINED')`,
  )

  const complete = missing(
    `SELECT COUNT(*) AS c FROM participants p
      WHERE p.project_id = ? AND p.deleted_at IS NULL
        AND p.age_years IS NOT NULL
        AND EXISTS (SELECT 1 FROM consents c WHERE c.participant_id = p.id
                      AND c.deleted_at IS NULL AND c.status = 'GIVEN')
        AND EXISTS (SELECT 1 FROM vitals v WHERE v.participant_id = p.id
                      AND v.deleted_at IS NULL AND v.bp_systolic IS NOT NULL)
        AND EXISTS (SELECT 1 FROM clinical_encounters e WHERE e.participant_id = p.id
                      AND e.deleted_at IS NULL)`,
  )

  const issues = [
    {
      label: 'Missing blood pressure',
      count: missingBp,
      detail: 'Participants with no blood pressure reading recorded.',
    },
    {
      label: 'Missing glucose screening',
      count: missingGlucose,
      detail: 'Participants with no glucose result recorded.',
    },
    {
      label: 'Missing clinical review',
      count: missingClinical,
      detail: 'Participants with no clinical consultation documented.',
    },
    {
      label: 'Missing consent record',
      count: missingConsent,
      detail: 'Participants without a recorded consent of status GIVEN.',
    },
    {
      label: 'Missing age',
      count: missingAge,
      detail: 'Participants with neither a date of birth nor a stated age.',
    },
    {
      label: 'Missing telephone number',
      count: missingPhone,
      detail: 'Follow-up by telephone will not be possible for these participants.',
    },
    {
      label: 'Duplicate warnings overridden',
      count: duplicateWarnings,
      detail: 'Registrations created despite a possible-duplicate warning. Review before reporting.',
    },
    {
      label: 'Referrals without a recorded outcome',
      count: referralsWithoutOutcome,
      detail: 'Referrals still at recommended, issued, informed or unknown status.',
    },
    {
      label: 'Open follow-ups',
      count: openFollowups,
      detail: 'Follow-up entries that are neither completed nor declined.',
    },
  ].filter((i) => i.count > 0)

  return {
    totalParticipants: total,
    completeRecords: complete,
    incompleteRecords: total - complete,
    missingBp,
    missingGlucose,
    missingClinicalReview: missingClinical,
    missingConsent,
    missingAge,
    missingPhone,
    duplicateWarnings,
    referralsWithoutOutcome,
    openFollowups,
    issues,
  }
}

/** Throughput by hour - useful for planning the next outreach. */
export function hourlyThroughput(projectId: number, date = today()): { hour: string; count: number }[] {
  return query<{ hour: string; count: number }>(
    `SELECT substr(registered_at, 12, 2) AS hour, COUNT(*) AS count
       FROM participants
      WHERE project_id = ? AND deleted_at IS NULL AND substr(registered_at, 1, 10) = ?
      GROUP BY hour ORDER BY hour`,
    [projectId, date],
  )
}

export function topReferralReasons(projectId: number, limit = 10): { reason: string; count: number }[] {
  return query<{ reason: string; count: number }>(
    `SELECT reason, COUNT(*) AS count FROM referrals
      WHERE project_id = ? AND deleted_at IS NULL
      GROUP BY reason ORDER BY count DESC LIMIT ?`,
    [projectId, limit],
  )
}

export function facilityBreakdown(projectId: number): { facility: string; count: number }[] {
  return query<{ facility: string; count: number }>(
    `SELECT COALESCE(facility_name, 'Not specified') AS facility, COUNT(*) AS count
       FROM referrals WHERE project_id = ? AND deleted_at IS NULL
      GROUP BY COALESCE(facility_name, 'Not specified') ORDER BY count DESC`,
    [projectId],
  )
}
