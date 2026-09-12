/**
 * Synchronisation between devices.
 *
 * Two real SQLite databases stand in for two phones. Records are serialised
 * to JSON and back between them, exactly as they would travel over the wire,
 * so foreign-key translation and conflict resolution are exercised for real
 * rather than mocked.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDatabase, teardown, type Fixture } from './helpers'
import {
  closeDatabase,
  openDatabase,
  query,
  queryOne,
  count,
  run,
  transaction,
} from '../src/db/sqlite'
import { migrate } from '../src/db/migrations'
import { setAuditActor } from '../src/core/audit'
import { ROLES } from '../src/core/permissions'
import { registerParticipant, nextSerialForDevice } from '../src/db/repo/participants'
import { recordVitals } from '../src/db/repo/clinical'
import { createProject, setActiveProject, getProject } from '../src/db/repo/projects'
import { setSetting } from '../src/db/repo/settings'
import { SETTING_KEYS, serialRange } from '../src/core/constants'
import { applyRecords, collectOutbox, pendingCount } from '../src/services/sync'
import { incomingWins, APPLY_ORDER, FOREIGN_KEYS } from '../src/services/syncModel'
import type { SyncRecord } from '../src/services/syncModel'

/** Simulates the wire: nothing but JSON crosses between devices. */
function overTheWire(records: SyncRecord[]): SyncRecord[] {
  return JSON.parse(JSON.stringify(records))
}

/** A second, empty device with the schema applied but no data. */
async function blankDevice(): Promise<void> {
  await closeDatabase()
  await openDatabase()
  migrate()
  setAuditActor({ id: 1, username: 'device.b', role: ROLES.ADMINISTRATOR })
}

let fx: Fixture

beforeEach(async () => {
  fx = await freshDatabase()
})

afterAll(teardown)

describe('the outbox', () => {
  it('records every clinical write without the repositories knowing', async () => {
    const before = pendingCount()
    const p = await registerParticipant(fx.project, {
      firstName: 'Ngozi',
      lastName: 'Okeke',
      sex: 'FEMALE',
      ageYears: 54,
      consentStatus: 'GIVEN',
    })
    await recordVitals(p.id, fx.project.id, { systolic: 168, diastolic: 96 }, fx.thresholds)

    const pending = query<{ table_name: string }>('SELECT table_name FROM sync_outbox')
    const tables = new Set(pending.map((r) => r.table_name))
    expect(pendingCount()).toBeGreaterThan(before)
    expect(tables.has('participants')).toBe(true)
    expect(tables.has('consents')).toBe(true)
    expect(tables.has('vitals')).toBe(true)
    expect(tables.has('queue_events')).toBe(true)
    // The project itself was created before any of this and is also queued.
    expect(tables.has('projects')).toBe(true)
  })

  it('does not queue rows from tables that stay on the device', async () => {
    await registerParticipant(fx.project, {
      firstName: 'Audit', lastName: 'Only', sex: 'MALE', ageYears: 40, consentStatus: 'GIVEN',
    })
    const tables = query<{ table_name: string }>(
      'SELECT DISTINCT table_name FROM sync_outbox',
    ).map((r) => r.table_name)
    expect(tables).not.toContain('audit_logs')
    expect(tables).not.toContain('app_settings')
    expect(tables).not.toContain('backups')
    expect(tables).not.toContain('sync_outbox')
  })

  it('carries foreign keys as uuids, never as local ids', async () => {
    const p = await registerParticipant(fx.project, {
      firstName: 'Ada', lastName: 'Obi', sex: 'FEMALE', ageYears: 50, consentStatus: 'GIVEN',
    })
    await recordVitals(p.id, fx.project.id, { systolic: 120, diastolic: 80 }, fx.thresholds)

    const { records } = collectOutbox()
    const vitals = records.find((r) => r.table === 'vitals')!
    expect(vitals.row.participant_id).toBeUndefined()
    expect(vitals.row.participant_id__ref).toBe(p.uuid)
    expect(vitals.row.project_id__ref).toBe(fx.project.uuid)
    // The local primary key is never transmitted.
    expect(vitals.row.id).toBeUndefined()
  })
})

