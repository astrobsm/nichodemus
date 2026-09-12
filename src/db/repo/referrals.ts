/** Referrals, referral facility directory and follow-up (spec S26-S28, S78). */
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
} from './base'
import { audit, AUDIT_ACTIONS, auditActor } from '../../core/audit'
import { addDays, nowIso, today } from '../../core/datetime'
import { referralCode } from '../../core/ids'
import { followupIntervalFor, type ClinicalThresholds } from '../../core/clinicalRules'
import type { ReferralStatus, ReferralUrgency } from '../../core/constants'

// ----------------------------------------------------------- facilities

export interface Facility {
  id: number
  project_id: number | null
  name: string
  facility_type: string | null
  location: string | null
  phone: string | null
  contact_person: string | null
  services: string | null
  notes: string | null
  is_active: number
  version: number
}

export function listFacilities(activeOnly = false): Facility[] {
  const clause = activeOnly ? 'is_active = 1' : ''
  return findAll<Facility>('facilities', clause, [], 'name')
}

export function saveFacility(
  data: Partial<Facility> & { name: string },
  id?: number,
  isDemo = false,
): number {
  if (id) {
    const before = queryOne<Facility>('SELECT * FROM facilities WHERE id = ?', [id])
    updateRow('facilities', id, {
      ...updateEnvelope(before?.version),
      name: data.name,
      facility_type: nullIfBlank(data.facility_type),
      location: nullIfBlank(data.location),
      phone: nullIfBlank(data.phone),
      contact_person: nullIfBlank(data.contact_person),
      services: nullIfBlank(data.services),
      notes: nullIfBlank(data.notes),
      is_active: data.is_active ?? 1,
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'facility',
      entityId: id,
      summary: `Referral facility updated: ${data.name}`,
    })
    return id
  }
  const newId = insertRow('facilities', {
    ...insertEnvelope(),
    project_id: data.project_id ?? null,
    name: data.name,
    facility_type: nullIfBlank(data.facility_type),
    location: nullIfBlank(data.location),
    phone: nullIfBlank(data.phone),
    contact_person: nullIfBlank(data.contact_person),
    services: nullIfBlank(data.services),
    notes: nullIfBlank(data.notes),
    is_active: 1,
    is_demo: boolInt(isDemo),
  })
  audit({
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'facility',
    entityId: newId,
    summary: `Referral facility added: ${data.name}`,
  })
  return newId
}

export function deleteFacility(id: number): void {
  softDelete('facilities', id)
  audit({
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'facility',
    entityId: id,
    summary: 'Referral facility removed',
  })
}

// ------------------------------------------------------------ referrals

export interface Referral {
  id: number
  referral_code: string
  participant_id: number
  project_id: number
  referral_date: string
  source_module: string | null
  reason: string
  clinical_summary: string | null
  urgency: ReferralUrgency
  facility_id: number | null
  facility_name: string | null
  referring_clinician: string | null
  instructions: string | null
  transport_required: number
  transport_notes: string | null
  status: ReferralStatus
  status_updated_at: string | null
  notes: string | null
  version: number
}

export interface ReferralWithParticipant extends Referral {
  participant_code: string
  first_name: string
  last_name: string
  phone: string | null
  age_years: number | null
  sex: string
}

export interface ReferralInput {
  reason: string
  urgency: ReferralUrgency
  sourceModule?: string
  clinicalSummary?: string
  facilityId?: number | null
  facilityName?: string
  instructions?: string
  transportRequired?: boolean
  transportNotes?: string
  notes?: string
  createFollowup?: boolean
}

/**
 * Creates a referral and, unless told otherwise, the matching follow-up
 * entry so nobody who needs further care can drop out of the queue.
 */
