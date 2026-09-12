/** Authentication, permissions, audit, backup/restore and crash safety. */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDatabase, teardown, type Fixture } from './helpers'
import {
  createUser,
  login,
  listUsers,
  verifyUserPin,
  resetPin,
  changePin,
  deactivateUser,
  hasAdministrator,
} from '../src/db/repo/users'
import { ROLES, permissionsForRole, PERMISSIONS } from '../src/core/permissions'
import {
  hashPin,
  verifyPin,
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  looksLikeSqlite,
  BackupPassphraseError,
  BackupFormatError,
} from '../src/core/crypto'
import { listAudit, auditForEntity, setAuditActor } from '../src/core/audit'
import { registerParticipant } from '../src/db/repo/participants'
import { recordVitals } from '../src/db/repo/clinical'
import {
  exportBytes,
  replaceDatabase,
  integrityCheck,
  foreignKeyCheck,
  transaction,
  count,
  run,
} from '../src/db/sqlite'
import { validatePin } from '../src/core/validation'
import { toCsv } from '../src/services/exporter'

let fx: Fixture

beforeEach(async () => {
  fx = await freshDatabase()
})

afterAll(teardown)

describe('PIN handling', () => {
  it('never stores the PIN itself', async () => {
    const record = await hashPin('4821')
    expect(record.hash).not.toContain('4821')
    expect(record.salt).not.toContain('4821')
    expect(await verifyPin('4821', record)).toBe(true)
    expect(await verifyPin('4822', record)).toBe(false)
  })

  it('produces a different hash for the same PIN each time', async () => {
    const a = await hashPin('4821')
    const b = await hashPin('4821')
    expect(a.hash).not.toBe(b.hash)
  })

  it('rejects weak PINs', () => {
    expect(validatePin('123').ok).toBe(false)
    expect(validatePin('1111').ok).toBe(false)
    expect(validatePin('1234').ok).toBe(false)
    expect(validatePin('abcd').ok).toBe(false)
    expect(validatePin('4821').ok).toBe(true)
  })
})

describe('sign-in', () => {
  beforeEach(async () => {
    await createUser({
      username: 'nurse.ada',
      fullName: 'Ada the Nurse',
      role: ROLES.NURSE,
      pin: '4821',
    })
  })

  it('accepts the correct PIN', async () => {
    const result = await login('nurse.ada', '4821')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.user.role_code).toBe(ROLES.NURSE)
  })

  it('rejects the wrong PIN without revealing which field was wrong', async () => {
    const result = await login('nurse.ada', '9999')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/username or PIN is not correct/i)
      expect(result.attemptsRemaining).toBe(4)
    }
  })

  it('rejects an unknown account with the same message', async () => {
    const result = await login('nobody', '4821')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/username or PIN is not correct/i)
  })

  it('locks the account after five failed attempts', async () => {
    for (let i = 0; i < 5; i++) await login('nurse.ada', '0000')
    const result = await login('nurse.ada', '4821')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/locked/i)
      expect(result.lockedUntil).toBeTruthy()
    }
  })

  it('clears the failed counter after a successful sign-in', async () => {
    await login('nurse.ada', '0000')
    await login('nurse.ada', '0000')
    const ok = await login('nurse.ada', '4821')
    expect(ok.ok).toBe(true)
    const again = await login('nurse.ada', '0000')
    if (!again.ok) expect(again.attemptsRemaining).toBe(4)
  })

  it('forces a PIN change after an administrator reset', async () => {
    const user = listUsers().find((u) => u.username === 'nurse.ada')!
    await resetPin(user.id, '7731')
    const result = await login('nurse.ada', '7731')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.mustChangePin).toBe(true)

    await changePin(user.id, '5514')
    const after = await login('nurse.ada', '5514')
    if (after.ok) expect(after.mustChangePin).toBe(false)
  })

  it('re-verifies a PIN for the app lock without changing session state', async () => {
    const user = listUsers().find((u) => u.username === 'nurse.ada')!
    expect(await verifyUserPin(user.id, '4821')).toBe(true)
    expect(await verifyUserPin(user.id, '0000')).toBe(false)
  })

  it('refuses to deactivate the only administrator', async () => {
    const admin = await createUser({
      username: 'admin.one',
      fullName: 'Only Admin',
      role: ROLES.ADMINISTRATOR,
      pin: '8842',
    })
    expect(hasAdministrator()).toBe(true)
    await expect(deactivateUser(admin)).rejects.toThrow(/only active administrator/i)
  })
})

