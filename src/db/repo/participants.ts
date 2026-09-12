/**
 * Participant registration, duplicate detection, profile and queue movement
 * (spec S15-S19, S29, S53, S54).
 */
import { query, queryOne, count, transaction } from '../sqlite'
import {
  boolInt,
  findAll,
  insertEnvelope,
  insertRow,
  intOrNull,
  nullIfBlank,
  softDelete,
  updateEnvelope,
  updateRow,
  type Value,
} from './base'
import { audit, AUDIT_ACTIONS, auditActor, diffFields } from '../../core/audit'
import { nowIso } from '../../core/datetime'
import { buildSearchKey, normalisePhone, participantCode } from '../../core/ids'
import { ageFromDob } from '../../core/datetime'
import { SETTING_KEYS, serialRange, type WorkflowStatus } from '../../core/constants'
import { getSetting } from './settings'
import { getStationByStage, type Project } from './projects'

export interface Participant {
  id: number
  uuid: string
  project_id: number
  participant_code: string
  serial_no: number
  first_name: string
  middle_name: string | null
  last_name: string
  preferred_name: string | null
  sex: string
  date_of_birth: string | null
  age_years: number | null
  age_is_estimated: number
  community: string | null
  phone: string | null
  occupation: string | null
  contact_person: string | null
  contact_phone: string | null
  known_hypertension: string
  known_diabetes: string
  previous_breast_problem: string
  current_medications: string | null
  medical_history: string | null
  workflow_status: WorkflowStatus
  current_station_id: number | null
  registered_at: string
  completed_at: string | null
  duplicate_override_by: string | null
  duplicate_override_reason: string | null
  search_key: string | null
  is_demo: number
  created_at: string
  updated_at: string
  version: number
}

export interface ParticipantInput {
  firstName: string
  middleName?: string
  lastName: string
  preferredName?: string
  sex: string
  dateOfBirth?: string | null
  ageYears?: number | null
  ageIsEstimated?: boolean
  community?: string
  phone?: string
  occupation?: string
  contactPerson?: string
  contactPhone?: string
  knownHypertension?: string
  knownDiabetes?: string
  previousBreastProblem?: string
  currentMedications?: string
  medicalHistory?: string
  consentStatus?: string
  consentObtainedBy?: string
  consentNotes?: string
}

/** The block of participant numbers this device issues from. */
export function deviceSerialBlock(): number {
  return Number(getSetting(SETTING_KEYS.SYNC_SERIAL_BLOCK) ?? 0)
}

/**
 * The next participant number for this device, taken from its own block so
 * that devices which cannot see each other never collide.
 */
export function nextSerialForDevice(projectId: number): number {
  const { min, max } = serialRange(deviceSerialBlock())
  const highest = count(
    `SELECT COALESCE(MAX(serial_no), 0) AS c FROM participants
      WHERE project_id = ? AND serial_no BETWEEN ? AND ?`,
    [projectId, min, max],
  )
  return highest === 0 ? min : highest + 1
}

