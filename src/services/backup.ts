/** Encrypted local backup and restore (spec S47, S48). */
import { exportBytes, replaceDatabase, transaction, query, count } from '../db/sqlite'
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  looksLikeSqlite,
  sha256Hex,
  BackupFormatError,
} from '../core/crypto'
import { insertRow } from '../db/repo/base'
import { uuid } from '../core/ids'
import { nowIso, filenameStamp, relativeDateTime } from '../core/datetime'
import { audit, AUDIT_ACTIONS, auditActor } from '../core/audit'
import { getSetting, setSetting } from '../db/repo/settings'
import { SETTING_KEYS } from '../core/constants'
import { saveFile, readFileBytes, formatBytes } from './fileIo'
import { migrate } from '../db/migrations'
import { uploadBackup } from './cloudBackup'

const COUNTED_TABLES = [
  'participants',
  'vitals',
  'glucose_results',
  'clinical_encounters',
  'wound_assessments',
  'breast_examinations',
  'referrals',
  'followups',
  'inventory_items',
  'expenses',
]

export function recordCounts(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of COUNTED_TABLES) {
    out[t] = count(`SELECT COUNT(*) AS c FROM ${t} WHERE deleted_at IS NULL`)
  }
  return out
}

export interface BackupRecord {
  id: number
  created_at: string
  filename: string
  size_bytes: number | null
  encrypted: number
  checksum: string | null
  record_counts: string | null
  created_by: string | null
  kind: string
  notes: string | null
}

export function listBackups(limit = 30): BackupRecord[] {
  return query<BackupRecord>(
    'SELECT * FROM backups ORDER BY created_at DESC LIMIT ?',
    [limit],
  )
}

export interface BackupResult {
  filename: string
  sizeBytes: number
  checksum: string
  method: 'picker' | 'download' | 'native' | 'desktop'
  /** Where the file landed, for the confirmation message. */
  location?: string
  /** Set when a copy was also sent off the device. */
  cloud?: { uploaded: boolean; error?: string }
}

/** Whether a copy of each backup should also go to the cloud. */
export function cloudBackupEnabled(): boolean {
  return getSetting('backup.cloud_enabled') === 'true'
}

/**
 * Exports the live SQLite image, seals it with AES-GCM under the supplied
 * passphrase and writes it to device storage.
 */
export async function createBackup(
  passphrase: string,
  kind: 'MANUAL' | 'PRE_RESTORE' | 'CLOSURE' = 'MANUAL',
  notes?: string,
  options: { toCloud?: boolean } = {},
): Promise<BackupResult> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('The backup password must be at least 8 characters.')
  }

  const plain = exportBytes()
  const checksum = await sha256Hex(plain)
  const sealed = await encryptBackup(plain, passphrase)
  const filename = `nug-outreach-backup-${filenameStamp()}.nugbak`

  const outcome = await saveFile(
    sealed,
    filename,
    'application/octet-stream',
    'Outreach backup file',
    // On the phone, offer the share sheet straight away so the administrator
    // can move the backup off the device while they are thinking about it.
    { share: true },
  )
  if (!outcome.ok) {
    if (outcome.cancelled) throw new Error('Backup cancelled. No file was written.')
    throw new Error(`The backup file could not be written: ${outcome.error}`)
  }

  const counts = recordCounts()
  await transaction(() => {
    insertRow('backups', {
      uuid: uuid(),
      created_at: nowIso(),
      filename: outcome.name,
      size_bytes: sealed.byteLength,
      encrypted: 1,
      checksum,
      record_counts: JSON.stringify(counts),
      created_by: auditActor().username,
      kind,
      notes: notes ?? null,
    })
    setSetting(SETTING_KEYS.LAST_BACKUP_AT, nowIso())
    audit({
      action: AUDIT_ACTIONS.BACKUP_CREATE,
      entityType: 'backup',
      entityId: outcome.name,
      summary: `Encrypted backup created (${formatBytes(sealed.byteLength)}, ${kind})`,
      newValue: counts,
    })
  })

  // The off-site copy is attempted last and never allowed to fail the
  // backup: the file on this device is already written and already valid,
  // and losing that to a dropped connection would be absurd.
  let cloud: BackupResult['cloud']
  if (options.toCloud ?? cloudBackupEnabled()) {
    try {
      await uploadBackup(sealed, {
        filename: outcome.name,
        checksum,
        createdBy: auditActor().username,
        recordCounts: counts,
      })
      await transaction(() => {
        setSetting('backup.cloud_last_at', nowIso())
        audit({
          action: AUDIT_ACTIONS.BACKUP_CREATE,
          entityType: 'backup',
          entityId: outcome.name,
          summary: `Encrypted backup copied to the cloud (${formatBytes(sealed.byteLength)})`,
        })
      })
      cloud = { uploaded: true }
    } catch (err) {
      cloud = { uploaded: false, error: (err as Error).message }
    }
  }

  return {
    filename: outcome.name,
    sizeBytes: sealed.byteLength,
    checksum,
    method: outcome.method,
    location: outcome.location,
    cloud,
  }
}