describe('role permissions', () => {
  it('gives an administrator every permission', () => {
    const perms = permissionsForRole(ROLES.ADMINISTRATOR)
    expect(perms.has(PERMISSIONS.BACKUP_RESTORE)).toBe(true)
    expect(perms.has(PERMISSIONS.CONFIG_CLINICAL)).toBe(true)
    expect(perms.has(PERMISSIONS.REPORTS_IDENTIFIABLE)).toBe(true)
  })

  it('restricts a volunteer to registration and queue movement', () => {
    const perms = permissionsForRole(ROLES.VOLUNTEER)
    expect(perms.has(PERMISSIONS.PARTICIPANT_CREATE)).toBe(true)
    expect(perms.has(PERMISSIONS.QUEUE_MANAGE)).toBe(true)
    expect(perms.has(PERMISSIONS.CLINICAL_RECORD)).toBe(false)
    expect(perms.has(PERMISSIONS.BACKUP_RESTORE)).toBe(false)
    expect(perms.has(PERMISSIONS.REPORTS_IDENTIFIABLE)).toBe(false)
    expect(perms.has(PERMISSIONS.AUDIT_VIEW)).toBe(false)
  })

  it('limits a laboratory user to glucose entry', () => {
    const perms = permissionsForRole(ROLES.LABORATORY)
    expect(perms.has(PERMISSIONS.GLUCOSE_RECORD)).toBe(true)
    expect(perms.has(PERMISSIONS.VITALS_RECORD)).toBe(false)
    expect(perms.has(PERMISSIONS.BREAST_RECORD)).toBe(false)
  })

  it('does not let a nurse override a duplicate warning', () => {
    expect(permissionsForRole(ROLES.NURSE).has(PERMISSIONS.PARTICIPANT_OVERRIDE_DUPLICATE)).toBe(false)
    expect(
      permissionsForRole(ROLES.MEDICAL_DIRECTOR).has(PERMISSIONS.PARTICIPANT_OVERRIDE_DUPLICATE),
    ).toBe(true)
  })
})

describe('audit trail', () => {
  it('records who did what to which record and when', async () => {
    setAuditActor({ id: 9, username: 'dr.eze', role: ROLES.DOCTOR })
    const p = await registerParticipant(
      fx.project,
      { firstName: 'Audit', lastName: 'Subject', sex: 'MALE', ageYears: 44, consentStatus: 'GIVEN' },
    )

    const entries = auditForEntity('participant', p.id)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0].username).toBe('dr.eze')
    expect(entries[0].user_role).toBe(ROLES.DOCTOR)
    expect(entries[0].occurred_at).toBeTruthy()
    expect(entries[0].summary).toMatch(/registered/i)
  })

  it('records a failed sign-in', async () => {
    await createUser({ username: 'x.user', fullName: 'X', role: ROLES.NURSE, pin: '4821' })
    await login('x.user', '0000')
    const failures = listAudit({ action: 'LOGIN_FAILED' })
    expect(failures.length).toBeGreaterThan(0)
  })

  it('records a clinical threshold change with the previous and new value', async () => {
    const { updateThreshold } = await import('../src/db/repo/settings')
    await transaction(() => updateThreshold('bpSystolicElevated', 135))
    const entries = listAudit({ action: 'CONFIG_CHANGE' })
    expect(entries[0].previous_value).toBe('140')
    expect(entries[0].new_value).toBe('135')
  })

  it('does not put patient names into the audit trail', async () => {
    const p = await registerParticipant(
      fx.project,
      { firstName: 'Verysecret', lastName: 'Namehere', sex: 'FEMALE', ageYears: 30, consentStatus: 'GIVEN' },
      { overrideDuplicate: true },
    )
    await recordVitals(p.id, fx.project.id, { systolic: 170, diastolic: 100 }, fx.thresholds)

    const all = listAudit({ limit: 500 })
    const text = JSON.stringify(all).toLowerCase()
    expect(text).not.toContain('verysecret')
    expect(text).not.toContain('namehere')
  })

  it('soft deletes clinical records rather than erasing them', async () => {
    const p = await registerParticipant(
      fx.project,
      { firstName: 'Soft', lastName: 'Delete', sex: 'MALE', ageYears: 50, consentStatus: 'GIVEN' },
      { overrideDuplicate: true },
    )
    const { softDeleteClinicalRecord, vitalsFor } = await import('../src/db/repo/clinical')
    const { id } = await recordVitals(p.id, fx.project.id, { systolic: 120, diastolic: 80 }, fx.thresholds)

    await softDeleteClinicalRecord('vitals', id, 'Entered against the wrong participant')

    expect(vitalsFor(p.id)).toHaveLength(0)
    // The row is still physically present with a deletion timestamp.
    expect(count('SELECT COUNT(*) AS c FROM vitals WHERE id = ?', [id])).toBe(1)
    expect(count('SELECT COUNT(*) AS c FROM vitals WHERE id = ? AND deleted_at IS NOT NULL', [id])).toBe(1)
  })
})