export function fullName(p: Pick<Participant, 'first_name' | 'middle_name' | 'last_name'>): string {
  return [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ')
}

/** Resolves the age to store: explicit DOB wins, otherwise the stated age. */
export function resolveAge(input: ParticipantInput): {
  age: number | null
  estimated: boolean
} {
  if (input.dateOfBirth) {
    const age = ageFromDob(input.dateOfBirth)
    if (age !== null) return { age, estimated: false }
  }
  if (input.ageYears !== null && input.ageYears !== undefined) {
    return { age: Math.round(input.ageYears), estimated: true }
  }
  return { age: null, estimated: Boolean(input.ageIsEstimated) }
}

// ------------------------------------------------------ duplicate check

export interface DuplicateMatch {
  participant: Participant
  score: number
  reasons: string[]
}

/**
 * Offline duplicate detection (spec S17). Compares normalised name, phone
 * digits and age. Returns candidates ordered by confidence; the caller
 * decides whether to warn.
 */
export function findPossibleDuplicates(
  projectId: number,
  input: ParticipantInput,
): DuplicateMatch[] {
  const nameKey = buildSearchKey([input.firstName, input.lastName])
  const phoneKey = normalisePhone(input.phone)
  const { age } = resolveAge(input)

  const candidates = query<Participant>(
    `SELECT * FROM participants
      WHERE project_id = ? AND deleted_at IS NULL
        AND (search_key LIKE ? OR (? <> '' AND phone IS NOT NULL))
      LIMIT 500`,
    [projectId, `%${buildSearchKey([input.lastName])}%`, phoneKey],
  )

  const matches: DuplicateMatch[] = []
  for (const c of candidates) {
    const reasons: string[] = []
    let score = 0

    const cName = buildSearchKey([c.first_name, c.last_name])
    if (cName === nameKey && nameKey !== '') {
      score += 60
      reasons.push('the same first and last name')
    } else if (
      buildSearchKey([c.last_name]) === buildSearchKey([input.lastName]) &&
      buildSearchKey([c.first_name]).slice(0, 3) === buildSearchKey([input.firstName]).slice(0, 3) &&
      nameKey !== ''
    ) {
      score += 35
      reasons.push('a very similar name')
    }

    if (phoneKey && normalisePhone(c.phone) === phoneKey) {
      score += 40
      reasons.push('the same telephone number')
    }

    if (age !== null && c.age_years !== null && Math.abs(Number(c.age_years) - age) <= 2) {
      if (score > 0) {
        score += 15
        reasons.push('a similar age')
      }
    }

    if (score >= 50) matches.push({ participant: c, score, reasons })
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 5)
}

// -------------------------------------------------------- registration

export interface RegisterOptions {
  overrideDuplicate?: boolean
  overrideReason?: string
  isDemo?: boolean
}

export class DuplicateParticipantError extends Error {
  matches: DuplicateMatch[]
  constructor(matches: DuplicateMatch[]) {
    super('A participant with similar information already exists.')
    this.name = 'DuplicateParticipantError'
    this.matches = matches
  }
}

/**
 * Registers a participant and their consent record in one transaction, so a
 * crash mid-save can never leave a participant without their consent row or
 * consume a participant number (spec S63).
 */
export async function registerParticipant(
  project: Project,
  input: ParticipantInput,
  options: RegisterOptions = {},
): Promise<Participant> {
  if (!input.firstName?.trim()) throw new Error('A first name is required.')
  if (!input.lastName?.trim()) throw new Error('A last name is required.')
  if (!input.sex) throw new Error('Sex is required.')

  if (!options.overrideDuplicate) {
    const dups = findPossibleDuplicates(project.id, input)
    if (dups.length > 0) throw new DuplicateParticipantError(dups)
  }

  const { age, estimated } = resolveAge(input)

  return transaction(() => {
    // Read inside the transaction, so two rapid registrations cannot be
    // issued the same number, and from this device's own block, so two
    // devices working offline cannot issue the same number either.
    const serial = nextSerialForDevice(project.id)
    const code = participantCode(project.participant_prefix, serial)
    const regStation = getStationByStage(project.id, 'REGISTERED')

    const id = insertRow('participants', {
      ...insertEnvelope(),
      project_id: project.id,
      participant_code: code,
      serial_no: serial,
      first_name: input.firstName.trim(),
      middle_name: nullIfBlank(input.middleName),
      last_name: input.lastName.trim(),
      preferred_name: nullIfBlank(input.preferredName),
      sex: input.sex,
      date_of_birth: nullIfBlank(input.dateOfBirth),
      age_years: age,
      age_is_estimated: boolInt(estimated),
      community: nullIfBlank(input.community),
      phone: nullIfBlank(input.phone),
      occupation: nullIfBlank(input.occupation),
      contact_person: nullIfBlank(input.contactPerson),
      contact_phone: nullIfBlank(input.contactPhone),
      known_hypertension: input.knownHypertension ?? 'UNKNOWN',
      known_diabetes: input.knownDiabetes ?? 'UNKNOWN',
      previous_breast_problem: input.previousBreastProblem ?? 'UNKNOWN',
      current_medications: nullIfBlank(input.currentMedications),
      medical_history: nullIfBlank(input.medicalHistory),
      workflow_status: 'REGISTERED',
      current_station_id: regStation?.id ?? null,
      registered_at: nowIso(),
      duplicate_override_by: options.overrideDuplicate ? auditActor().username : null,
      duplicate_override_reason: options.overrideDuplicate
        ? nullIfBlank(options.overrideReason) ?? 'Not stated'
        : null,
      search_key: buildSearchKey([
        input.firstName,
        input.middleName,
        input.lastName,
        input.preferredName,
        normalisePhone(input.phone),
      ]),
      is_demo: boolInt(options.isDemo),
    })

    if (input.consentStatus) {
      insertRow('consents', {
        ...insertEnvelope(),
        participant_id: id,
        consent_type: 'GENERAL_CARE',
        status: input.consentStatus,
        obtained_by: nullIfBlank(input.consentObtainedBy) ?? auditActor().username,
        obtained_at: nowIso(),
        notes: nullIfBlank(input.consentNotes),
        is_demo: boolInt(options.isDemo),
      })
    }

    insertRow('queue_events', {
      ...insertEnvelope(),
      participant_id: id,
      project_id: project.id,
      from_status: null,
      to_status: 'REGISTERED',
      station_id: regStation?.id ?? null,
      occurred_at: nowIso(),
      actor: auditActor().username,
      is_demo: boolInt(options.isDemo),
    })

    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'participant',
      entityId: id,
      summary: `Participant ${code} registered`,
    })
    if (options.overrideDuplicate) {
      audit({
        action: AUDIT_ACTIONS.DUPLICATE_OVERRIDE,
        entityType: 'participant',
        entityId: id,
        summary: `Duplicate warning overridden for ${code}`,
        newValue: options.overrideReason ?? 'Not stated',
      })
    }

    return getParticipant(id)!
  })
}

