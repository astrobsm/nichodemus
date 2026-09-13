/**
 * Writing the outreach's official letters.
 *
 * Three screens in one: the letters already written, a choice of what to
 * write, and the editor. The editor gives every segment of an official letter
 * its own field — reference, date, recipient, salutation, subject, body,
 * close, signatory, enclosures, copies — because that is what the person
 * receiving it will look for, and a letter missing one of them looks like it
 * came from somebody who does not write letters.
 */
import { useState } from 'react'
import { useApp, useQuery } from '../AppState'
import {
  AlertBox,
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  Modal,
  SelectField,
  TextArea,
  TextField,
  friendlyError,
  useToast,
} from '../components/ui'
import { PERMISSIONS } from '../../core/permissions'
import { formatLongDate, relativeDateTime } from '../../core/datetime'
import {
  CATEGORY_LABELS,
  CLOSINGS,
  LETTER_TEMPLATES,
  SALUTATIONS,
  fillPlaceholders,
  missingPlaceholders,
  type LetterTemplate,
} from '../../core/letterTemplates'
import {
  deleteLetter,
  getLetter,
  lettersFor,
  markSent,
  nextSequence,
  saveLetter,
  splitBody,
  splitList,
  updateLetter,
  type Letter,
} from '../../db/repo/letters'
import { letterDate, nextReference, saveLetterPdf } from '../../services/letterPdf'
import type { Project } from '../../db/repo/projects'

type View = { kind: 'LIST' } | { kind: 'CHOOSE' } | { kind: 'EDIT'; id?: number }

interface Draft {
  templateKey: string | null
  reference: string
  letterDate: string
  recipientTitle: string
  recipientName: string
  recipientOrganisation: string
  recipientAddress: string
  salutation: string
  subject: string
  body: string
  closing: string
  signatoryName: string
  signatoryTitle: string
  enclosures: string
  copies: string
  status: 'DRAFT' | 'FINAL' | 'SENT'
}

function placeholdersOf(project: Project) {
  return {
    project_name: project.name,
    location: project.location ?? '',
    lga: project.lga ?? '',
    state: project.state ?? '',
    date: project.proposed_date ? formatLongDate(project.proposed_date) : '',
    start_time: project.start_time ?? '',
    end_time: project.end_time ?? '',
    expected: project.expected_participants ? String(project.expected_participants) : '',
    honouree: project.memorial_honouree ?? '',
    project_director: project.project_director ?? '',
    medical_director: project.medical_director ?? '',
  }
}

function fromTemplate(template: LetterTemplate, project: Project, reference: string, who: string): Draft {
  const values = placeholdersOf(project)
  return {
    templateKey: template.key,
    reference,
    letterDate: letterDate(),
    recipientTitle: fillPlaceholders(template.suggestedTitle ?? '', values),
    recipientName: '',
    recipientOrganisation: '',
    recipientAddress: '',
    salutation: template.suggestedSalutation,
    subject: fillPlaceholders(template.subject, values),
    body: template.body.map((p) => fillPlaceholders(p, values)).join('\n\n'),
    closing: template.closing,
    signatoryName: who,
    signatoryTitle: project.project_director === who ? 'Project Director' : '',
    enclosures: (template.enclosures ?? []).map((e) => fillPlaceholders(e, values)).join('\n'),
    copies: (template.copies ?? []).map((c) => fillPlaceholders(c, values)).join('\n'),
    status: 'DRAFT',
  }
}

function fromRecord(letter: Letter): Draft {
  return {
    templateKey: letter.template_key,
    reference: letter.reference ?? '',
    letterDate: letter.letter_date ?? letterDate(),
    recipientTitle: letter.recipient_title ?? '',
    recipientName: letter.recipient_name ?? '',
    recipientOrganisation: letter.recipient_organisation ?? '',
    recipientAddress: letter.recipient_address ?? '',
    salutation: letter.salutation ?? 'Dear Sir/Madam',
    subject: letter.subject ?? '',
    body: letter.body ?? '',
    closing: letter.closing ?? 'Yours faithfully,',
    signatoryName: letter.signatory_name ?? '',
    signatoryTitle: letter.signatory_title ?? '',
    enclosures: (letter.enclosures ?? '').replace(/\n+/g, '\n'),
    copies: (letter.copies ?? '').replace(/\n+/g, '\n'),
    status: letter.status,
  }
}

