/** Registration, duplicate detection and queue movement (spec S95). */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDatabase, teardown, type Fixture } from './helpers'
import {
  DuplicateParticipantError,
  countParticipants,
  findPossibleDuplicates,
  getParticipantByCode,
  moveParticipant,
  participantHistory,
  participantProgress,
  registerParticipant,
  searchParticipants,
  resolveAge,
} from '../src/db/repo/participants'
import { consentsFor } from '../src/db/repo/participants'
import { ageFromDob } from '../src/core/datetime'
import { count } from '../src/db/sqlite'

let fx: Fixture

beforeEach(async () => {
  fx = await freshDatabase()
})

afterAll(teardown)

function base(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Ngozi',
    lastName: 'Okeke',
    sex: 'FEMALE',
    ageYears: 54,
    community: 'Umunna',
    phone: '08031234567',
    consentStatus: 'GIVEN',
    consentObtainedBy: 'test.admin',
    ...overrides,
  } as never
}

describe('participant registration', () => {
  it('issues sequential participant numbers with the project prefix', async () => {
    const first = await registerParticipant(fx.project, base())
    const second = await registerParticipant(fx.project, base({ firstName: 'Emeka', lastName: 'Eze', sex: 'MALE', phone: '08039999999' }))

    expect(first.participant_code).toBe('NUG-0001')
    expect(second.participant_code).toBe('NUG-0002')
    expect(first.serial_no).toBe(1)
    expect(second.serial_no).toBe(2)
  })

  it('never issues a duplicate participant number', async () => {
    for (let i = 0; i < 12; i++) {
      await registerParticipant(
        fx.project,
        base({ firstName: `P${i}`, lastName: `Name${i}`, phone: `0803000${String(i).padStart(4, '0')}` }),
      )
    }
    const distinct = count(
      'SELECT COUNT(DISTINCT participant_code) AS c FROM participants WHERE project_id = ?',
      [fx.project.id],
    )
    expect(distinct).toBe(12)
  })

  it('records consent and a queue event in the same transaction', async () => {
    const p = await registerParticipant(fx.project, base())
    expect(consentsFor(p.id)).toHaveLength(1)
    expect(consentsFor(p.id)[0].status).toBe('GIVEN')
    expect(participantHistory(p.id)[0].to_status).toBe('REGISTERED')
    expect(participantProgress(p.id).consentGiven).toBe(true)
  })

  it('rejects a registration with a missing required field, consuming no number', async () => {
    await expect(registerParticipant(fx.project, base({ firstName: '' }))).rejects.toThrow(
      /first name is required/i,
    )
    await expect(registerParticipant(fx.project, base({ sex: '' }))).rejects.toThrow(/sex is required/i)

    const p = await registerParticipant(fx.project, base())
    expect(p.participant_code).toBe('NUG-0001')
  })

  it('calculates age from a date of birth and marks a stated age as estimated', () => {
    const exact = resolveAge({ firstName: 'A', lastName: 'B', sex: 'FEMALE', dateOfBirth: '1970-06-15' } as never)
    expect(exact.age).toBe(ageFromDob('1970-06-15'))
    expect(exact.estimated).toBe(false)

    const approx = resolveAge({ firstName: 'A', lastName: 'B', sex: 'FEMALE', ageYears: 40 } as never)
    expect(approx.age).toBe(40)
    expect(approx.estimated).toBe(true)
  })
})

describe('duplicate detection', () => {
  it('flags an identical name and telephone number', async () => {
    await registerParticipant(fx.project, base())
    const matches = findPossibleDuplicates(fx.project.id, base())
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].reasons.join(' ')).toMatch(/name/)
  })

  it('refuses a second registration unless the warning is overridden', async () => {
    await registerParticipant(fx.project, base())
    await expect(registerParticipant(fx.project, base())).rejects.toBeInstanceOf(
      DuplicateParticipantError,
    )

    const forced = await registerParticipant(fx.project, base(), {
      overrideDuplicate: true,
      overrideReason: 'Genuinely a different person',
    })
    expect(forced.participant_code).toBe('NUG-0002')
    expect(forced.duplicate_override_by).toBe('test.admin')
    expect(forced.duplicate_override_reason).toBe('Genuinely a different person')
  })

  it('does not flag a clearly different person', async () => {
    await registerParticipant(fx.project, base())
    const matches = findPossibleDuplicates(
      fx.project.id,
      base({ firstName: 'Chidi', lastName: 'Nwosu', phone: '08145550000', ageYears: 22 }),
    )
    expect(matches).toHaveLength(0)
  })
})

describe('search and queue', () => {
  it('finds a participant by code, name and telephone number', async () => {
    const p = await registerParticipant(fx.project, base())
    expect(searchParticipants(fx.project.id, { search: 'NUG-0001' })[0]?.id).toBe(p.id)
    expect(searchParticipants(fx.project.id, { search: 'okeke' })[0]?.id).toBe(p.id)
    expect(searchParticipants(fx.project.id, { search: '08031234567' })[0]?.id).toBe(p.id)
  })

  it('filters by sex, stage and age band', async () => {
    await registerParticipant(fx.project, base())
    await registerParticipant(
      fx.project,
      base({ firstName: 'Emeka', lastName: 'Agu', sex: 'MALE', ageYears: 25, phone: '08070000001' }),
    )
    expect(countParticipants(fx.project.id, { sex: 'MALE' })).toBe(1)
    expect(countParticipants(fx.project.id, { minAge: 50 })).toBe(1)
    expect(countParticipants(fx.project.id, { status: 'REGISTERED' })).toBe(2)
  })

  it('moves a participant through stations and records each movement', async () => {
    const p = await registerParticipant(fx.project, base())
    await moveParticipant(p.id, 'VITALS')
    await moveParticipant(p.id, 'GLUCOSE')
    await moveParticipant(p.id, 'COMPLETED')

    const history = participantHistory(p.id)
    expect(history.map((h) => h.to_status)).toEqual([
      'COMPLETED',
      'GLUCOSE',
      'VITALS',
      'REGISTERED',
    ])
    expect(getParticipantByCode(fx.project.id, 'NUG-0001')?.workflow_status).toBe('COMPLETED')
    expect(getParticipantByCode(fx.project.id, 'NUG-0001')?.completed_at).toBeTruthy()
  })
})
