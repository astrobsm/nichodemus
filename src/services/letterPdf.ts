/**
 * The official letterhead, and the letter printed on it.
 *
 * A letter to a Commissioner or to a palace is judged partly on how it looks
 * before a word of it is read. So this is not a report with a heading: it is
 * laid out as correspondence, with the proportions people expect — a deep
 * letterhead with the seal, a rule beneath it, the reference and date in
 * their places, the recipient block at the left, and the signature block left
 * with enough room to actually sign in.
 *
 * A letter is also a single document that must not fragment awkwardly. The
 * signature block is never orphaned onto a page of its own, and continuation
 * pages carry a short header so a page separated from the others can still be
 * identified.
 *
 * Everything is generated on the device, offline, like every other document
 * this application produces.
 */
import jsPDF from 'jspdf'
import { loadBrand } from './pdfReport'
import { saveFile } from './fileIo'
import { formatLongDate, filenameStamp } from '../core/datetime'
import type { Project } from '../db/repo/projects'

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const MARGIN = 20
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
/** Where the body must stop, leaving room for the footer rule. */
const BOTTOM = 268

/** Deep blue-green of the outreach seal, used for the letterhead only. */
const HOUSE = { r: 15, g: 58, b: 90 }

export interface LetterContent {
  reference: string
  date: string
  recipientName: string
  recipientTitle: string
  recipientOrganisation: string
  recipientAddress: string
  salutation: string
  subject: string
  body: string[]
  closing: string
  signatoryName: string
  signatoryTitle: string
  enclosures: string[]
  copies: string[]
  /** Drawn as a faint DRAFT across the page until the letter is final. */
  draft?: boolean
}

interface Ctx {
  doc: jsPDF
  y: number
  project: Project
  seal: string | null
}

/**
 * The letterhead.
 *
 * Drawn on the first page only — repeating it on continuation pages is the
 * mark of a document produced by somebody who has not written many letters.
 */
function letterhead(ctx: Ctx): void {
  const { doc, project } = ctx
  const top = 14
  const sealSize = 26

  if (ctx.seal) {
    doc.addImage(ctx.seal, 'PNG', MARGIN, top, sealSize, sealSize, 'nug-letter-seal', 'FAST')
  }

  const textLeft = ctx.seal ? MARGIN + sealSize + 6 : MARGIN
  const textWidth = PAGE_WIDTH - MARGIN - textLeft

  doc.setTextColor(HOUSE.r, HOUSE.g, HOUSE.b)
  doc.setFont('times', 'bold')
  doc.setFontSize(15)
  const nameLines = doc.splitTextToSize(project.name.toUpperCase(), textWidth) as string[]
  let y = top + 6
  for (const line of nameLines) {
    doc.text(line, textLeft, y)
    y += 6
  }

  if (project.memorial_honouree) {
    doc.setFont('times', 'italic')
    doc.setFontSize(9.5)
    doc.setTextColor(90, 90, 90)
    doc.text(`In loving memory of ${project.memorial_honouree}`, textLeft, y)
    y += 5
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(70, 70, 70)
  const where = [project.location, project.lga ? `${project.lga} LGA` : null, project.state]
    .filter(Boolean)
    .join(' · ')
  if (where) {
    doc.text(where, textLeft, y)
    y += 4.5
  }

  const rule = Math.max(y + 1, top + sealSize + 3)
  doc.setDrawColor(HOUSE.r, HOUSE.g, HOUSE.b)
  doc.setLineWidth(1.1)
  doc.line(MARGIN, rule, PAGE_WIDTH - MARGIN, rule)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, rule + 1.6, PAGE_WIDTH - MARGIN, rule + 1.6)

  ctx.y = rule + 12
}

/** A short identifying strip on pages after the first. */
function continuationHeader(ctx: Ctx, reference: string): void {
  const { doc } = ctx
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(140, 140, 140)
  doc.text(reference, MARGIN, 14)
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, 16.5, PAGE_WIDTH - MARGIN, 16.5)
  ctx.y = 26
}

function newPage(ctx: Ctx, reference: string): void {
  ctx.doc.addPage()
  continuationHeader(ctx, reference)
}

function ensure(ctx: Ctx, needed: number, reference: string): void {
  if (ctx.y + needed > BOTTOM) newPage(ctx, reference)
}

