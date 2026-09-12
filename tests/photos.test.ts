/**
 * Clinical photography.
 *
 * The tests that matter here are the ones about consent and erasure, not the
 * ones about storing bytes. A photograph of a wound identifies a person more
 * reliably than their name does, so "no consent, no image" and "withdrawal
 * erases what was taken" have to be properties of the code rather than
 * promises in a manual.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDatabase, teardown, type Fixture } from './helpers'
import { registerParticipant, recordConsent, type Participant } from '../src/db/repo/participants'
import {
  PHOTO_CONSENT,
  deletePhoto,
  mayPhotograph,
  photoBytes,
  photoConsent,
  photoCount,
  photoImage,
  photosFor,
  savePhoto,
  updatePhotoCaption,
  withdrawPhotoConsent,
  PhotoConsentError,
} from '../src/db/repo/photos'
import { enqueueAllPhotos, photoSyncEnabled } from '../src/db/repo/base'
import { setSetting } from '../src/db/repo/settings'
import { transaction, query, queryOne, count } from '../src/db/sqlite'
import { auditForEntity } from '../src/core/audit'
import { base64Bytes } from '../src/services/photoCapture'

let fx: Fixture
let participant: Participant

// A 2x2 JPEG is enough: nothing here depends on what the image contains.
const IMAGE =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFQABAQAAAAAA' +
  'AAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKAAA//Z'

async function photograph(overrides: Record<string, unknown> = {}) {
  return savePhoto({
    participantId: participant.id,
    projectId: fx.project.id,
    context: 'WOUND',
    bodySite: 'Left lower leg',
    imageData: IMAGE,
    width: 1440,
    height: 1080,
    sizeBytes: base64Bytes(IMAGE),
    capturedBy: 'Nurse Ngozi',
    ...overrides,
  })
}

beforeEach(async () => {
  fx = await freshDatabase()
  participant = await registerParticipant(
    fx.project,
    { firstName: 'Ada', lastName: 'Obi', sex: 'FEMALE', ageYears: 52, consentStatus: 'GIVEN' },
    { overrideDuplicate: true },
  )
})

afterAll(teardown)

describe('consent to be photographed', () => {
  it('refuses to store an image without one', async () => {
    await expect(photograph()).rejects.toBeInstanceOf(PhotoConsentError)
    expect(photoCount()).toBe(0)
  })

  it('is not satisfied by consent to treatment', async () => {
    // The participant already consented to care during registration.
    expect(participant.id).toBeGreaterThan(0)
    expect(mayPhotograph(participant.id)).toBe(false)
  })

  it('allows capture once photography consent is given', async () => {
    await recordConsent(participant.id, 'GIVEN', 'Nurse Ngozi', undefined, PHOTO_CONSENT)
    expect(mayPhotograph(participant.id)).toBe(true)
    const id = await photograph()
    expect(id).toBeGreaterThan(0)
    expect(photoCount()).toBe(1)
  })

  it('refuses again after consent is declined', async () => {
    await recordConsent(participant.id, 'DECLINED', 'Nurse Ngozi', undefined, PHOTO_CONSENT)
    expect(mayPhotograph(participant.id)).toBe(false)
    await expect(photograph()).rejects.toBeInstanceOf(PhotoConsentError)
  })

  it('takes the most recent decision, so a withdrawal overrides an earlier yes', async () => {
    await recordConsent(participant.id, 'GIVEN', 'Nurse', undefined, PHOTO_CONSENT)
    await photograph()
    await recordConsent(participant.id, 'WITHDRAWN', 'Nurse', undefined, PHOTO_CONSENT)
    expect(photoConsent(participant.id).status).toBe('WITHDRAWN')
    expect(mayPhotograph(participant.id)).toBe(false)
    await expect(photograph()).rejects.toBeInstanceOf(PhotoConsentError)
  })

  it('records which consent the image was taken under', async () => {
    await recordConsent(participant.id, 'GIVEN', 'Nurse', undefined, PHOTO_CONSENT)
    await photograph()
    const [photo] = photosFor(participant.id)
    expect(photo.consent_uuid).toBe(photoConsent(participant.id).uuid)
  })
})

describe('storing a photograph', () => {
  beforeEach(async () => {
    await recordConsent(participant.id, 'GIVEN', 'Nurse Ngozi', undefined, PHOTO_CONSENT)
  })

  it('keeps the image and its measurements', async () => {
    const id = await photograph()
    const [photo] = photosFor(participant.id)
    expect(photo.body_site).toBe('Left lower leg')
    expect(photo.width).toBe(1440)
    expect(photo.captured_by).toBe('Nurse Ngozi')
    expect(photoImage(id)).toBe(IMAGE)
  })

  it('does not carry the image in the listing', async () => {
    await photograph()
    const [photo] = photosFor(participant.id)
    expect(JSON.stringify(photo)).not.toContain(IMAGE.slice(0, 40))
  })

  it('records the capture in the audit trail without the image in it', async () => {
    const id = await photograph()
    const entries = auditForEntity('clinical_photo', id)
    expect(entries.length).toBeGreaterThan(0)
    expect(JSON.stringify(entries)).not.toContain(IMAGE.slice(0, 40))
    expect(entries[0].summary).toMatch(/photograph taken/i)
  })

  it('reports how much of the device the photographs are using', async () => {
    await photograph()
    await photograph()
    expect(photoCount()).toBe(2)
    expect(photoBytes()).toBe(base64Bytes(IMAGE) * 2)
  })

  it('lets a caption be corrected afterwards', async () => {
    const id = await photograph()
    await updatePhotoCaption(id, 'Day 3, after dressing')
    expect(photosFor(participant.id)[0].caption).toBe('Day 3, after dressing')
  })
})

describe('erasing a photograph', () => {
  beforeEach(async () => {
    await recordConsent(participant.id, 'GIVEN', 'Nurse Ngozi', undefined, PHOTO_CONSENT)
  })

  it('removes the image itself, not merely the row', async () => {
    const id = await photograph()
    await deletePhoto(id, 'Taken in error')

    expect(photosFor(participant.id)).toHaveLength(0)
    // The bytes must be gone from the file, or a backup taken afterwards
    // would still carry an image someone asked to have removed.
    const rows = query<{ image_data: string }>(
      'SELECT image_data FROM clinical_photos WHERE id = ?',
      [id],
    )
    expect(rows[0].image_data).toBe('')
  })

  it('leaves the audit trail showing that it happened', async () => {
    const id = await photograph()
    await deletePhoto(id, 'Taken in error')
    const summaries = auditForEntity('clinical_photo', id).map((e) => e.summary ?? '')
    expect(summaries.some((s) => /erased/i.test(s) && /Taken in error/.test(s))).toBe(true)
  })

  it('erases every image when consent is withdrawn', async () => {
    await photograph()
    await photograph()
    await photograph()

    const erased = await withdrawPhotoConsent(participant.id, 'Participant changed their mind')
    expect(erased).toBe(3)
    expect(photosFor(participant.id)).toHaveLength(0)

    const remaining = count(
      "SELECT COUNT(*) AS c FROM clinical_photos WHERE image_data <> ''",
    )
    expect(remaining).toBe(0)
  })

  it('replicates the deletion when photographs are synchronised', async () => {
    // Otherwise a device that already received the image would keep showing
    // it after it had been erased everywhere else.
    await transaction(() => setSetting('photos.sync_enabled', 'true'))
    const id = await photograph()
    await deletePhoto(id, 'Taken in error')

    const queued = queryOne<{ row_uuid: string }>(
      "SELECT row_uuid FROM sync_outbox WHERE table_name = 'clinical_photos'",
    )
    const row = queryOne<{ uuid: string; deleted_at: string | null; version: number }>(
      'SELECT uuid, deleted_at, version FROM clinical_photos WHERE id = ?',
      [id],
    )
    expect(queued?.row_uuid).toBe(row?.uuid)
    expect(row?.deleted_at).not.toBeNull()
    // The version must rise, or the deletion could lose last-write-wins to
    // the very row it deletes and the image would come back.
    expect(Number(row?.version)).toBeGreaterThan(1)
  })
})

describe('whether photographs leave the device', () => {
  beforeEach(async () => {
    await recordConsent(participant.id, 'GIVEN', 'Nurse Ngozi', undefined, PHOTO_CONSENT)
  })

  it('does not queue them for synchronisation by default', async () => {
    expect(photoSyncEnabled()).toBe(false)
    await photograph()
    const queued = count(
      "SELECT COUNT(*) AS c FROM sync_outbox WHERE table_name = 'clinical_photos'",
    )
    expect(queued).toBe(0)
  })

  it('still queues the ordinary clinical record beside it', async () => {
    await photograph()
    const others = count(
      "SELECT COUNT(*) AS c FROM sync_outbox WHERE table_name = 'participants'",
    )
    expect(others).toBeGreaterThan(0)
  })

  it('queues them once an administrator turns it on', async () => {
    await transaction(() => setSetting('photos.sync_enabled', 'true'))
    expect(photoSyncEnabled()).toBe(true)
    await photograph()
    const queued = count(
      "SELECT COUNT(*) AS c FROM sync_outbox WHERE table_name = 'clinical_photos'",
    )
    expect(queued).toBe(1)
  })

  it('can send images taken before it was turned on', async () => {
    await photograph()
    await photograph()
    await transaction(() => setSetting('photos.sync_enabled', 'true'))

    const queued = await transaction(() => enqueueAllPhotos())
    expect(queued).toBe(2)
    expect(
      count("SELECT COUNT(*) AS c FROM sync_outbox WHERE table_name = 'clinical_photos'"),
    ).toBe(2)
  })
})
