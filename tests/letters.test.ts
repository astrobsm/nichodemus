/**
 * Official correspondence.
 *
 * The failure that matters here is not a crash. It is a letter going to a
 * Commissioner or to a palace with "[date]" still in it, or addressed "Dear
 * ,", or recorded as saying something other than what was actually sent.
 * Those are embarrassing in a way that costs an outreach its standing, so
 * they are what these tests are about.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDatabase, teardown, type Fixture } from './helpers'
import {
  LETTER_TEMPLATES,
  fillPlaceholders,
  missingPlaceholders,
  CATEGORY_LABELS,
} from '../src/core/letterTemplates'
import {
  deleteLetter,
  getLetter,
  lettersFor,
  letterStats,
  markSent,
  nextSequence,
  saveLetter,
  splitBody,
  splitList,
  updateLetter,
} from '../src/db/repo/letters'
import { nextReference } from '../src/services/letterPdf'
import { auditForEntity } from '../src/core/audit'

let fx: Fixture

beforeEach(async () => {
  fx = await freshDatabase()
})

afterAll(teardown)

const values = {
  location: 'Umuhu village, Owelli Court',
  lga: 'Awgu',
  state: 'Enugu',
  date: '29 December 2026',
  expected: '500',
  honouree: 'Nichodemus Ugbor',
  medical_director: 'Dr A. Eze',
  project_director: 'E. Ugbor',
  start_time: '08:00',
  end_time: '16:00',
  project_name: 'NUG Outreach',
}

async function draft(overrides: Record<string, unknown> = {}) {
  return saveLetter({
    projectId: fx.project.id,
    reference: 'NUG/2026/001',
    letterDate: '29 December 2026',
    recipientTitle: 'The Honourable Commissioner for Health',
    recipientName: 'Dr A. Onyeka',
    recipientOrganisation: 'Ministry of Health, Enugu State',
    recipientAddress: 'Enugu\nEnugu State',
    salutation: 'Honourable Commissioner',
    subject: 'Notification of a Free Health Outreach',
    body: ['First paragraph.', 'Second paragraph.'],
    closing: 'Yours faithfully,',
    signatoryName: 'E. Ugbor',
    signatoryTitle: 'Project Director',
    enclosures: ['Programme'],
    copies: ['The Permanent Secretary'],
    ...overrides,
  })
}

describe('the templates themselves', () => {
  it('covers everyone an outreach of this kind must write to', () => {
    const audiences = LETTER_TEMPLATES.map((t) => `${t.key} ${t.audience} ${t.name}`).join(' ')
    for (const who of [/traditional ruler|Igwe/i, /Commissioner/i, /Local Government/i, /police/i, /hospital/i]) {
      expect(audiences).toMatch(who)
    }
  })

  it('gives every template a subject, a body and a close', () => {
    for (const t of LETTER_TEMPLATES) {
      expect(t.subject.trim().length, t.key).toBeGreaterThan(10)
      expect(t.body.length, t.key).toBeGreaterThan(1)
      expect(t.body.every((p) => p.trim().length > 0), t.key).toBe(true)
      expect(t.closing.trim().endsWith(','), t.key).toBe(true)
      expect(CATEGORY_LABELS[t.category], t.key).toBeTruthy()
    }
  })

  it('uses no placeholder the application cannot fill', () => {
    // A placeholder nobody fills becomes "[village_head]" in a letter to a
    // Commissioner, which is exactly the failure this guards.
    const known = new Set(Object.keys(values))
    for (const t of LETTER_TEMPLATES) {
      const text = [t.subject, ...t.body, ...(t.enclosures ?? []), ...(t.copies ?? [])].join(' ')
      for (const [, key] of text.matchAll(/\{\{(\w+)\}\}/g)) {
        expect(known.has(key), `${t.key} uses {{${key}}}, which nothing provides`).toBe(true)
      }
    }
  })

  it('addresses a traditional ruler as a traditional ruler', () => {
    const palace = LETTER_TEMPLATES.find((t) => t.key === 'TRADITIONAL_RULER')!
    expect(palace.suggestedSalutation).toBe('Your Royal Highness')
    expect(palace.closing).toMatch(/respectfully/i)
  })

  it('does not promise diagnoses in the letter to the Ministry', () => {
    // The whole application distinguishes screening from diagnosis; a letter
    // that blurs it in writing to the Ministry would undo that.
    const ministry = LETTER_TEMPLATES.find((t) => t.key === 'COMMISSIONER_HEALTH')!
    const text = ministry.body.join(' ')
    expect(text).toMatch(/screening/i)
    expect(text).toMatch(/does not purport to establish diagnoses/i)
  })
})

describe('filling in the blanks', () => {
  it('puts the project details into the letter', () => {
    const filled = fillPlaceholders('Outreach at {{location}} on {{date}} for {{expected}} people.', values)
    expect(filled).toBe('Outreach at Umuhu village, Owelli Court on 29 December 2026 for 500 people.')
  })

  it('leaves a visible marker rather than a blank when something is unknown', () => {
    const filled = fillPlaceholders('Held on {{date}} at {{location}}.', { location: 'Umuhu' })
    expect(filled).toBe('Held on [date] at Umuhu.')
    // "Held on  at Umuhu." would get sent. "[date]" does not.
    expect(filled).not.toMatch(/on\s{2,}at/)
  })

  it('treats an empty value as unknown', () => {
    expect(fillPlaceholders('To {{lga}} LGA', { lga: '   ' })).toBe('To [lga] LGA')
  })

  it('reports what is still missing so the writer is warned', () => {
    const text = fillPlaceholders('{{location}} on {{date}}, led by {{medical_director}}', {
      location: 'Umuhu',
    })
    expect(missingPlaceholders(text).sort()).toEqual(['date', 'medical director'])
  })

  it('finds nothing missing once everything is supplied', () => {
    const template = LETTER_TEMPLATES.find((t) => t.key === 'COMMISSIONER_HEALTH')!
    const text = template.body.map((p) => fillPlaceholders(p, values)).join(' ')
    expect(missingPlaceholders(text)).toEqual([])
  })
})

describe('keeping a letter', () => {
  it('stores every segment and reads them all back', async () => {
    const id = await draft()
    const saved = getLetter(id)!
    expect(saved.reference).toBe('NUG/2026/001')
    expect(saved.recipient_title).toBe('The Honourable Commissioner for Health')
    expect(saved.salutation).toBe('Honourable Commissioner')
    expect(splitBody(saved.body)).toEqual(['First paragraph.', 'Second paragraph.'])
    expect(splitList(saved.enclosures)).toEqual(['Programme'])
    expect(splitList(saved.copies)).toEqual(['The Permanent Secretary'])
    expect(saved.status).toBe('DRAFT')
  })

  it('stores the text as written, not a reference to a template', async () => {
    // A template that changes in a later version must not change what a
    // letter already delivered is recorded as saying.
    const id = await draft({ templateKey: 'COMMISSIONER_HEALTH', body: ['As actually sent.'] })
    expect(getLetter(id)!.body).toBe('As actually sent.')
  })

  it('records who wrote it and what it was about', async () => {
    const id = await draft()
    const entries = auditForEntity('letter', id)
    expect(entries.some((e) => /Letter drafted/.test(e.summary ?? ''))).toBe(true)
    expect(entries[0].summary).toMatch(/Dr A. Onyeka/)
  })

  it('keeps an edit in the audit trail', async () => {
    const id = await draft()
    await updateLetter(id, {
      projectId: fx.project.id,
      subject: 'Revised subject',
      body: ['Changed.'],
    })
    expect(getLetter(id)!.subject).toBe('Revised subject')
    expect(auditForEntity('letter', id).some((e) => /edited/i.test(e.summary ?? ''))).toBe(true)
  })
})

describe('reference numbers', () => {
  it('reads as an office file number', () => {
    const ref = nextReference(fx.project, 7)
    expect(ref).toMatch(/^[A-Z]+\/\d{4}\/007$/)
  })

  it('counts on from the letters already written this year', async () => {
    expect(nextSequence(fx.project.id)).toBe(1)
    await draft({ reference: 'NUG/2026/001' })
    await draft({ reference: 'NUG/2026/004' })
    expect(nextSequence(fx.project.id)).toBe(5)
  })

  it('ignores numbers from a different year', async () => {
    await draft({ reference: 'NUG/2019/044' })
    expect(nextSequence(fx.project.id)).toBe(1)
  })
})

describe('delivery', () => {
  it('records how and when it actually reached them', async () => {
    const id = await draft()
    await markSent(id, 'By hand, through the Permanent Secretary’s office')
    const sent = getLetter(id)!
    expect(sent.status).toBe('SENT')
    expect(sent.sent_at).toBeTruthy()
    expect(sent.delivered_by).toMatch(/Permanent Secretary/)
  })

  it('counts what is drafted against what has gone', async () => {
    const a = await draft()
    await draft()
    await markSent(a, 'By hand')
    expect(letterStats(fx.project.id)).toEqual({ drafts: 1, final: 0, sent: 1 })
  })
})

describe('removing one', () => {
  it('takes it off the list but keeps the record that it existed', async () => {
    const id = await draft()
    await deleteLetter(id, 'Written in error')
    expect(lettersFor(fx.project.id)).toHaveLength(0)
    expect(getLetter(id)).toBeNull()
    const entries = auditForEntity('letter', id)
    expect(entries.some((e) => /Written in error/.test(e.summary ?? ''))).toBe(true)
  })
})