export async function createReferral(
  participantId: number,
  projectId: number,
  prefix: string,
  input: ReferralInput,
  thresholds: ClinicalThresholds,
  isDemo = false,
): Promise<Referral> {
  if (!input.reason?.trim()) throw new Error('A reason for the referral is required.')

  return transaction(() => {
    const serial =
      count('SELECT COUNT(*) AS c FROM referrals WHERE project_id = ?', [projectId]) + 1
    const code = referralCode(prefix, serial)
    const facility = input.facilityId
      ? queryOne<Facility>('SELECT * FROM facilities WHERE id = ?', [input.facilityId])
      : null

    const id = insertRow('referrals', {
      ...insertEnvelope(),
      referral_code: code,
      participant_id: participantId,
      project_id: projectId,
      referral_date: nowIso(),
      source_module: nullIfBlank(input.sourceModule),
      reason: input.reason.trim(),
      clinical_summary: nullIfBlank(input.clinicalSummary),
      urgency: input.urgency,
      facility_id: input.facilityId ?? null,
      facility_name: facility?.name ?? nullIfBlank(input.facilityName),
      referring_clinician: auditActor().username,
      instructions: nullIfBlank(input.instructions),
      transport_required: boolInt(input.transportRequired),
      transport_notes: nullIfBlank(input.transportNotes),
      status: 'RECOMMENDED',
      status_updated_at: nowIso(),
      notes: nullIfBlank(input.notes),
      is_demo: boolInt(isDemo),
    })

    if (input.createFollowup !== false) {
      const days = followupIntervalFor(input.urgency, thresholds)
      insertRow('followups', {
        ...insertEnvelope(),
        participant_id: participantId,
        project_id: projectId,
        referral_id: id,
        reason: input.reason.trim(),
        due_date: addDays(today(), days),
        contact_attempts: 0,
        outcome: 'PENDING',
        is_demo: boolInt(isDemo),
      })
    }

    audit({
      action: AUDIT_ACTIONS.REFERRAL_CREATE,
      entityType: 'referral',
      entityId: id,
      summary: `Referral ${code} created (${input.urgency})`,
      newValue: { urgency: input.urgency, facility: facility?.name ?? input.facilityName },
    })

    return queryOne<Referral>('SELECT * FROM referrals WHERE id = ?', [id])!
  })
}

export async function updateReferralStatus(
  referralId: number,
  status: ReferralStatus,
  note?: string,
): Promise<void> {
  const before = queryOne<Referral>('SELECT * FROM referrals WHERE id = ?', [referralId])
  if (!before) throw new Error('That referral no longer exists.')

  await transaction(() => {
    updateRow('referrals', referralId, {
      ...updateEnvelope(before.version),
      status,
      status_updated_at: nowIso(),
      notes: note ? `${before.notes ? `${before.notes}\n` : ''}${note}` : before.notes,
    })
    audit({
      action: AUDIT_ACTIONS.REFERRAL_STATUS,
      entityType: 'referral',
      entityId: referralId,
      summary: `Referral ${before.referral_code} status changed to ${status}`,
      previousValue: before.status,
      newValue: status,
    })
  })
}

export async function updateReferral(
  referralId: number,
  patch: Partial<ReferralInput>,
): Promise<void> {
  const before = queryOne<Referral>('SELECT * FROM referrals WHERE id = ?', [referralId])
  if (!before) throw new Error('That referral no longer exists.')
  const facility = patch.facilityId
    ? queryOne<Facility>('SELECT * FROM facilities WHERE id = ?', [patch.facilityId])
    : null

  await transaction(() => {
    updateRow('referrals', referralId, {
      ...updateEnvelope(before.version),
      reason: patch.reason ?? before.reason,
      urgency: patch.urgency ?? before.urgency,
      clinical_summary:
        patch.clinicalSummary !== undefined
          ? nullIfBlank(patch.clinicalSummary)
          : before.clinical_summary,
      facility_id: patch.facilityId ?? before.facility_id,
      facility_name: facility?.name ?? before.facility_name,
      instructions:
        patch.instructions !== undefined ? nullIfBlank(patch.instructions) : before.instructions,
      transport_required:
        patch.transportRequired !== undefined
          ? boolInt(patch.transportRequired)
          : before.transport_required,
      transport_notes:
        patch.transportNotes !== undefined
          ? nullIfBlank(patch.transportNotes)
          : before.transport_notes,
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'referral',
      entityId: referralId,
      summary: `Referral ${before.referral_code} amended`,
    })
  })
}

export function referralsFor(participantId: number): Referral[] {
  return findAll<Referral>(
    'referrals',
    'participant_id = ?',
    [participantId],
    'referral_date DESC, id DESC',
  )
}

export interface ReferralFilter {
  status?: string
  urgency?: string
  facilityId?: number | null
  search?: string
  limit?: number
}

