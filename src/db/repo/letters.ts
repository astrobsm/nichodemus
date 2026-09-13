/**
 * Official correspondence, kept.
 *
 * An outreach is answerable for its letters. Somebody will eventually ask
 * what was written to the Ministry, on what date, and who signed it — at a
 * review, in a dispute, or simply when writing next year's letters. So a
 * letter is a record like any other: audited, soft-deleted, and carried
 * between devices by synchronisation.
 *
 * The text is stored as written rather than as a reference to a template.
 * Templates change between versions of this application, and a letter already
 * delivered to a Commissioner must never quietly start saying something else.
 */
import { query, queryOne, transaction } from '../sqlite'
import {
  currentVersion,
  findAll,
  insertEnvelope,
  insertRow,
  nullIfBlank,
  softDelete,
  updateEnvelope,
  updateRow,
} from './base'
import { audit, AUDIT_ACTIONS } from '../../core/audit'
import { nowIso } from '../../core/datetime'

export type LetterStatus = 'DRAFT' | 'FINAL' | 'SENT'

export interface Letter {
  id: number
  uuid: string
  project_id: number
  template_key: string | null
  reference: string | null
  letter_date: string | null
  recipient_name: string | null
  recipient_title: string | null
  recipient_organisation: string | null
  recipient_address: string | null
  salutation: string | null
  subject: string | null
  body: string
  closing: string | null
  signatory_name: string | null
  signatory_title: string | null
  /** Newline-separated, because a list in a column is still a list. */
  enclosures: string | null
  copies: string | null
  status: LetterStatus
  sent_at: string | null
  delivered_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface LetterInput {
  projectId: number
  templateKey?: string | null
  reference?: string
  letterDate?: string
  recipientName?: string
  recipientTitle?: string
  recipientOrganisation?: string
  recipientAddress?: string
  salutation?: string
  subject?: string
  /** Paragraphs. Joined with a blank line, which is how they are read back. */
  body: string[]
  closing?: string
  signatoryName?: string
  signatoryTitle?: string
  enclosures?: string[]
  copies?: string[]
  status?: LetterStatus
  notes?: string
}

const SEPARATOR = '\n\n'

export function splitBody(body: string | null | undefined): string[] {
  if (!body) return []
  return body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

export function joinBody(paragraphs: string[]): string {
  return paragraphs.map((p) => p.trim()).filter(Boolean).join(SEPARATOR)
}

export function splitList(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split('\n').map((l) => l.trim()).filter(Boolean)
}

export function lettersFor(projectId: number): Letter[] {
  return findAll<Letter>('letters', 'project_id = ?', [projectId], 'letter_date DESC, id DESC')
}

export function getLetter(id: number): Letter | null {
  return queryOne<Letter>('SELECT * FROM letters WHERE id = ? AND deleted_at IS NULL', [id])
}

/**
 * The next number in this year's sequence.
 *
 * Counts what this project has already produced this year rather than the
 * highest number seen, so two devices writing letters offline do not both
 * claim the same reference; the administrator can correct it before sending
 * if it matters, and the field is editable for exactly that reason.
 */
export function nextSequence(projectId: number): number {
  const year = String(new Date().getFullYear())
  const rows = query<{ reference: string | null }>(
    'SELECT reference FROM letters WHERE project_id = ? AND deleted_at IS NULL',
    [projectId],
  )
  const used = rows
    .map((r) => r.reference ?? '')
    .filter((ref) => ref.includes(`/${year}/`))
    .map((ref) => Number(ref.split('/').pop()))
    .filter((n) => Number.isFinite(n))
  return (used.length ? Math.max(...used) : 0) + 1
}

function columns(input: LetterInput): Record<string, string | number | null> {
  return {
    project_id: input.projectId,
    template_key: nullIfBlank(input.templateKey ?? undefined),
    reference: nullIfBlank(input.reference),
    letter_date: nullIfBlank(input.letterDate),
    recipient_name: nullIfBlank(input.recipientName),
    recipient_title: nullIfBlank(input.recipientTitle),
    recipient_organisation: nullIfBlank(input.recipientOrganisation),
    recipient_address: nullIfBlank(input.recipientAddress),
    salutation: nullIfBlank(input.salutation),
    subject: nullIfBlank(input.subject),
    body: joinBody(input.body),
    closing: nullIfBlank(input.closing),
    signatory_name: nullIfBlank(input.signatoryName),
    signatory_title: nullIfBlank(input.signatoryTitle),
    enclosures: nullIfBlank((input.enclosures ?? []).join('\n')),
    copies: nullIfBlank((input.copies ?? []).join('\n')),
    status: input.status ?? 'DRAFT',
    notes: nullIfBlank(input.notes),
  }
}

export async function saveLetter(input: LetterInput): Promise<number> {
  return transaction(() => {
    const id = insertRow('letters', { ...insertEnvelope(), ...columns(input) })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'letter',
      entityId: id,
      summary: `Letter drafted: ${input.subject ?? 'untitled'}${
        input.recipientName ? ` — to ${input.recipientName}` : ''
      }`,
    })
    return id
  })
}

export async function updateLetter(id: number, input: LetterInput): Promise<void> {
  const before = getLetter(id)
  await transaction(() => {
    updateRow('letters', id, {
      ...updateEnvelope(currentVersion('letters', id)),
      ...columns(input),
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'letter',
      entityId: id,
      summary: `Letter edited: ${input.subject ?? before?.subject ?? 'untitled'}`,
    })
  })
}

/**
 * Records that a letter was actually delivered.
 *
 * Worth capturing separately from the draft: "we wrote to the Ministry" and
 * "the Ministry received it on the 14th, by hand, through the Permanent
 * Secretary's office" are different claims, and only the second one settles
 * an argument.
 */
export async function markSent(id: number, deliveredBy: string, when?: string): Promise<void> {
  const at = when ?? nowIso()
  await transaction(() => {
    updateRow('letters', id, {
      ...updateEnvelope(currentVersion('letters', id)),
      status: 'SENT',
      sent_at: at,
      delivered_by: nullIfBlank(deliveredBy),
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'letter',
      entityId: id,
      summary: `Letter marked as sent${deliveredBy ? ` — delivered by ${deliveredBy}` : ''}`,
    })
  })
}

export async function deleteLetter(id: number, reason: string): Promise<void> {
  const before = getLetter(id)
  await transaction(() => {
    softDelete('letters', id)
    audit({
      action: AUDIT_ACTIONS.DELETE,
      entityType: 'letter',
      entityId: id,
      summary: `Letter removed: ${before?.subject ?? 'untitled'}. Reason: ${reason}`,
    })
  })
}

export function letterStats(projectId: number): { drafts: number; final: number; sent: number } {
  const rows = query<{ status: string; n: number }>(
    `SELECT status, COUNT(*) AS n FROM letters
      WHERE project_id = ? AND deleted_at IS NULL GROUP BY status`,
    [projectId],
  )
  const of = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0)
  return { drafts: of('DRAFT'), final: of('FINAL'), sent: of('SENT') }
}