/** When the most recent off-site copy was taken. */
export function lastCloudBackupAt(): string | null {
  return getSetting('backup.cloud_last_at')
}

export interface RestorePreview {
  encrypted: boolean
  sizeBytes: number
}

export function inspectBackupFile(bytes: Uint8Array): RestorePreview {
  if (isEncryptedBackup(bytes)) return { encrypted: true, sizeBytes: bytes.byteLength }
  if (looksLikeSqlite(bytes)) return { encrypted: false, sizeBytes: bytes.byteLength }
  throw new BackupFormatError()
}

/**
 * Replaces the live database with the contents of a backup file. The caller
 * is expected to have taken a safety backup first - takeSafetyBackup does
 * that and is wired into the restore screen.
 */
export async function restoreBackup(
  /** A file the administrator chose, or bytes already fetched from the cloud. */
  source: File | Uint8Array,
  passphrase: string | null,
  sourceName?: string,
): Promise<{ counts: Record<string, number> }> {
  const name =
    sourceName ?? (source instanceof Uint8Array ? 'a backup from the cloud' : source.name)
  const raw = source instanceof Uint8Array ? source : await readFileBytes(source)
  const preview = inspectBackupFile(raw)

  let plain: Uint8Array
  if (preview.encrypted) {
    if (!passphrase) throw new Error('This backup is encrypted. Enter its backup password.')
    plain = await decryptBackup(raw, passphrase)
  } else {
    plain = raw
  }

  if (!looksLikeSqlite(plain)) throw new BackupFormatError()

  await replaceDatabase(plain)
  // A backup taken from an older build may predate the current schema.
  migrate()

  const counts = recordCounts()
  await transaction(() => {
    audit({
      action: AUDIT_ACTIONS.BACKUP_RESTORE,
      entityType: 'backup',
      entityId: name,
      summary: `Database restored from ${name}`,
      newValue: counts,
    })
  })
  return { counts }
}

export function lastBackupAt(): string | null {
  return getSetting(SETTING_KEYS.LAST_BACKUP_AT)
}

export type BackupFreshness = 'NEVER' | 'CURRENT' | 'DUE' | 'OVERDUE'

export function backupStatus(): {
  at: string | null
  label: string
  freshness: BackupFreshness
} {
  const at = lastBackupAt()
  if (!at) {
    return { at: null, label: 'No backup has been made on this device', freshness: 'NEVER' }
  }
  const hours = (Date.now() - new Date(at).getTime()) / 3_600_000
  const reminderHours = Number(getSetting(SETTING_KEYS.BACKUP_REMINDER_HOURS) ?? 12)
  let freshness: BackupFreshness = 'CURRENT'
  if (hours > reminderHours * 2) freshness = 'OVERDUE'
  else if (hours > reminderHours) freshness = 'DUE'
  return { at, label: relativeDateTime(at), freshness }
}