export function listReferrals(
  projectId: number,
  f: ReferralFilter = {},
): ReferralWithParticipant[] {
  const where = ['r.project_id = ?', 'r.deleted_at IS NULL']
  const params: (string | number)[] = [projectId]
  if (f.status) {
    where.push('r.status = ?')
    params.push(f.status)
  }
  if (f.urgency) {
    where.push('r.urgency = ?')
    params.push(f.urgency)
  }
  if (f.facilityId) {
    where.push('r.facility_id = ?')
    params.push(f.facilityId)
  }
  if (f.search?.trim()) {
    where.push('(p.participant_code LIKE ? OR p.search_key LIKE ? OR r.referral_code LIKE ?)')
    const t = f.search.trim()
    params.push(`%${t.toUpperCase()}%`, `%${t.toLowerCase()}%`, `%${t.toUpperCase()}%`)
  }
  params.push(f.limit ?? 300)

  return query<ReferralWithParticipant>(
    `SELECT r.*, p.participant_code, p.first_name, p.last_name, p.phone, p.age_years, p.sex
       FROM referrals r JOIN participants p ON p.id = r.participant_id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE r.urgency
                 WHEN 'EMERGENCY' THEN 0 WHEN 'URGENT' THEN 1
                 WHEN 'PRIORITY' THEN 2 ELSE 3 END,
               r.referral_date DESC
      LIMIT ?`,
    params,
  )
}

export function referralStats(projectId: number): {
  total: number
  urgent: number
  byStatus: Record<string, number>
  byUrgency: Record<string, number>
} {
  const total = count(
    'SELECT COUNT(*) AS c FROM referrals WHERE project_id = ? AND deleted_at IS NULL',
    [projectId],
  )
  const byStatus: Record<string, number> = {}
  for (const r of query<{ status: string; c: number }>(
    `SELECT status, COUNT(*) AS c FROM referrals
      WHERE project_id = ? AND deleted_at IS NULL GROUP BY status`,
    [projectId],
  )) {
    byStatus[r.status] = Number(r.c)
  }
  const byUrgency: Record<string, number> = {}
  for (const r of query<{ urgency: string; c: number }>(
    `SELECT urgency, COUNT(*) AS c FROM referrals
      WHERE project_id = ? AND deleted_at IS NULL GROUP BY urgency`,
    [projectId],
  )) {
    byUrgency[r.urgency] = Number(r.c)
  }
  return {
    total,
    urgent: (byUrgency.URGENT ?? 0) + (byUrgency.EMERGENCY ?? 0),
    byStatus,
    byUrgency,
  }
}

// ------------------------------------------------------------ follow-up

export interface Followup {
  id: number
  participant_id: number
  project_id: number
  referral_id: number | null
  reason: string | null
  due_date: string | null
  contact_attempts: number
  last_contact_at: string | null
  contact_method: string | null
  outcome: string
  facility_attended: string | null
  further_treatment: string | null
  next_followup_date: string | null
  closed_at: string | null
  notes: string | null
  version: number
}

export interface FollowupWithParticipant extends Followup {
  participant_code: string
  first_name: string
  last_name: string
  phone: string | null
  referral_code: string | null
  urgency: string | null
}

export async function createFollowup(
  participantId: number,
  projectId: number,
  reason: string,
  dueDate: string,
  referralId: number | null = null,
  isDemo = false,
): Promise<number> {
  return transaction(() => {
    const id = insertRow('followups', {
      ...insertEnvelope(),
      participant_id: participantId,
      project_id: projectId,
      referral_id: referralId,
      reason,
      due_date: dueDate,
      contact_attempts: 0,
      outcome: 'PENDING',
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'followup',
      entityId: id,
      summary: `Follow-up created, due ${dueDate}`,
    })
    return id
  })
}

export interface FollowupUpdate {
  outcome?: string
  contactMethod?: string
  facilityAttended?: string
  furtherTreatment?: string
  nextFollowupDate?: string
  notes?: string
  recordContactAttempt?: boolean
}