describe('backup and restore', () => {
  it('encrypts a backup so the plain database is not readable in the file', async () => {
    const plain = exportBytes()
    const sealed = await encryptBackup(plain, 'a-strong-passphrase')

    expect(isEncryptedBackup(sealed)).toBe(true)
    expect(looksLikeSqlite(sealed)).toBe(false)
    expect(sealed.byteLength).toBeGreaterThan(plain.byteLength)

    const opened = await decryptBackup(sealed, 'a-strong-passphrase')
    expect(looksLikeSqlite(opened)).toBe(true)
    expect(Buffer.from(opened).equals(Buffer.from(plain))).toBe(true)
  })

  it('refuses the wrong password', async () => {
    const sealed = await encryptBackup(exportBytes(), 'correct-password')
    await expect(decryptBackup(sealed, 'wrong-password')).rejects.toBeInstanceOf(
      BackupPassphraseError,
    )
  })

  it('rejects a file that is not a backup', async () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    await expect(decryptBackup(junk, 'anything')).rejects.toBeInstanceOf(BackupFormatError)
    expect(isEncryptedBackup(junk)).toBe(false)
  })

  it('round-trips the database through backup and restore with data intact', async () => {
    for (let i = 0; i < 5; i++) {
      await registerParticipant(
        fx.project,
        { firstName: `Backup${i}`, lastName: `Test${i}`, sex: 'FEMALE', ageYears: 40, consentStatus: 'GIVEN' },
        { overrideDuplicate: true },
      )
    }
    const before = count('SELECT COUNT(*) AS c FROM participants')
    const sealed = await encryptBackup(exportBytes(), 'restore-me-please')

    // Destroy the live data, then restore.
    await transaction(() => {
      run('DELETE FROM vitals')
      run('DELETE FROM consents')
      run('DELETE FROM queue_events')
      run('DELETE FROM participants')
    })
    expect(count('SELECT COUNT(*) AS c FROM participants')).toBe(0)

    const plain = await decryptBackup(sealed, 'restore-me-please')
    await replaceDatabase(plain)

    expect(count('SELECT COUNT(*) AS c FROM participants')).toBe(before)
    expect(integrityCheck().ok).toBe(true)
  })

  it('refuses to restore a corrupt database image', async () => {
    const plain = exportBytes()
    const corrupt = plain.slice()
    // Wreck the middle of the file, leaving the SQLite header intact.
    for (let i = Math.floor(corrupt.length / 2); i < corrupt.length; i++) corrupt[i] = 0xff
    await expect(replaceDatabase(corrupt)).rejects.toThrow()
    // The live database is untouched.
    expect(integrityCheck().ok).toBe(true)
  })
})

describe('data integrity', () => {
  it('passes the integrity and foreign key checks', () => {
    expect(integrityCheck().ok).toBe(true)
    expect(foreignKeyCheck()).toEqual([])
  })

  it('rolls a failed transaction back completely', async () => {
    const before = count('SELECT COUNT(*) AS c FROM participants')
    await expect(
      transaction(async () => {
        await registerParticipant(
          fx.project,
          { firstName: 'Will', lastName: 'Rollback', sex: 'MALE', ageYears: 33, consentStatus: 'GIVEN' },
          { overrideDuplicate: true },
        )
        throw new Error('Simulated crash midway through the save')
      }),
    ).rejects.toThrow(/Simulated crash/)

    expect(count('SELECT COUNT(*) AS c FROM participants')).toBe(before)
    expect(count('SELECT COUNT(*) AS c FROM consents')).toBe(0)
  })
})

describe('CSV export', () => {
  it('quotes fields containing commas, quotes and newlines', () => {
    const csv = toCsv([
      { name: 'Okeke, Ngozi', note: 'She said "fine"', detail: 'line one\nline two' },
    ])
    expect(csv).toContain('"Okeke, Ngozi"')
    expect(csv).toContain('"She said ""fine"""')
    expect(csv).toContain('"line one\nline two"')
  })

  it('produces an empty document for no rows', () => {
    expect(toCsv([]).trim().length).toBeLessThanOrEqual(1)
  })
})
