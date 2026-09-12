/**
 * Clinical photographs (spec S31).
 *
 * A photograph of a wound or a breast lesion is the most identifiable record
 * this application holds — a face, a tattoo or a doorway in the background
 * identifies a person far more reliably than a name does. Three rules are
 * therefore enforced here rather than left to the person holding the phone:
 *
 *   1. Nothing is stored without a PHOTOGRAPHY consent recorded as GIVEN for
 *      that participant. Consent to be treated is not consent to be
 *      photographed, and consent can be withdrawn afterwards.
 *   2. The image never touches the device's camera roll. It goes straight
 *      into the local database, so it leaves the device only inside an
 *      encrypted backup — never in a gallery, a chat or a cloud photo sync.
 *   3. It is excluded from synchronisation unless an administrator turns that
 *      on deliberately. This is the one record whose default is that it never
 *      leaves the device that took it.
 *
 * Withdrawing consent removes the images: see `withdrawPhotoConsent`.
 */
import { query, queryOne, count, transaction } from '../sqlite'
import {
  findAll,
  insertEnvelope,
  insertRow,
  softDelete,
  updateEnvelope,
  updateRow,
  currentVersion,
  nullIfBlank,
} from './base'
import { audit, AUDIT_ACTIONS } from '../../core/audit'
import { nowIso } from '../../core/datetime'
import { sha256Hex } from '../../core/crypto'

export const PHOTO_CONSENT = 'PHOTOGRAPHY'

export const PHOTO_CONTEXTS = ['WOUND', 'BREAST', 'SKIN', 'OTHER'] as const
export type PhotoContext = (typeof PHOTO_CONTEXTS)[number]

export interface ClinicalPhoto {
  id: number
  uuid: string
  participant_id: number
  project_id: number
  wound_id: number | null
  context: string
  body_site: string | null
  caption: string | null
  captured_at: string
  captured_by: string | null
  consent_uuid: string | null
  mime_type: string
  width: number | null
  height: number | null
  size_bytes: number | null
  checksum: string | null
  image_data: string
}

/** Everything except the image itself, for listings that do not display one. */
export type PhotoSummary = Omit<ClinicalPhoto, 'image_data'>

const SUMMARY_COLUMNS = `id, uuid, participant_id, project_id, wound_id, context, body_site,
  caption, captured_at, captured_by, consent_uuid, mime_type, width, height, size_bytes, checksum`

/**
 * Whether this participant has agreed to be photographed.
 *
 * Only the most recent PHOTOGRAPHY consent counts, so a withdrawal recorded
 * after a consent correctly blocks any further capture.
 */
export function photoConsent(participantId: number): {
  status: string | null
  uuid: string | null
  at: string | null
} {
  const row = queryOne<{ status: string; uuid: string; obtained_at: string }>(
    `SELECT status, uuid, obtained_at FROM consents
      WHERE participant_id = ? AND consent_type = ? AND deleted_at IS NULL
      ORDER BY obtained_at DESC, id DESC LIMIT 1`,
    [participantId, PHOTO_CONSENT],
  )
  if (!row) return { status: null, uuid: null, at: null }
  return { status: row.status, uuid: row.uuid, at: row.obtained_at }
}

export function mayPhotograph(participantId: number): boolean {
  return photoConsent(participantId).status === 'GIVEN'
}

export class PhotoConsentError extends Error {
  constructor() {
    super(
      'This participant has not consented to being photographed. Record photography consent first, in their own language, before taking any image.',
    )
    this.name = 'PhotoConsentError'
  }
}

export function photosFor(participantId: number): PhotoSummary[] {
  return query<PhotoSummary>(
    `SELECT ${SUMMARY_COLUMNS} FROM clinical_photos
      WHERE participant_id = ? AND deleted_at IS NULL
      ORDER BY captured_at DESC, id DESC`,
    [participantId],
  )
}