export function LettersScreen() {
  const { project, can, user, refresh } = useApp()
  const [view, setView] = useState<View>({ kind: 'LIST' })
  const letters = useQuery(() => (project ? lettersFor(project.id) : []), [project?.id, view])

  if (!project) return <EmptyState glyph="□" title="No active project" />
  if (!can(PERMISSIONS.LETTER_VIEW)) {
    return <EmptyState glyph="⊘" title="Not available for your role" />
  }

  const mayWrite = can(PERMISSIONS.LETTER_EDIT)

  if (view.kind === 'CHOOSE') {
    return (
      <ChooseTemplate
        onPick={(template) => {
          const reference = nextReference(project, nextSequence(project.id))
          setDraftSeed(fromTemplate(template, project, reference, user?.full_name ?? ''))
          setView({ kind: 'EDIT' })
        }}
        onBlank={() => {
          const reference = nextReference(project, nextSequence(project.id))
          setDraftSeed({
            templateKey: null,
            reference,
            letterDate: letterDate(),
            recipientTitle: '',
            recipientName: '',
            recipientOrganisation: '',
            recipientAddress: '',
            salutation: 'Dear Sir/Madam',
            subject: '',
            body: '',
            closing: 'Yours faithfully,',
            signatoryName: user?.full_name ?? '',
            signatoryTitle: '',
            enclosures: '',
            copies: '',
            status: 'DRAFT',
          })
          setView({ kind: 'EDIT' })
        }}
        onCancel={() => setView({ kind: 'LIST' })}
      />
    )
  }

  if (view.kind === 'EDIT') {
    return (
      <LetterEditor
        project={project}
        existingId={view.id}
        seed={view.id ? undefined : draftSeed}
        onDone={() => {
          refresh()
          setView({ kind: 'LIST' })
        }}
        onCancel={() => setView({ kind: 'LIST' })}
      />
    )
  }

  return (
    <>
      <h2 style={{ marginTop: 0, fontSize: 20 }}>Official letters</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Letters to the palace, the Local Government, the Ministry and everyone else the outreach
        must write to. Each one is printed on the outreach letterhead and saved as a PDF.
      </p>

      {mayWrite ? (
        <button className="btn block large" onClick={() => setView({ kind: 'CHOOSE' })}>
          Write a letter
        </button>
      ) : null}

      {letters.length === 0 ? (
        <EmptyState glyph="✉" title="No letters yet">
          Start with the traditional ruler — nothing else should be sent before the palace has
          given its blessing.
        </EmptyState>
      ) : (
        <Card flush>
          {letters.map((l) => (
            <button
              key={l.id}
              className="list-item"
              onClick={() => setView({ kind: 'EDIT', id: l.id })}
            >
              <span className="grow">
                <span className="primary">{l.subject || 'Untitled letter'}</span>
                <span className="secondary">
                  {[l.recipient_title, l.recipient_name, l.recipient_organisation]
                    .filter(Boolean)
                    .join(' · ') || 'No recipient yet'}
                </span>
                <span className="secondary">
                  {l.reference ? `${l.reference} · ` : ''}
                  {l.letter_date ?? ''}
                  {l.sent_at ? ` · sent ${relativeDateTime(l.sent_at)}` : ''}
                </span>
              </span>
              <Badge tone={l.status === 'SENT' ? 'ok' : l.status === 'FINAL' ? 'info' : 'muted'}>
                {l.status === 'SENT' ? 'Sent' : l.status === 'FINAL' ? 'Final' : 'Draft'}
              </Badge>
            </button>
          ))}
        </Card>
      )}
    </>
  )
}

// The seed survives the hop from the chooser to the editor. Module scope
// rather than state because the chooser unmounts as the editor mounts.
let draftSeed: Draft | null = null
function setDraftSeed(d: Draft) {
  draftSeed = d
}