const PARTICIPANT_AUDIT_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'sex', 'date_of_birth', 'age_years',
  'community', 'phone', 'occupation', 'known_hypertension', 'known_diabetes',
  'previous_breast_problem', 'current_medications', 'medical_history',
]

export async function updateParticipant(id: number, input: ParticipantInput): Promise<void> {
  const before = getParticipant(id)
  if (!before) throw new Error('That participant record no longer exists.')
  const { age, estimated } = resolveAge(input)

  await transaction(() => {
    const data: Record<string, Value> = {
      ...updateEnvelope(before.version),
      first_name: input.firstName.trim(),
      middle_name: nullIfBlank(input.middleName),
      last_name: input.lastName.trim(),
      preferred_name: nullIfBlank(input.preferredName),
      sex: input.sex,
      date_of_birth: nullIfBlank(input.dateOfBirth),
      age_years: age,
      age_is_estimated: boolInt(estimated),
      community: nullIfBlank(input.community),
      phone: nullIfBlank(input.phone),
      occupation: nullIfBlank(input.occupation),
      contact_person: nullIfBlank(input.contactPerson),
      contact_phone: nullIfBlank(input.contactPhone),
      known_hypertension: input.knownHypertension ?? before.known_hypertension,
      known_diabetes: input.knownDiabetes ?? before.known_diabetes,
      previous_breast_problem: input.previousBreastProblem ?? before.previous_breast_problem,
      current_medications: nullIfBlank(input.currentMedications),
      medical_history: nullIfBlank(input.medicalHistory),
      search_key: buildSearchKey([
        input.firstName,
        input.middleName,
        input.lastName,
        input.preferredName,
        normalisePhone(input.phone),
      ]),
    }
    updateRow('participants', id, data)

    const after = getParticipant(id)!
    const d = diffFields(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      PARTICIPANT_AUDIT_FIELDS,
    )
    if (d.changed.length) {
      audit({
        action: AUDIT_ACTIONS.UPDATE,
        entityType: 'participant',
        entityId: id,
        summary: `Participant ${before.participant_code} updated: ${d.changed.join(', ')}`,
        previousValue: d.previous,
        newValue: d.next,
      })
    }
  })
}

export async function deleteParticipant(id: number, reason: string): Promise<void> {
  const p = getParticipant(id)
  if (!p) return
  await transaction(() => {
    softDelete('participants', id)
    audit({
      action: AUDIT_ACTIONS.DELETE,
      entityType: 'participant',
      entityId: id,
      summary: `Participant ${p.participant_code} marked deleted. Reason: ${reason}`,
    })
  })
}

// -------------------------------------------------------------- reading