export async function updateFollowup(id: number, patch: FollowupUpdate): Promise<void> {
  const before = queryOne<Followup>('SELECT * FROM followups WHERE id = ?', [id])
  if (!before) throw new Error('That follow-up record no longer exists.')

  const attempts = patch.recordContactAttempt
    ? Number(before.contact_attempts) + 1
    : Number(before.contact_attempts)
  const outcome = patch.outcome ?? before.outcome
  const closing = outcome === 'COMPLETED' || outcome === 'DECLINED'

  await transaction(() => {
    updateRow('followups', id, {
      ...updateEnvelope(before.version),
      outcome,
      contact_attempts: attempts,
      last_contact_at: patch.recordContactAttempt ? nowIso() : before.last_contact_at,
      contact_method: patch.contactMethod ?? before.contact_method,
      facility_attended:
        patch.facilityAttended !== undefined
          ? nullIfBlank(patch.facilityAttended)
          : before.facility_attended,
      further_treatment:
        patch.furtherTreatment !== undefined
          ? nullIfBlank(patch.furtherTreatment)
          : before.further_treatment,
      next_followup_date:
        patch.nextFollowupDate !== undefined
          ? nullIfBlank(patch.nextFollowupDate)
          : before.next_followup_date,
      closed_at: closing ? nowIso() : null,
      notes: patch.notes
        ? `${before.notes ? `${before.notes}\n` : ''}${patch.notes}`
        : before.notes,
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'followup',
      entityId: id,
      summary: `Follow-up outcome set to ${outcome}`,
      previousValue: before.outcome,
      newValue: outcome,
    })

    // Keep the referral status aligned with what the follow-up discovered.
    if (before.referral_id) {
      const map: Record<string, ReferralStatus> = {
        CONTACTED: 'PATIENT_INFORMED',
        ATTENDED_FACILITY: 'ATTENDED',
        NOT_ATTENDED: 'NOT_ATTENDED',
        UNREACHABLE: 'UNKNOWN',
        COMPLETED: 'COMPLETED',
      }
      const newStatus = map[outcome]
      if (newStatus) {
        const ref = queryOne<Referral>('SELECT * FROM referrals WHERE id = ?', [before.referral_id])
        if (ref && ref.status !== newStatus) {
          updateRow('referrals', before.referral_id, {
            ...updateEnvelope(ref.version),
            status: newStatus,
            status_updated_at: nowIso(),
          })
          audit({
            action: AUDIT_ACTIONS.REFERRAL_STATUS,
            entityType: 'referral',
            entityId: before.referral_id,
            summary: `Referral ${ref.referral_code} status updated from follow-up`,
            previousValue: ref.status,
            newValue: newStatus,
          })
        }
      }
    }
  })
}

export function followupsFor(participantId: number): Followup[] {
  return findAll<Followup>(
    'followups',
    'participant_id = ?',
    [participantId],
    'due_date, id DESC',
  )
}

export function listFollowups(
  projectId: number,
  filter: { outcome?: string; overdueOnly?: boolean; search?: string } = {},
): FollowupWithParticipant[] {
  const where = ['f.project_id = ?', 'f.deleted_at IS NULL']
  const params: (string | number)[] = [projectId]
  if (filter.outcome) {
    where.push('f.outcome = ?')
    params.push(filter.outcome)
  }
  if (filter.overdueOnly) {
    where.push("f.due_date < ? AND f.outcome NOT IN ('COMPLETED','DECLINED')")
    params.push(today())
  }
  if (filter.search?.trim()) {
    where.push('(p.participant_code LIKE ? OR p.search_key LIKE ?)')
    params.push(`%${filter.search.trim().toUpperCase()}%`, `%${filter.search.trim().toLowerCase()}%`)
  }
  return query<FollowupWithParticipant>(
    `SELECT f.*, p.participant_code, p.first_name, p.last_name, p.phone,
            r.referral_code, r.urgency
       FROM followups f
       JOIN participants p ON p.id = f.participant_id
       LEFT JOIN referrals r ON r.id = f.referral_id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE WHEN f.outcome IN ('COMPLETED','DECLINED') THEN 1 ELSE 0 END,
               f.due_date`,
    params,
  )
}

export function followupStats(projectId: number): {
  total: number
  pending: number
  contacted: number
  attended: number
  unreachable: number
  completed: number
  overdue: number
} {
  const byOutcome: Record<string, number> = {}
  for (const r of query<{ outcome: string; c: number }>(
    `SELECT outcome, COUNT(*) AS c FROM followups
      WHERE project_id = ? AND deleted_at IS NULL GROUP BY outcome`,
    [projectId],
  )) {
    byOutcome[r.outcome] = Number(r.c)
  }
  const total = Object.values(byOutcome).reduce((a, b) => a + b, 0)
  const overdue = count(
    `SELECT COUNT(*) AS c FROM followups
      WHERE project_id = ? AND deleted_at IS NULL AND due_date < ?
        AND outcome NOT IN ('COMPLETED','DECLINED')`,
    [projectId, today()],
  )
  return {
    total,
    pending: byOutcome.PENDING ?? 0,
    contacted: byOutcome.CONTACTED ?? 0,
    attended: byOutcome.ATTENDED_FACILITY ?? 0,
    unreachable: byOutcome.UNREACHABLE ?? 0,
    completed: byOutcome.COMPLETED ?? 0,
    overdue,
  }
}

export function pendingFollowupCount(projectId: number): number {
  return count(
    `SELECT COUNT(*) AS c FROM followups
      WHERE project_id = ? AND deleted_at IS NULL AND outcome NOT IN ('COMPLETED','DECLINED')`,
    [projectId],
  )
}
