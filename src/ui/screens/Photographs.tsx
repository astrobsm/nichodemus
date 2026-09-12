/**
 * Clinical photography: consent, capture and the gallery (spec S31).
 *
 * The consent gate is the substance of this screen. Everything else is a
 * camera button. A photograph of a wound identifies a person more reliably
 * than their name does, so the capture button does not exist until a
 * PHOTOGRAPHY consent has been recorded for that participant, and withdrawing
 * that consent erases the images rather than merely flagging them.
 */
import { useState } from 'react'
import { useApp, useQuery } from '../AppState'
import {
  AlertBox,
  Card,
  ChoiceGroup,
  ConfirmDialog,
  EmptyState,
  Modal,
  TextField,
  friendlyError,
  useToast,
} from '../components/ui'
import { PERMISSIONS } from '../../core/permissions'
import { formatDateTime } from '../../core/datetime'
import { formatBytes } from '../../services/fileIo'
import {
  PHOTO_CONTEXTS,
  deletePhoto,
  mayPhotograph,
  photoConsent,
  photoImage,
  photosFor,
  savePhoto,
  withdrawPhotoConsent,
  type PhotoSummary,
} from '../../db/repo/photos'
import { recordConsent } from '../../db/repo/participants'
import { PHOTO_CONSENT } from '../../db/repo/photos'
import { asDataUrl, pickImage, prepareImage } from '../../services/photoCapture'
import { labelFor } from '../../core/constants'

const CONTEXT_LABELS: Record<string, string> = {
  WOUND: 'Wound',
  BREAST: 'Breast',
  SKIN: 'Skin',
  OTHER: 'Other',
}