describe('applying changes from another device', () => {
  it('recreates a participant and its clinical records with working links', async () => {
    // --- device A -----------------------------------------------------
    const p = await registerParticipant(fx.project, {
      firstName: 'Ngozi', lastName: 'Okeke', sex: 'FEMALE', ageYears: 54,
      phone: '08031234567', consentStatus: 'GIVEN',
    })
    await recordVitals(p.id, fx.project.id, { systolic: 168, diastolic: 96 }, fx.thresholds)
    const { records } = collectOutbox()
    const onTheWire = overTheWire(records)
    const originalCode = p.participant_code
    const projectUuid = fx.project.uuid

    // --- device B -----------------------------------------------------
    await blankDevice()
    expect(count('SELECT COUNT(*) AS c FROM participants')).toBe(0)

    const outcome = await transaction(() => applyRecords(onTheWire))
    expect(outcome.deferred).toBe(0)
    expect(outcome.applied).toBeGreaterThan(0)

    const arrived = queryOne<{ id: number; participant_code: string; project_id: number }>(
      'SELECT id, participant_code, project_id FROM participants WHERE uuid = ?',
      [p.uuid],
    )
    expect(arrived).not.toBeNull()
    expect(arrived!.participant_code).toBe(originalCode)

    // The project arrived too, and the participant points at device B's own
    // local id for it - not device A's.
    const project = queryOne<{ id: number }>('SELECT id FROM projects WHERE uuid = ?', [projectUuid])
    expect(project).not.toBeNull()
    expect(arrived!.project_id).toBe(project!.id)

    // The vitals row is linked to the right participant on this device.
    const vitals = queryOne<{ participant_id: number; bp_systolic: number }>(
      'SELECT participant_id, bp_systolic FROM vitals LIMIT 1',
    )
    expect(vitals!.bp_systolic).toBe(168)
    expect(vitals!.participant_id).toBe(arrived!.id)
  })

  it('never echoes received changes back to the server', async () => {
    const p = await registerParticipant(fx.project, {
      firstName: 'Echo', lastName: 'Test', sex: 'MALE', ageYears: 33, consentStatus: 'GIVEN',
    })
    const onTheWire = overTheWire(collectOutbox().records)
    void p

    await blankDevice()
    await transaction(() => applyRecords(onTheWire))

    // If applying wrote through the repository helpers, every received record
    // would be queued straight back and the two devices would loop forever.
    expect(pendingCount()).toBe(0)
  })

  it('defers a record whose parent has not arrived, then applies it', async () => {
    const p = await registerParticipant(fx.project, {
      firstName: 'Order', lastName: 'Matters', sex: 'FEMALE', ageYears: 45, consentStatus: 'GIVEN',
    })
    await recordVitals(p.id, fx.project.id, { systolic: 130, diastolic: 84 }, fx.thresholds)
    const all = overTheWire(collectOutbox().records)

    const vitalsOnly = all.filter((r) => r.table === 'vitals')
    const rest = all.filter((r) => r.table !== 'vitals')

    await blankDevice()

    // The vitals row alone cannot be placed: its participant is unknown.
    const first = await transaction(() => applyRecords(vitalsOnly))
    expect(first.applied).toBe(0)
    expect(first.deferred).toBe(1)
    expect(count('SELECT COUNT(*) AS c FROM vitals')).toBe(0)

    // Once the participant arrives, the same record applies cleanly.
    await transaction(() => applyRecords(rest))
    const second = await transaction(() => applyRecords(vitalsOnly))
    expect(second.applied).toBe(1)
    expect(count('SELECT COUNT(*) AS c FROM vitals')).toBe(1)
  })

  it('replicates a soft deletion rather than resurrecting the row', async () => {
    const p = await registerParticipant(fx.project, {
      firstName: 'Gone', lastName: 'Away', sex: 'MALE', ageYears: 60, consentStatus: 'GIVEN',
    })
    const initial = overTheWire(collectOutbox().records)

    const { deleteParticipant } = await import('../src/db/repo/participants')
    await deleteParticipant(p.id, 'Entered in error')
    const deletion = overTheWire(collectOutbox().records)

    await blankDevice()
    await transaction(() => applyRecords(initial))
    expect(count('SELECT COUNT(*) AS c FROM participants WHERE deleted_at IS NULL')).toBe(1)

    await transaction(() => applyRecords(deletion))
    expect(count('SELECT COUNT(*) AS c FROM participants WHERE deleted_at IS NULL')).toBe(0)
    // The row itself is still present, as a soft delete must be.
    expect(count('SELECT COUNT(*) AS c FROM participants')).toBe(1)
  })
})