function ChooseTemplate({
  onPick,
  onBlank,
  onCancel,
}: {
  onPick: (t: LetterTemplate) => void
  onBlank: () => void
  onCancel: () => void
}) {
  const categories = [...new Set(LETTER_TEMPLATES.map((t) => t.category))]
  return (
    <>
      <h2 style={{ marginTop: 0, fontSize: 20 }}>What kind of letter?</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Each of these is a draft to work from, not a form to send unread. Change anything that does
        not fit.
      </p>

      {categories.map((category) => (
        <Card key={category} title={CATEGORY_LABELS[category]} flush>
          {LETTER_TEMPLATES.filter((t) => t.category === category).map((t) => (
            <button key={t.key} className="list-item" onClick={() => onPick(t)}>
              <span className="grow">
                <span className="primary">{t.name}</span>
                <span className="secondary">{t.audience}</span>
                <span className="secondary">{t.timing}</span>
              </span>
              <span className="chevron" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </Card>
      ))}

      <button className="btn block secondary" onClick={onBlank}>
        Write one from scratch
      </button>
      <div style={{ height: 10 }} />
      <button className="btn block ghost" onClick={onCancel}>
        Cancel
      </button>
    </>
  )
}

function LetterEditor({
  project,
  existingId,
  seed,
  onDone,
  onCancel,
}: {
  project: Project
  existingId?: number
  seed?: Draft | null
  onDone: () => void
  onCancel: () => void
}) {
  const { can, user } = useApp()
  const toast = useToast()
  const existing = useQuery(() => (existingId ? getLetter(existingId) : null), [existingId])

  const [draft, setDraft] = useState<Draft>(
    () =>
      (existingId && existing ? fromRecord(existing) : null) ??
      seed ??
      draftSeed ?? {
        templateKey: null,
        reference: '',
        letterDate: letterDate(),
        recipientTitle: '',
        recipientName: '',
        recipientOrganisation: '',
        recipientAddress: '',
        salutation: 'Dear Sir/Madam',
        subject: '',
        body: '',
        closing: 'Yours faithfully,',
        signatoryName: user?.full_name ?? '',
        signatoryTitle: '',
        enclosures: '',
        copies: '',
        status: 'DRAFT',
      },
  )
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deliveredBy, setDeliveredBy] = useState('')

  const mayWrite = can(PERMISSIONS.LETTER_EDIT)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  // Anything the template could not fill, so nothing goes out with "[date]"
  // still in it.
  const unfilled = missingPlaceholders(`${draft.subject}\n${draft.body}`)

  function asInput() {
    return {
      projectId: project.id,
      templateKey: draft.templateKey,
      reference: draft.reference,
      letterDate: draft.letterDate,
      recipientName: draft.recipientName,
      recipientTitle: draft.recipientTitle,
      recipientOrganisation: draft.recipientOrganisation,
      recipientAddress: draft.recipientAddress,
      salutation: draft.salutation,
      subject: draft.subject,
      body: splitBody(draft.body),
      closing: draft.closing,
      signatoryName: draft.signatoryName,
      signatoryTitle: draft.signatoryTitle,
      enclosures: splitList(draft.enclosures),
      copies: splitList(draft.copies),
      status: draft.status,
    }
  }

  async function save(): Promise<number | null> {
    setBusy(true)
    try {
      if (existingId) {
        await updateLetter(existingId, asInput())
        toast('ok', 'Letter saved.')
        return existingId
      }
      const id = await saveLetter(asInput())
      toast('ok', 'Letter saved.')
      return id
    } catch (err) {
      toast('danger', friendlyError(err, 'The letter could not be saved.'))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    setBusy(true)
    try {
      await save()
      const result = await saveLetterPdf(project, {
        reference: draft.reference,
        date: draft.letterDate,
        recipientName: draft.recipientName,
        recipientTitle: draft.recipientTitle,
        recipientOrganisation: draft.recipientOrganisation,
        recipientAddress: draft.recipientAddress,
        salutation: draft.salutation,
        subject: draft.subject,
        body: splitBody(draft.body),
        closing: draft.closing,
        signatoryName: draft.signatoryName,
        signatoryTitle: draft.signatoryTitle,
        enclosures: splitList(draft.enclosures),
        copies: splitList(draft.copies),
        draft: draft.status === 'DRAFT',
      })
      toast(
        'ok',
        `Saved as ${result.filename}${result.location ? ` in ${result.location}` : ''}.`,
      )
    } catch (err) {
      toast('danger', friendlyError(err, 'The letter could not be produced.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 0, fontSize: 20 }}>
        {existingId ? 'Edit letter' : 'New letter'}
      </h2>

      {!mayWrite ? (
        <AlertBox tone="info" title="You can read this letter but not change it">
          Ask an administrator if you need to edit correspondence.
        </AlertBox>
      ) : null}

      {unfilled.length > 0 ? (
        <AlertBox tone="warn" title="Some details are still missing">
          This letter still says {unfilled.map((u) => `[${u}]`).join(', ')}. Fill those in — or
          complete them in Settings → Project so every letter has them — before sending it.
        </AlertBox>
      ) : null}

      <Card title="Reference and date">
        <TextField
          label="Reference number"
          value={draft.reference}
          onChange={(v) => set('reference', v)}
          help="Your own file number. Offices quote it back when they reply."
        />
        <TextField
          label="Date on the letter"
          value={draft.letterDate}
          onChange={(v) => set('letterDate', v)}
          help="Written out in full, as on a letter."
        />
      </Card>

      <Card title="Who it goes to">
        <TextField
          label="Their title or office"
          value={draft.recipientTitle}
          onChange={(v) => set('recipientTitle', v)}
          help="For example: The Honourable Commissioner for Health."
        />
        <TextField
          label="Their name"
          value={draft.recipientName}
          onChange={(v) => set('recipientName', v)}
        />
        <TextField
          label="Ministry, organisation or palace"
          value={draft.recipientOrganisation}
          onChange={(v) => set('recipientOrganisation', v)}
        />
        <TextArea
          label="Address"
          value={draft.recipientAddress}
          onChange={(v) => set('recipientAddress', v)}
          help="One line per line, as it should appear on the letter."
        />
        <SelectField
          label="Salutation"
          value={draft.salutation}
          onChange={(v) => set('salutation', v)}
          options={SALUTATIONS.map((s) => ({ value: s, label: s }))}
          help="Getting this wrong is noticed. Use the most formal one that fits."
        />
      </Card>

      <Card title="The letter itself">
        <TextArea
          label="Subject"
          value={draft.subject}
          onChange={(v) => set('subject', v)}
          help="Printed in capitals and underlined, as an official letter has it."
        />
        <TextArea
          label="Body"
          value={draft.body}
          onChange={(v) => set('body', v)}
          help="Leave a blank line between paragraphs."
          rows={16}
        />
        <SelectField
          label="Closing"
          value={draft.closing}
          onChange={(v) => set('closing', v)}
          options={CLOSINGS.map((c) => ({ value: c, label: c }))}
        />
      </Card>

      <Card title="Who signs it">
        <TextField
          label="Name"
          value={draft.signatoryName}
          onChange={(v) => set('signatoryName', v)}
        />
        <TextField
          label="Title"
          value={draft.signatoryTitle}
          onChange={(v) => set('signatoryTitle', v)}
          help="For example: Project Director, or Medical Director."
        />
      </Card>

      <Card title="Enclosures and copies">
        <TextArea
          label="Enclosures"
          value={draft.enclosures}
          onChange={(v) => set('enclosures', v)}
          help="One per line. Numbered on the letter."
        />
        <TextArea
          label="Copies to"
          value={draft.copies}
          onChange={(v) => set('copies', v)}
          help="One per line."
        />
        <SelectField
          label="Status"
          value={draft.status}
          onChange={(v) => set('status', v as Draft['status'])}
          options={[
            { value: 'DRAFT', label: 'Draft — still being worked on' },
            { value: 'FINAL', label: 'Final — ready to print and sign' },
            { value: 'SENT', label: 'Sent' },
          ]}
          help="A draft is stamped DRAFT across the page so it cannot be delivered by mistake."
        />
      </Card>

      <button className="btn block large" onClick={() => void download()} disabled={busy}>
        {busy ? 'Working…' : 'Download as PDF'}
      </button>

      {mayWrite ? (
        <>
          <div style={{ height: 10 }} />
          <button
            className="btn block secondary"
            onClick={async () => {
              if (await save()) onDone()
            }}
            disabled={busy}
          >
            Save and close
          </button>
        </>
      ) : null}

      {existingId && mayWrite && draft.status !== 'SENT' ? (
        <>
          <div style={{ height: 10 }} />
          <button className="btn block secondary" onClick={() => setSending(true)} disabled={busy}>
            Record that it was delivered
          </button>
        </>
      ) : null}

      <div style={{ height: 10 }} />
      <button className="btn block ghost" onClick={onCancel} disabled={busy}>
        Back to letters
      </button>

      {existingId && mayWrite ? (
        <>
          <div style={{ height: 16 }} />
          <button className="btn block danger" onClick={() => setDeleting(true)} disabled={busy}>
            Remove this letter
          </button>
        </>
      ) : null}

      {sending && existingId ? (
        <Modal title="Record delivery" onClose={() => setSending(false)}>
          <p style={{ marginTop: 0 }}>
            Recording who delivered it, and when, is what settles the question later of whether the
            letter was actually received.
          </p>
          <TextField
            label="Delivered by, and how"
            value={deliveredBy}
            onChange={setDeliveredBy}
            help="For example: by hand, through the Permanent Secretary's office."
          />
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setSending(false)}>
              Cancel
            </button>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await markSent(existingId, deliveredBy)
                  toast('ok', 'Recorded as delivered.')
                  setSending(false)
                  onDone()
                } catch (err) {
                  toast('danger', friendlyError(err, 'That could not be recorded.'))
                }
              }}
            >
              Record it
            </button>
          </div>
        </Modal>
      ) : null}

      {deleting && existingId ? (
        <ConfirmDialog
          title="Remove this letter?"
          message="It is removed from the list. The audit trail keeps the record that it existed and who removed it."
          destructive
          confirmLabel="Remove"
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            try {
              await deleteLetter(existingId, 'Removed by the writer')
              toast('ok', 'Letter removed.')
              onDone()
            } catch (err) {
              toast('danger', friendlyError(err, 'It could not be removed.'))
            } finally {
              setDeleting(false)
            }
          }}
        />
      ) : null}
    </>
  )
}