export function PhotographsTab({
  participantId,
  projectId,
  woundId,
}: {
  participantId: number
  projectId: number
  woundId?: number | null
}) {
  const { can, refresh, user } = useApp()
  const toast = useToast()
  const consent = useQuery(() => photoConsent(participantId), [participantId])
  const photos = useQuery(() => photosFor(participantId), [participantId])

  const [capturing, setCapturing] = useState(false)
  const [pending, setPending] = useState<{
    data: string
    width: number
    height: number
    sizeBytes: number
  } | null>(null)
  const [context, setContext] = useState<string>(woundId ? 'WOUND' : 'OTHER')
  const [bodySite, setBodySite] = useState('')
  const [caption, setCaption] = useState('')
  const [viewing, setViewing] = useState<PhotoSummary | null>(null)
  const [deleting, setDeleting] = useState<PhotoSummary | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [busy, setBusy] = useState(false)

  const allowed = mayPhotograph(participantId)

  async function capture() {
    setCapturing(true)
    try {
      const file = await pickImage()
      if (!file) return
      setPending(await prepareImage(file))
    } catch (err) {
      toast('danger', friendlyError(err, 'The photograph could not be taken.'))
    } finally {
      setCapturing(false)
    }
  }

  async function store() {
    if (!pending) return
    setBusy(true)
    try {
      await savePhoto({
        participantId,
        projectId,
        woundId: woundId ?? null,
        context,
        bodySite,
        caption,
        imageData: pending.data,
        width: pending.width,
        height: pending.height,
        sizeBytes: pending.sizeBytes,
        capturedBy: user?.full_name ?? user?.username,
      })
      setPending(null)
      setBodySite('')
      setCaption('')
      refresh()
      toast('ok', 'Photograph saved to this device.')
    } catch (err) {
      toast('danger', friendlyError(err, 'The photograph could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  async function giveConsent(status: string) {
    setBusy(true)
    try {
      await recordConsent(
        participantId,
        status,
        user?.full_name ?? user?.username ?? 'Unknown',
        'Photography consent taken verbally, explained in the participant’s own language.',
        PHOTO_CONSENT,
      )
      refresh()
      toast('ok', status === 'GIVEN' ? 'Photography consent recorded.' : 'Recorded as declined.')
    } catch (err) {
      toast('danger', friendlyError(err, 'The consent could not be recorded.'))
    } finally {
      setBusy(false)
    }
  }

  if (!can(PERMISSIONS.PHOTO_VIEW)) {
    return <EmptyState glyph="⊘" title="Not available for your role" />
  }

  return (
    <>
      <Card title="Photography consent">
        {consent.status === 'GIVEN' ? (
          <AlertBox tone="ok" title="Consent given">
            Recorded {consent.at ? formatDateTime(consent.at) : ''}. Photographs are stored inside
            this application only — never in the phone’s picture gallery.
          </AlertBox>
        ) : consent.status ? (
          <AlertBox tone="warn" title={`Photography ${labelFor(consent.status).toLowerCase()}`}>
            No photograph may be taken of this participant.
          </AlertBox>
        ) : (
          <AlertBox tone="info" title="No photography consent recorded">
            Consent to be treated is not consent to be photographed. Ask separately, in the
            participant’s own language, and explain that the image stays inside this application
            and is used only for their care and for the outreach report.
          </AlertBox>
        )}

        {can(PERMISSIONS.PHOTO_CAPTURE) && consent.status !== 'GIVEN' ? (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" disabled={busy} onClick={() => void giveConsent('GIVEN')}>
              Consent given
            </button>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => void giveConsent('DECLINED')}
            >
              Declined
            </button>
          </div>
        ) : null}

        {consent.status === 'GIVEN' && can(PERMISSIONS.PHOTO_CAPTURE) ? (
          <div style={{ marginTop: 12 }}>
            <button
              className="btn block secondary"
              disabled={busy}
              onClick={() => setWithdrawing(true)}
            >
              Withdraw consent and erase photographs
            </button>
          </div>
        ) : null}
      </Card>

      {can(PERMISSIONS.PHOTO_CAPTURE) && allowed ? (
        <button className="btn block large" onClick={() => void capture()} disabled={capturing}>
          {capturing ? 'Opening the camera…' : 'Take a photograph'}
        </button>
      ) : null}

      {photos.length === 0 ? (
        <EmptyState glyph="▣" title="No photographs">
          {allowed
            ? 'Photographs taken here stay inside this application and leave the device only inside an encrypted backup.'
            : null}
        </EmptyState>
      ) : (
        <div className="photo-grid">
          {photos.map((p) => (
            <button key={p.id} className="photo-tile" onClick={() => setViewing(p)}>
              <PhotoThumb id={p.id} alt={p.caption ?? CONTEXT_LABELS[p.context] ?? 'Photograph'} />
              <span className="photo-meta">
                {CONTEXT_LABELS[p.context] ?? p.context}
                {p.body_site ? ` · ${p.body_site}` : ''}
                <span className="secondary">{formatDateTime(p.captured_at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {pending ? (
        <Modal title="Save this photograph?" onClose={() => setPending(null)}>
          <img
            src={asDataUrl(pending.data)}
            alt="The photograph just taken"
            style={{ width: '100%', borderRadius: 10, marginBottom: 12 }}
          />
          <p className="hint" style={{ marginTop: 0 }}>
            {pending.width} × {pending.height}, {formatBytes(pending.sizeBytes)}. Check that no
            face, name or house number is visible unless it is clinically necessary.
          </p>
          <ChoiceGroup
            label="What does it show?"
            value={context}
            onChange={setContext}
            options={PHOTO_CONTEXTS.map((c) => ({ value: c, label: CONTEXT_LABELS[c] ?? c }))}
          />
          <TextField
            label="Body site"
            value={bodySite}
            onChange={setBodySite}
            help="For example: left lower leg, medial aspect."
          />
          <TextField label="Note" value={caption} onChange={setCaption} />
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setPending(null)} disabled={busy}>
              Discard
            </button>
            <button className="btn" onClick={() => void store()} disabled={busy}>
              {busy ? 'Saving…' : 'Save photograph'}
            </button>
          </div>
        </Modal>
      ) : null}

      {viewing ? (
        <Modal
          title={CONTEXT_LABELS[viewing.context] ?? viewing.context}
          subtitle={formatDateTime(viewing.captured_at)}
          onClose={() => setViewing(null)}
          wide
        >
          <PhotoFull id={viewing.id} alt={viewing.caption ?? 'Clinical photograph'} />
          {viewing.body_site ? <p style={{ fontWeight: 700 }}>{viewing.body_site}</p> : null}
          {viewing.caption ? <p>{viewing.caption}</p> : null}
          <p className="hint">
            Taken by {viewing.captured_by ?? 'unknown'} · {formatBytes(viewing.size_bytes ?? 0)}
          </p>
          {can(PERMISSIONS.PHOTO_DELETE) ? (
            <button
              className="btn block danger"
              onClick={() => {
                setDeleting(viewing)
                setViewing(null)
              }}
            >
              Delete this photograph
            </button>
          ) : null}
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete this photograph?"
          message="The image is erased immediately and cannot be recovered, including from backups taken after this moment. The record that it existed, and who deleted it, stays in the audit trail."
          destructive
          confirmLabel="Delete and erase"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await deletePhoto(deleting.id, 'Deleted by a clinician on the device')
              refresh()
              toast('ok', 'Photograph deleted and erased.')
            } catch (err) {
              toast('danger', friendlyError(err, 'The photograph could not be deleted.'))
            } finally {
              setDeleting(null)
            }
          }}
        />
      ) : null}

      {withdrawing ? (
        <ConfirmDialog
          title="Withdraw photography consent?"
          message={`Every photograph of this participant (${photos.length}) is erased immediately. This is what withdrawal of consent means in practice and it cannot be undone.`}
          destructive
          confirmLabel="Withdraw and erase"
          onCancel={() => setWithdrawing(false)}
          onConfirm={async () => {
            try {
              const erased = await withdrawPhotoConsent(
                participantId,
                'Participant withdrew photography consent',
              )
              await recordConsent(
                participantId,
                'WITHDRAWN',
                user?.full_name ?? user?.username ?? 'Unknown',
                'Photography consent withdrawn by the participant.',
                PHOTO_CONSENT,
              )
              refresh()
              toast('ok', `Consent withdrawn. ${erased} photograph(s) erased.`)
            } catch (err) {
              toast('danger', friendlyError(err, 'The consent could not be withdrawn.'))
            } finally {
              setWithdrawing(false)
            }
          }}
        />
      ) : null}
    </>
  )
}

/** Loads the image only when it is actually on screen. */
function PhotoThumb({ id, alt }: { id: number; alt: string }) {
  const data = useQuery(() => photoImage(id), [id])
  if (!data) return <span className="photo-missing" aria-label="Image erased" />
  return <img src={asDataUrl(data)} alt={alt} loading="lazy" />
}

function PhotoFull({ id, alt }: { id: number; alt: string }) {
  const data = useQuery(() => photoImage(id), [id])
  if (!data) {
    return (
      <AlertBox tone="warn" title="The image has been erased">
        The record of this photograph remains, but the image itself was deleted.
      </AlertBox>
    )
  }
  return <img src={asDataUrl(data)} alt={alt} style={{ width: '100%', borderRadius: 10 }} />
}