describe('conflict resolution', () => {
  it('prefers the higher version', () => {
    const older = { version: 2, updated_at: '2026-12-29T10:00:00+01:00', uuid: 'a' }
    const newer = { version: 3, updated_at: '2026-12-29T09:00:00+01:00', uuid: 'a' }
    expect(incomingWins(newer, older)).toBe(true)
    expect(incomingWins(older, newer)).toBe(false)
  })

  it('falls back to the later timestamp at equal versions', () => {
    const a = { version: 2, updated_at: '2026-12-29T10:00:00+01:00', uuid: 'a' }
    const b = { version: 2, updated_at: '2026-12-29T11:00:00+01:00', uuid: 'b' }
    expect(incomingWins(b, a)).toBe(true)
    expect(incomingWins(a, b)).toBe(false)
  })

  it('compares timestamps as instants, not as strings', () => {
    // Same moment, different offsets. A string comparison would get this wrong.
    const lagos = { version: 1, updated_at: '2026-12-29T13:00:00+01:00', uuid: 'a' }
    const utc = { version: 1, updated_at: '2026-12-29T12:00:00+00:00', uuid: 'b' }
    // Equal instants, so the tie breaks deterministically on uuid.
    expect(incomingWins(utc, lagos)).toBe(true)
    expect(incomingWins(lagos, utc)).toBe(false)
  })

  it('always accepts a record that does not exist locally', () => {
    expect(incomingWins({ version: 1, updated_at: '2026-01-01T00:00:00+01:00', uuid: 'a' }, null)).toBe(true)
  })

  it('keeps the winning edit when the same record is changed on two devices', async () => {
    const p = await registerParticipant(fx.project, {
      firstName: 'Both', lastName: 'Edited', sex: 'FEMALE', ageYears: 40, consentStatus: 'GIVEN',
    })
    const base = overTheWire(collectOutbox().records)

    // Device A edits the telephone number, producing version 2.
    const { updateParticipant } = await import('../src/db/repo/participants')
    await updateParticipant(p.id, {
      firstName: 'Both', lastName: 'Edited', sex: 'FEMALE', ageYears: 40, phone: '08030000001',
    })
    const editA = overTheWire(collectOutbox().records).filter((r) => r.table === 'participants')

    await blankDevice()
    await transaction(() => applyRecords(base))

    // Device B makes its own edit of the same record, also version 2 but later.
    const localId = queryOne<{ id: number }>('SELECT id FROM participants WHERE uuid = ?', [p.uuid])!.id
    run(
      "UPDATE participants SET phone = '08099999999', version = 2, updated_at = ? WHERE id = ?",
      ['2027-01-01T09:00:00+01:00', localId],
    )

    // A's edit is older at the same version, so B's stands.
    await transaction(() => applyRecords(editA))
    const after = queryOne<{ phone: string }>('SELECT phone FROM participants WHERE uuid = ?', [p.uuid])
    expect(after!.phone).toBe('08099999999')

    // The same record at a higher version does win.
    const higher = editA.map((r) => ({
      ...r,
      version: 9,
      updated_at: '2027-02-01T09:00:00+01:00',
      row: { ...r.row, version: 9, phone: '08055555555', updated_at: '2027-02-01T09:00:00+01:00' },
    }))
    await transaction(() => applyRecords(higher))
    const final = queryOne<{ phone: string }>('SELECT phone FROM participants WHERE uuid = ?', [p.uuid])
    expect(final!.phone).toBe('08055555555')
  })
})