export function getParticipant(id: number): Participant | null {
  return queryOne<Participant>(
    'SELECT * FROM participants WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
}

export function getParticipantByCode(projectId: number, code: string): Participant | null {
  return queryOne<Participant>(
    `SELECT * FROM participants
      WHERE project_id = ? AND participant_code = ? AND deleted_at IS NULL`,
    [projectId, code.trim().toUpperCase()],
  )
}

export interface ParticipantFilter {
  search?: string
  sex?: string
  status?: WorkflowStatus | ''
  minAge?: number | null
  maxAge?: number | null
  community?: string
  hasReferral?: boolean
  limit?: number
  offset?: number
}

function filterClause(projectId: number, f: ParticipantFilter): { sql: string; params: Value[] } {
  const where: string[] = ['p.project_id = ?', 'p.deleted_at IS NULL']
  const params: Value[] = [projectId]

  if (f.search?.trim()) {
    const term = f.search.trim()
    const key = buildSearchKey([term])
    where.push(
      `(p.search_key LIKE ? OR p.participant_code LIKE ? OR p.phone LIKE ?)`,
    )
    params.push(`%${key}%`, `%${term.toUpperCase()}%`, `%${normalisePhone(term)}%`)
  }
  if (f.sex) {
    where.push('p.sex = ?')
    params.push(f.sex)
  }
  if (f.status) {
    where.push('p.workflow_status = ?')
    params.push(f.status)
  }
  if (f.minAge !== null && f.minAge !== undefined) {
    where.push('p.age_years >= ?')
    params.push(f.minAge)
  }
  if (f.maxAge !== null && f.maxAge !== undefined) {
    where.push('p.age_years <= ?')
    params.push(f.maxAge)
  }
  if (f.community) {
    where.push('p.community = ?')
    params.push(f.community)
  }
  if (f.hasReferral) {
    where.push(
      'EXISTS (SELECT 1 FROM referrals r WHERE r.participant_id = p.id AND r.deleted_at IS NULL)',
    )
  }
  return { sql: where.join(' AND '), params }
}

export function searchParticipants(
  projectId: number,
  f: ParticipantFilter = {},
): Participant[] {
  const { sql, params } = filterClause(projectId, f)
  const limit = f.limit ?? 100
  const offset = f.offset ?? 0
  return query<Participant>(
    `SELECT p.* FROM participants p WHERE ${sql}
      ORDER BY p.serial_no DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
}

export function countParticipants(projectId: number, f: ParticipantFilter = {}): number {
  const { sql, params } = filterClause(projectId, f)
  return count(`SELECT COUNT(*) AS c FROM participants p WHERE ${sql}`, params)
}

export function listCommunities(projectId: number): string[] {
  return query<{ community: string }>(
    `SELECT DISTINCT community FROM participants
      WHERE project_id = ? AND deleted_at IS NULL AND community IS NOT NULL
      ORDER BY community`,
    [projectId],
  ).map((r) => r.community)
}

// ---------------------------------------------------------------- queue

export interface QueueEvent {
  id: number
  participant_id: number
  from_status: string | null
  to_status: string
  station_id: number | null
  occurred_at: string
  actor: string | null
  notes: string | null
}

/**
 * Moves a participant to another stage and records the movement. The
 * participant row and its queue event are written together.
 */
export async function moveParticipant(
  participantId: number,
  toStatus: WorkflowStatus,
  notes?: string,
): Promise<void> {
  const p = getParticipant(participantId)
  if (!p) throw new Error('That participant record no longer exists.')
  if (p.workflow_status === toStatus) return

  const station = getStationByStage(p.project_id, toStatus)

  await transaction(() => {
    updateRow('participants', participantId, {
      ...updateEnvelope(p.version),
      workflow_status: toStatus,
      current_station_id: station?.id ?? null,
      completed_at: toStatus === 'COMPLETED' ? nowIso() : p.completed_at,
    })
    insertRow('queue_events', {
      ...insertEnvelope(),
      participant_id: participantId,
      project_id: p.project_id,
      from_status: p.workflow_status,
      to_status: toStatus,
      station_id: station?.id ?? null,
      occurred_at: nowIso(),
      actor: auditActor().username,
      notes: nullIfBlank(notes),
      is_demo: p.is_demo,
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'participant',
      entityId: participantId,
      summary: `${p.participant_code} moved from ${p.workflow_status} to ${toStatus}`,
      previousValue: p.workflow_status,
      newValue: toStatus,
    })
  })
}

export function queueFor(projectId: number, status: WorkflowStatus): Participant[] {
  return query<Participant>(
    `SELECT * FROM participants
      WHERE project_id = ? AND workflow_status = ? AND deleted_at IS NULL
      ORDER BY registered_at`,
    [projectId, status],
  )
}

export function queueCounts(projectId: number): Record<string, number> {
  const rows = query<{ workflow_status: string; c: number }>(
    `SELECT workflow_status, COUNT(*) AS c FROM participants
      WHERE project_id = ? AND deleted_at IS NULL GROUP BY workflow_status`,
    [projectId],
  )
  const out: Record<string, number> = {}
  for (const r of rows) out[r.workflow_status] = Number(r.c)
  return out
}

export function participantHistory(participantId: number): QueueEvent[] {
  return findAll<QueueEvent>(
    'queue_events',
    'participant_id = ?',
    [participantId],
    'occurred_at DESC, id DESC',
  )
}

// -------------------------------------------------------------- consent

export interface Consent {
  id: number
  participant_id: number
  consent_type: string
  status: string
  obtained_by: string | null
  obtained_at: string
  notes: string | null
}

export function consentsFor(participantId: number): Consent[] {
  return findAll<Consent>('consents', 'participant_id = ?', [participantId], 'obtained_at DESC')
}

export async function recordConsent(
  participantId: number,
  status: string,
  obtainedBy: string,
  notes?: string,
  consentType = 'GENERAL_CARE',
): Promise<void> {
  await transaction(() => {
    const id = insertRow('consents', {
      ...insertEnvelope(),
      participant_id: participantId,
      consent_type: consentType,
      status,
      obtained_by: obtainedBy,
      obtained_at: nowIso(),
      notes: nullIfBlank(notes),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'consent',
      entityId: id,
      summary: `Consent recorded as ${status}`,
    })
  })
}

/** Compact per-participant progress used by the profile header. */
export interface ParticipantProgress {
  vitals: number
  glucose: number
  clinical: number
  wounds: number
  breast: number
  referrals: number
  followupsPending: number
  consentGiven: boolean
}

export function participantProgress(participantId: number): ParticipantProgress {
  const one = (sql: string) => count(sql, [participantId])
  return {
    vitals: one('SELECT COUNT(*) AS c FROM vitals WHERE participant_id = ? AND deleted_at IS NULL'),
    glucose: one(
      'SELECT COUNT(*) AS c FROM glucose_results WHERE participant_id = ? AND deleted_at IS NULL',
    ),
    clinical: one(
      'SELECT COUNT(*) AS c FROM clinical_encounters WHERE participant_id = ? AND deleted_at IS NULL',
    ),
    wounds: one(
      'SELECT COUNT(*) AS c FROM wound_assessments WHERE participant_id = ? AND deleted_at IS NULL',
    ),
    breast: one(
      'SELECT COUNT(*) AS c FROM breast_examinations WHERE participant_id = ? AND deleted_at IS NULL',
    ),
    referrals: one(
      'SELECT COUNT(*) AS c FROM referrals WHERE participant_id = ? AND deleted_at IS NULL',
    ),
    followupsPending: count(
      `SELECT COUNT(*) AS c FROM followups
        WHERE participant_id = ? AND deleted_at IS NULL
          AND outcome NOT IN ('COMPLETED', 'DECLINED')`,
      [participantId],
    ),
    consentGiven:
      count(
        `SELECT COUNT(*) AS c FROM consents
          WHERE participant_id = ? AND status = 'GIVEN' AND deleted_at IS NULL`,
        [participantId],
      ) > 0,
  }
}

export function ageBandOf(age: number | null): string {
  if (age === null) return 'Not recorded'
  if (age < 18) return 'Under 18'
  if (age < 30) return '18-29'
  if (age < 40) return '30-39'
  if (age < 50) return '40-49'
  if (age < 60) return '50-59'
  if (age < 70) return '60-69'
  return '70 and over'
}

export function parseAgeInput(v: string): number | null {
  return intOrNull(v)
}
