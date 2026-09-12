/**
 * Acceptance criterion S83/S96: the application must stay responsive with at
 * least 1,000 participants and several thousand clinical records.
 *
 * These tests seed a realistic dataset directly through SQL (bypassing the
 * per-record transaction flush, which is a UI-speed concern, not a query-speed
 * one) and then time the reads the interface actually performs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { freshDatabase, teardown, type Fixture } from './helpers'
import { transaction, run, count, integrityCheck } from '../src/db/sqlite'
import { insertEnvelope } from '../src/db/repo/base'
import { participantCode, buildSearchKey } from '../src/core/ids'
import { nowIso } from '../src/core/datetime'
import {
  countParticipants,
  queueCounts,
  searchParticipants,
} from '../src/db/repo/participants'
import { dataQuality, demographics, reachStats, screeningStats, dailyStats } from '../src/db/repo/analytics'
import { listReferrals, referralStats, followupStats } from '../src/db/repo/referrals'

const PARTICIPANTS = 1000

let fx: Fixture

function elapsed(fn: () => unknown): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

beforeAll(async () => {
  fx = await freshDatabase()

  const surnames = ['Okeke', 'Eze', 'Nwosu', 'Ugwu', 'Obi', 'Agu', 'Mbah']
  const firstNames = ['Ngozi', 'Emeka', 'Ada', 'Chidi', 'Ifeoma', 'Uche', 'Amaka']

  await transaction(() => {
    for (let i = 1; i <= PARTICIPANTS; i++) {
      const first = firstNames[i % firstNames.length]
      const last = surnames[i % surnames.length]
      const sex = i % 3 === 0 ? 'MALE' : 'FEMALE'
      const age = 18 + (i % 62)
      const env = insertEnvelope()

      run(
        `INSERT INTO participants
           (uuid, project_id, participant_code, serial_no, first_name, last_name, sex,
            age_years, age_is_estimated, community, phone, known_hypertension, known_diabetes,
            previous_breast_problem, workflow_status, registered_at, search_key, is_demo,
            created_at, updated_at, device_id, created_by, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN',
                 ?, ?, ?, 0, ?, ?, ?, ?, ?, 1)`,
        [
          env.uuid as string,
          fx.project.id,
          participantCode('NUG', i),
          i,
          `${first}${i}`,
          last,
          sex,
          age,
          i % 2 === 0 ? 'Umunna' : 'Umuhu',
          `080${String(30000000 + i).slice(0, 8)}`,
          i % 10 === 0 ? 'CLINICAL_REVIEW' : 'COMPLETED',
          nowIso(),
          buildSearchKey([`${first}${i}`, last]),
          env.created_at as string,
          env.updated_at as string,
          env.device_id as string,
          'seed',
          'seed',
        ],
      )

      // Two vitals readings for most participants, one glucose result.
      const systolic = 110 + (i % 70)
      const alert = systolic >= 140 ? 'ATTENTION' : 'NORMAL'
      for (let r = 1; r <= (i % 4 === 0 ? 2 : 1); r++) {
        const ve = insertEnvelope()
        run(
          `INSERT INTO vitals
             (uuid, participant_id, project_id, reading_index, bp_systolic, bp_diastolic,
              pulse, recorded_at, recorded_by, alert_level, is_demo,
              created_at, updated_at, device_id, created_by, updated_by, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed', ?, 0, ?, ?, ?, 'seed', 'seed', 1)`,
          [
            ve.uuid as string,
            i,
            fx.project.id,
            r,
            systolic - (r - 1) * 6,
            70 + (i % 30),
            72,
            nowIso(),
            alert,
            ve.created_at as string,
            ve.updated_at as string,
            ve.device_id as string,
          ],
        )
      }

      const ge = insertEnvelope()
      const glucose = 4 + (i % 90) / 10
      run(
        `INSERT INTO glucose_results
           (uuid, participant_id, project_id, test_type, fasting_status, value, unit,
            value_mmol, tested_at, operator, alert_level, is_demo,
            created_at, updated_at, device_id, created_by, updated_by, version)
         VALUES (?, ?, ?, 'CAPILLARY', 'NON_FASTING', ?, 'mmol/L', ?, ?, 'seed', ?, 0,
                 ?, ?, ?, 'seed', 'seed', 1)`,
        [
          ge.uuid as string,
          i,
          fx.project.id,
          glucose,
          glucose,
          nowIso(),
          glucose >= 7.8 ? 'ATTENTION' : 'NORMAL',
          ge.created_at as string,
          ge.updated_at as string,
          ge.device_id as string,
        ],
      )

      // A referral and follow-up for roughly one in eight participants.
      if (i % 8 === 0) {
        const re = insertEnvelope()
        run(
          `INSERT INTO referrals
             (uuid, referral_code, participant_id, project_id, referral_date, reason,
              urgency, status, is_demo, created_at, updated_at, device_id, created_by,
              updated_by, version)
           VALUES (?, ?, ?, ?, ?, 'Elevated blood pressure screening measurement',
                   ?, 'RECOMMENDED', 0, ?, ?, ?, 'seed', 'seed', 1)`,
          [
            re.uuid as string,
            `NUG-REF-${String(i).padStart(4, '0')}`,
            i,
            fx.project.id,
            nowIso(),
            i % 40 === 0 ? 'URGENT' : 'PRIORITY',
            re.created_at as string,
            re.updated_at as string,
            re.device_id as string,
          ],
        )
        const fe = insertEnvelope()
        run(
          `INSERT INTO followups
             (uuid, participant_id, project_id, reason, due_date, contact_attempts,
              outcome, is_demo, created_at, updated_at, device_id, created_by, updated_by, version)
           VALUES (?, ?, ?, 'Referral follow-up', ?, 0, 'PENDING', 0, ?, ?, ?, 'seed', 'seed', 1)`,
          [
            fe.uuid as string,
            i,
            fx.project.id,
            '2027-01-15',
            fe.created_at as string,
            fe.updated_at as string,
            fe.device_id as string,
          ],
        )
      }
    }
  })
}, 120_000)

afterAll(teardown)

describe('performance with a full outreach dataset', () => {
  it('holds the expected volume of records', () => {
    expect(count('SELECT COUNT(*) AS c FROM participants')).toBe(PARTICIPANTS)
    expect(count('SELECT COUNT(*) AS c FROM vitals')).toBeGreaterThan(1000)
    expect(count('SELECT COUNT(*) AS c FROM glucose_results')).toBe(PARTICIPANTS)
    expect(count('SELECT COUNT(*) AS c FROM referrals')).toBe(PARTICIPANTS / 8)
    expect(integrityCheck().ok).toBe(true)
  })

  it('searches by name in well under a second', () => {
    const ms = elapsed(() => {
      const rows = searchParticipants(fx.project.id, { search: 'okeke', limit: 100 })
      expect(rows.length).toBeGreaterThan(0)
    })
    expect(ms).toBeLessThan(400)
  })

  it('searches by participant code in well under a second', () => {
    const ms = elapsed(() => {
      const rows = searchParticipants(fx.project.id, { search: 'NUG-0500' })
      expect(rows[0]?.participant_code).toBe('NUG-0500')
    })
    expect(ms).toBeLessThan(400)
  })

  it('applies filters quickly', () => {
    const ms = elapsed(() => {
      countParticipants(fx.project.id, { sex: 'FEMALE', minAge: 40, maxAge: 60 })
      searchParticipants(fx.project.id, { status: 'CLINICAL_REVIEW', limit: 50 })
    })
    expect(ms).toBeLessThan(500)
  })

  it('builds the dashboard figures quickly', () => {
    const ms = elapsed(() => {
      reachStats(fx.project.id, fx.project.expected_participants)
      queueCounts(fx.project.id)
      referralStats(fx.project.id)
      followupStats(fx.project.id)
      dailyStats(fx.project.id)
    })
    expect(ms).toBeLessThan(800)
  })

  it('builds the full analytics set quickly', () => {
    const ms = elapsed(() => {
      screeningStats(fx.project.id)
      demographics(fx.project.id)
      dataQuality(fx.project.id)
    })
    expect(ms).toBeLessThan(1500)
  })

  it('lists referrals quickly', () => {
    const ms = elapsed(() => {
      const rows = listReferrals(fx.project.id, {})
      expect(rows.length).toBe(PARTICIPANTS / 8)
    })
    expect(ms).toBeLessThan(500)
  })

  it('counts elevated screening findings by person, not by reading', () => {
    const s = screeningStats(fx.project.id)
    expect(s.bpReadings).toBeGreaterThan(s.bpParticipants)
    expect(s.bpElevated).toBeLessThanOrEqual(s.bpParticipants)
    expect(s.bpRepeated).toBeGreaterThan(0)
  })
})