describe('participant numbering across devices', () => {
  it('gives each device its own block of numbers', () => {
    expect(serialRange(0)).toEqual({ min: 1, max: 10000 })
    expect(serialRange(1)).toEqual({ min: 10001, max: 20000 })
    expect(serialRange(2)).toEqual({ min: 20001, max: 30000 })
  })

  it('issues numbers from the configured block', async () => {
    expect(nextSerialForDevice(fx.project.id)).toBe(1)

    await transaction(() => setSetting(SETTING_KEYS.SYNC_SERIAL_BLOCK, 1))
    expect(nextSerialForDevice(fx.project.id)).toBe(10001)

    const p = await registerParticipant(fx.project, {
      firstName: 'Second', lastName: 'Device', sex: 'MALE', ageYears: 30, consentStatus: 'GIVEN',
    })
    expect(p.serial_no).toBe(10001)
    expect(p.participant_code).toBe('NUG-10001')
    expect(nextSerialForDevice(fx.project.id)).toBe(10002)
  })

  it('lets two offline devices register without colliding', async () => {
    // Device A, block 0.
    const a = await registerParticipant(fx.project, {
      firstName: 'Device', lastName: 'AOne', sex: 'FEMALE', ageYears: 41, consentStatus: 'GIVEN',
    })
    expect(a.participant_code).toBe('NUG-0001')
    const fromA = overTheWire(collectOutbox().records)

    // Device B joins the same outreach: it receives the project by syncing,
    // exactly as a second phone would, and is given its own number block.
    await blankDevice()
    const received = await transaction(() => applyRecords(fromA))
    expect(received.applied).toBeGreaterThan(0)
    expect(received.rejected).toEqual([])

    const projectB = queryOne<{ id: number }>('SELECT id FROM projects LIMIT 1')!
    await transaction(() => {
      setActiveProject(projectB.id)
      setSetting(SETTING_KEYS.SYNC_SERIAL_BLOCK, 1)
    })
    const b = await registerParticipant(getProject(projectB.id)!, {
      firstName: 'Device', lastName: 'BOne', sex: 'MALE', ageYears: 29, consentStatus: 'GIVEN',
    })
    expect(b.participant_code).toBe('NUG-10001')

    const codes = query<{ participant_code: string }>(
      'SELECT participant_code FROM participants ORDER BY serial_no',
    ).map((r) => r.participant_code)
    expect(codes).toContain('NUG-0001')
    expect(codes).toContain('NUG-10001')
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('projects created independently on two devices', () => {
  it('do not collide on their project code', async () => {
    const codeA = fx.project.code
    const fromA = overTheWire(collectOutbox().records)

    await blankDevice()
    const idB = await transaction(() =>
      createProject({ name: 'Another Outreach', participantPrefix: 'NUG' }),
    )
    const codeB = getProject(idB)!.code
    expect(codeB).not.toBe(codeA)

    // A's project merges in alongside B's rather than failing the batch.
    const outcome = await transaction(() => applyRecords(fromA))
    expect(outcome.rejected).toEqual([])
    expect(count('SELECT COUNT(*) AS c FROM projects')).toBe(2)
  })
})

describe('the sync model', () => {
  it('lists every syncable table in the apply order', async () => {
    const { SYNCABLE_TABLES } = await import('../src/db/repo/base')
    for (const table of SYNCABLE_TABLES) {
      expect(APPLY_ORDER, `${table} missing from APPLY_ORDER`).toContain(table)
    }
    expect(APPLY_ORDER.length).toBe(SYNCABLE_TABLES.length)
  })

  it('declares a foreign key map for every syncable table', async () => {
    const { SYNCABLE_TABLES } = await import('../src/db/repo/base')
    for (const table of SYNCABLE_TABLES) {
      expect(FOREIGN_KEYS[table], `${table} missing from FOREIGN_KEYS`).toBeDefined()
    }
  })

  it('names foreign key columns that actually exist on each table', async () => {
    const { SYNCABLE_TABLES } = await import('../src/db/repo/base')
    for (const table of SYNCABLE_TABLES) {
      const columns = new Set(
        query<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name),
      )
      for (const [column, refTable] of Object.entries(FOREIGN_KEYS[table] ?? {})) {
        expect(columns.has(column), `${table}.${column} does not exist`).toBe(true)
        expect(APPLY_ORDER, `${table}.${column} points at unsynced ${refTable}`).toContain(refTable)
      }
    }
  })

  it('orders parents before the rows that reference them', () => {
    for (const [table, fks] of Object.entries(FOREIGN_KEYS)) {
      const position = APPLY_ORDER.indexOf(table)
      for (const refTable of Object.values(fks)) {
        if (refTable === table) continue
        const refPosition = APPLY_ORDER.indexOf(refTable)
        // Self-references and genuine cycles are handled by the retry passes;
        // everything else should already be in dependency order.
        if (refPosition > position) {
          expect(
            ['expenses', 'procurement', 'budget_items'],
            `${table} is applied before ${refTable}`,
          ).toContain(table)
        }
      }
    }
  })
})