export async function renderLetter(
  project: Project,
  letter: LetterContent,
): Promise<{ doc: jsPDF; filename: string }> {
  const brand = await loadBrand()
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const ctx: Ctx = { doc, y: 0, project, seal: brand.seal }
  const ref = letter.reference || 'Letter'

  letterhead(ctx)

  // --- reference and date, on one line, as correspondence has them ----
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(40, 40, 40)
  if (letter.reference) doc.text(`Ref: ${letter.reference}`, MARGIN, ctx.y)
  doc.text(letter.date, PAGE_WIDTH - MARGIN, ctx.y, { align: 'right' })
  ctx.y += 12

  // --- the recipient ---------------------------------------------------
  doc.setFontSize(10.5)
  doc.setTextColor(20, 20, 20)
  const recipient = [
    letter.recipientTitle,
    letter.recipientName,
    letter.recipientOrganisation,
    ...letter.recipientAddress.split('\n'),
  ]
    .map((l) => (l ?? '').trim())
    .filter(Boolean)
  for (const line of recipient) {
    ensure(ctx, 6, ref)
    doc.text(line, MARGIN, ctx.y)
    ctx.y += 5.2
  }
  ctx.y += 8

  // --- salutation ------------------------------------------------------
  ensure(ctx, 12, ref)
  doc.text(`${letter.salutation},`, MARGIN, ctx.y)
  ctx.y += 9

  // --- subject, underlined, as an official letter has it ----------------
  if (letter.subject.trim()) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    const subjectLines = doc.splitTextToSize(letter.subject.toUpperCase(), CONTENT_WIDTH) as string[]
    ensure(ctx, subjectLines.length * 5.4 + 6, ref)
    for (const line of subjectLines) {
      doc.text(line, MARGIN, ctx.y)
      // Underlining the subject is the convention, and it is what makes a
      // letter scannable on a desk covered in other letters.
      const width = doc.getTextWidth(line)
      doc.setDrawColor(20, 20, 20)
      doc.setLineWidth(0.3)
      doc.line(MARGIN, ctx.y + 1.2, MARGIN + width, ctx.y + 1.2)
      ctx.y += 5.6
    }
    ctx.y += 6
  }

  // --- the body --------------------------------------------------------
  doc.setFont('times', 'normal')
  doc.setFontSize(11.5)
  doc.setTextColor(20, 20, 20)
  for (const paragraph of letter.body) {
    if (!paragraph.trim()) continue
    const lines = doc.splitTextToSize(paragraph.trim(), CONTENT_WIDTH) as string[]
    for (const line of lines) {
      ensure(ctx, 6, ref)
      doc.text(line, MARGIN, ctx.y)
      ctx.y += 5.6
    }
    ctx.y += 4.5
  }

  // --- the signature block, which is never orphaned --------------------
  // A closing and a name alone on a fresh page look like an afterthought,
  // and on an official letter they raise the question of what was on the
  // page before. 46mm keeps the close, the space to sign, and the name
  // together with at least something of the body.
  ensure(ctx, 46, ref)
  ctx.y += 4
  doc.setFont('times', 'normal')
  doc.setFontSize(11.5)
  doc.text(letter.closing, MARGIN, ctx.y)

  // Room to actually sign, then a rule to sign above.
  ctx.y += 22
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, ctx.y, MARGIN + 62, ctx.y)
  ctx.y += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.text(letter.signatoryName || '[name]', MARGIN, ctx.y)
  ctx.y += 5
  if (letter.signatoryTitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(70, 70, 70)
    doc.text(letter.signatoryTitle, MARGIN, ctx.y)
    ctx.y += 5
  }

  // --- enclosures and copies -------------------------------------------
  const enclosures = letter.enclosures.filter((e) => e.trim())
  if (enclosures.length > 0) {
    ctx.y += 6
    ensure(ctx, 8 + enclosures.length * 5, ref)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(20, 20, 20)
    doc.text(enclosures.length === 1 ? 'Enclosure:' : 'Enclosures:', MARGIN, ctx.y)
    ctx.y += 5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(50, 50, 50)
    enclosures.forEach((item, i) => {
      doc.text(`${i + 1}.  ${item.trim()}`, MARGIN + 2, ctx.y)
      ctx.y += 4.8
    })
  }

  const copies = letter.copies.filter((c) => c.trim())
  if (copies.length > 0) {
    ctx.y += 6
    ensure(ctx, 8 + copies.length * 5, ref)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(20, 20, 20)
    doc.text('Copies to:', MARGIN, ctx.y)
    ctx.y += 5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(50, 50, 50)
    for (const item of copies) {
      doc.text(`·  ${item.trim()}`, MARGIN + 2, ctx.y)
      ctx.y += 4.8
    }
  }

  decorate(doc, letter)

  const filename = `letter-${slug(letter.subject || ref)}-${filenameStamp()}.pdf`
  return { doc, filename }
}

/** DRAFT marking and page numbers, applied once the page count is known. */
function decorate(doc: jsPDF, letter: LetterContent): void {
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)

    if (letter.draft) {
      // Unmistakable, so a draft cannot be delivered by mistake, but faint
      // enough that the letter can still be read and checked.
      const gs = doc as unknown as {
        GState: (o: { opacity: number }) => unknown
        setGState: (g: unknown) => void
      }
      try {
        gs.setGState(gs.GState({ opacity: 0.1 }))
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(90)
        doc.setTextColor(0, 0, 0)
        doc.text('DRAFT', PAGE_WIDTH / 2, PAGE_HEIGHT / 2, {
          align: 'center',
          angle: 38,
        })
        gs.setGState(gs.GState({ opacity: 1 }))
      } catch {
        /* older renderer with no graphics state */
      }
    }

    if (pages > 1) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(140, 140, 140)
      doc.text(`Page ${i} of ${pages}`, PAGE_WIDTH - MARGIN, 285, { align: 'right' })
    }
  }
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'letter'
  )
}

/** Builds the letter and writes it to device storage. */
export async function saveLetterPdf(
  project: Project,
  letter: LetterContent,
): Promise<{ filename: string; sizeBytes: number; location?: string }> {
  const { doc, filename } = await renderLetter(project, letter)
  const bytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
  const outcome = await saveFile(bytes, filename, 'application/pdf', 'Official letter', {
    share: true,
  })
  if (!outcome.ok) {
    if (outcome.cancelled) throw new Error('Saving was cancelled. No file was written.')
    throw new Error(`The letter could not be saved: ${outcome.error}`)
  }
  return { filename: outcome.name, sizeBytes: bytes.byteLength, location: outcome.location }
}

/** A reference number in the form offices expect. */
export function nextReference(project: Project, sequence: number): string {
  const prefix = (project.participant_prefix || 'NUG').toUpperCase()
  const year = new Date().getFullYear()
  return `${prefix}/${year}/${String(sequence).padStart(3, '0')}`
}

/** Today, written the way a letter writes it. */
export function letterDate(iso?: string): string {
  return formatLongDate(iso ?? new Date().toISOString())
}