export function photosForWound(woundId: number): PhotoSummary[] {
  return query<PhotoSummary>(
    `SELECT ${SUMMARY_COLUMNS} FROM clinical_photos
      WHERE wound_id = ? AND deleted_at IS NULL
      ORDER BY captured_at ASC, id ASC`,
    [woundId],
  )
}

/** The image itself, read only when one is actually being displayed. */
export function photoImage(id: number): string | null {
  const row = queryOne<{ image_data: string }>(
    'SELECT image_data FROM clinical_photos WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  return row?.image_data ?? null
}

export function photoCount(): number {
  return count('SELECT COUNT(*) AS c FROM clinical_photos WHERE deleted_at IS NULL')
}

export function photoBytes(): number {
  const row = queryOne<{ total: number }>(
    'SELECT COALESCE(SUM(size_bytes), 0) AS total FROM clinical_photos WHERE deleted_at IS NULL',
  )
  return Number(row?.total ?? 0)
}

export interface PhotoInput {
  participantId: number
  projectId: number
  woundId?: number | null
  context: PhotoContext | string
  bodySite?: string
  caption?: string
  /** Base64 JPEG payload, without a data: prefix. */
  imageData: string
  width: number
  height: number
  sizeBytes: number
  capturedBy?: string
}

export async function savePhoto(input: PhotoInput): Promise<number> {
  const consent = photoConsent(input.participantId)
  if (consent.status !== 'GIVEN') throw new PhotoConsentError()

  const checksum = await sha256Hex(new TextEncoder().encode(input.imageData))

  return transaction(() => {
    const id = insertRow('clinical_photos', {
      ...insertEnvelope(),
      participant_id: input.participantId,
      project_id: input.projectId,
      wound_id: input.woundId ?? null,
      context: input.context,
      body_site: nullIfBlank(input.bodySite),
      caption: nullIfBlank(input.caption),
      captured_at: nowIso(),
      captured_by: nullIfBlank(input.capturedBy),
      consent_uuid: consent.uuid,
      mime_type: 'image/jpeg',
      width: input.width,
      height: input.height,
      size_bytes: input.sizeBytes,
      checksum,
      image_data: input.imageData,
    })
    // The audit trail records that an image exists and who took it. It never
    // records the image, so exporting the audit trail cannot leak one.
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'clinical_photo',
      entityId: id,
      summary: `Clinical photograph taken (${input.context}${
        input.bodySite ? `, ${input.bodySite}` : ''
      }), ${Math.round(input.sizeBytes / 1024)} KB`,
    })
    return id
  })
}

export async function updatePhotoCaption(id: number, caption: string): Promise<void> {
  await transaction(() => {
    updateRow('clinical_photos', id, {
      ...updateEnvelope(currentVersion('clinical_photos', id)),
      caption: nullIfBlank(caption),
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'clinical_photo',
      entityId: id,
      summary: 'Photograph caption changed',
    })
  })
}

/**
 * Removes a photograph. The row is soft-deleted like every other record so
 * the deletion replicates, but the image bytes are cleared outright: a
 * photograph someone asked to have removed must not survive in a backup.
 */
export async function deletePhoto(id: number, reason: string): Promise<void> {
  await transaction(() => {
    updateRow('clinical_photos', id, {
      ...updateEnvelope(currentVersion('clinical_photos', id)),
      image_data: '',
      size_bytes: 0,
    })
    softDelete('clinical_photos', id)
    audit({
      action: AUDIT_ACTIONS.DELETE,
      entityType: 'clinical_photo',
      entityId: id,
      summary: `Photograph deleted and its image erased. Reason: ${reason}`,
    })
  })
}

/**
 * Withdrawing photography consent erases every image already taken of that
 * participant. Consent that cannot be withdrawn in practice is not consent.
 */
export async function withdrawPhotoConsent(participantId: number, reason: string): Promise<number> {
  const existing = findAll<{ id: number }>(
    'clinical_photos',
    'participant_id = ?',
    [participantId],
    'id',
  )
  for (const photo of existing) {
    await deletePhoto(photo.id, reason)
  }
  return existing.length
}
