/**
 * On-device PDF report generation (spec S44, S45, S80).
 *
 * Reports are rendered locally with jsPDF - no rendering service, no network.
 * Executive and statistical reports never contain patient identifiers unless
 * the operator holds reports.identifiable AND explicitly asks for them.
 *
 * Report language always separates a SCREENING FINDING from a DIAGNOSIS.
 */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { transaction } from '../db/sqlite'
import { audit, AUDIT_ACTIONS, auditActor } from '../core/audit'
import { formatLongDate, formatDateTime, nowIso, filenameStamp, today } from '../core/datetime'
import { APP_SHORT_NAME, APP_VERSION, labelFor } from '../core/constants'
import { saveFile } from './fileIo'
import type { Project } from '../db/repo/projects'
import { checklistProgress } from '../db/repo/projects'
import {
  demographics,
  reachStats,
  screeningStats,
  dataQuality,
  referralRate,
  percent,
  topReferralReasons,
  facilityBreakdown,
} from '../db/repo/analytics'
import { referralStats, followupStats, listReferrals, listFollowups } from '../db/repo/referrals'
import {
  inventoryReconciliation,
  procurementTotals,
  listProcurement,
  inventoryValuation,
} from '../db/repo/inventory'
import { budgetSummary, formatMoney } from '../db/repo/finance'
import { listTeam, taskStats, mobilisationReach, listMobilisation } from '../db/repo/planning'

export type ReportKey =
  | 'EXECUTIVE'
  | 'CLINICAL_SUMMARY'
  | 'PARTICIPANT_STATISTICS'
  | 'BP_SCREENING'
  | 'GLUCOSE_SCREENING'
  | 'BREAST_HEALTH'
  | 'WOUND_CARE'
  | 'REFERRAL'
  | 'FOLLOWUP'
  | 'INVENTORY'
  | 'PROCUREMENT'
  | 'FINANCIAL'
  | 'TEAM'
  | 'DATA_QUALITY'
  | 'COMPLETE'

export interface ReportDefinition {
  key: ReportKey
  title: string
  description: string
  containsIdentifiers: boolean
}

export const REPORTS: ReportDefinition[] = [
  {
    key: 'EXECUTIVE',
    title: 'Executive report',
    description: 'Headline reach, findings, referrals, cost and recommendations.',
    containsIdentifiers: false,
  },
  {
    key: 'CLINICAL_SUMMARY',
    title: 'Clinical summary',
    description: 'All screening and clinical activity in aggregate.',
    containsIdentifiers: false,
  },
  {
    key: 'PARTICIPANT_STATISTICS',
    title: 'Participant statistics',
    description: 'Attendance, sex and age distribution, communities reached.',
    containsIdentifiers: false,
  },
  {
    key: 'BP_SCREENING',
    title: 'Blood pressure screening report',
    description: 'Blood pressure screening activity and elevated findings.',
    containsIdentifiers: false,
  },
  {
    key: 'GLUCOSE_SCREENING',
    title: 'Glucose screening report',
    description: 'Capillary glucose screening activity and abnormal findings.',
    containsIdentifiers: false,
  },
  {
    key: 'BREAST_HEALTH',
    title: 'Breast health report',
    description: 'Breast examinations, findings and referrals.',
    containsIdentifiers: false,
  },
  {
    key: 'WOUND_CARE',
    title: 'Wound care report',
    description: 'Wounds assessed, dressings applied and referrals.',
    containsIdentifiers: false,
  },
  {
    key: 'REFERRAL',
    title: 'Referral report',
    description: 'Referrals by urgency, destination and status.',
    containsIdentifiers: true,
  },
  {
    key: 'FOLLOWUP',
    title: 'Follow-up report',
    description: 'Follow-up queue and contact outcomes.',
    containsIdentifiers: true,
  },
  {
    key: 'INVENTORY',
    title: 'Inventory report',
    description: 'Stock reconciliation, low stock and expiry.',
    containsIdentifiers: false,
  },
  {
    key: 'PROCUREMENT',
    title: 'Procurement report',
    description: 'Procurement requests, delivery and payment status.',
    containsIdentifiers: false,
  },
  {
    key: 'FINANCIAL',
    title: 'Financial report',
    description: 'Budget against expenditure by category.',
    containsIdentifiers: false,
  },
  {
    key: 'TEAM',
    title: 'Staff and volunteer report',
    description: 'Team roster and planning task progress.',
    containsIdentifiers: false,
  },
  {
    key: 'DATA_QUALITY',
    title: 'Data quality report',
    description: 'Completeness checks to run before the final report.',
    containsIdentifiers: false,
  },
  {
    key: 'COMPLETE',
    title: 'Complete outreach report',
    description: 'Every section above in one document.',
    containsIdentifiers: false,
  },
]

const MARGIN = 14
const PAGE_WIDTH = 210
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

interface Brand {
  /** Pale seal stamped behind every page. */
  watermark: string | null
  /** Full-strength seal for the cover. */
  seal: string | null
}

interface Ctx {
  doc: jsPDF
  y: number
  project: Project
  includeIdentifiers: boolean
  brand: Brand
}

/**
 * Loads the outreach seal for stamping into the document. Both images are
 * served from our own origin and cached by the service worker, so this works
 * with no connection. A failure to load is not fatal: the report is still
 * produced, just without the seal.
 */
export async function loadBrand(): Promise<Brand> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
  async function dataUrl(path: string, mime = 'image/png'): Promise<string | null> {
    try {
      const res = await fetch(`${base}/${path}`)
      if (!res.ok) return null
      const buffer = new Uint8Array(await res.arrayBuffer())
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < buffer.length; i += CHUNK) {
        binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK))
      }
      return `data:${mime};base64,${btoa(binary)}`
    } catch {
      return null
    }
  }
  const [watermark, seal] = await Promise.all([
    dataUrl('icons/watermark.jpg', 'image/jpeg'),
    dataUrl('icons/logo-circle.png'),
  ])
  return { watermark, seal }
}

function ensureSpace(ctx: Ctx, needed: number): void {
  if (ctx.y + needed > 275) {
    ctx.doc.addPage()
    ctx.y = 20
  }
}

function heading(ctx: Ctx, text: string): void {
  ensureSpace(ctx, 16)
  ctx.doc.setFont('helvetica', 'bold')
  ctx.doc.setFontSize(13)
  ctx.doc.setTextColor(17, 60, 90)
  ctx.doc.text(text, MARGIN, ctx.y)
  ctx.doc.setDrawColor(200, 210, 220)
  ctx.doc.line(MARGIN, ctx.y + 1.5, PAGE_WIDTH - MARGIN, ctx.y + 1.5)
  ctx.y += 8
  ctx.doc.setTextColor(30, 30, 30)
}

function paragraph(ctx: Ctx, text: string, size = 10): void {
  ctx.doc.setFont('helvetica', 'normal')
  ctx.doc.setFontSize(size)
  const lines = ctx.doc.splitTextToSize(text, CONTENT_WIDTH) as string[]
  ensureSpace(ctx, lines.length * (size * 0.42) + 4)
  ctx.doc.text(lines, MARGIN, ctx.y)
  ctx.y += lines.length * (size * 0.42) + 4
}

function table(ctx: Ctx, head: string[], body: (string | number)[][]): void {
  if (body.length === 0) {
    paragraph(ctx, 'No records.', 9)
    return
  }
  autoTable(ctx.doc, {
    startY: ctx.y,
    head: [head],
    body: body.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))),
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [17, 60, 90], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [244, 247, 250] },
    theme: 'grid',
  })
  const finalY = (ctx.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  ctx.y = finalY + 7
}

function keyFigures(ctx: Ctx, figures: { label: string; value: string | number }[]): void {
  table(
    ctx,
    ['Measure', 'Value'],
    figures.map((f) => [f.label, String(f.value)]),
  )
}

function coverPage(ctx: Ctx, reportTitle: string): void {
  const { doc, project } = ctx
  doc.setFillColor(17, 60, 90)
  doc.rect(0, 0, PAGE_WIDTH, 62, 'F')

  // The seal sits on the band; the title wraps in the space beside it.
  const sealSize = 40
  const titleWidth = ctx.brand.seal ? CONTENT_WIDTH - sealSize - 6 : CONTENT_WIDTH
  if (ctx.brand.seal) {
    doc.addImage(
      ctx.brand.seal,
      'PNG',
      PAGE_WIDTH - MARGIN - sealSize,
      11,
      sealSize,
      sealSize,
      'nug-seal',
      'FAST',
    )
  }

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(doc.splitTextToSize(project.name, titleWidth) as string[], MARGIN, 22)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  const sub: string[] = []
  if (project.memorial_honouree) sub.push(`In memory of ${project.memorial_honouree}`)
  const place = [project.location, project.lga ? `${project.lga} LGA` : null, project.state ? `${project.state} State` : null]
    .filter(Boolean)
    .join(', ')
  if (place) sub.push(place)
  if (project.proposed_date) sub.push(formatLongDate(project.proposed_date))
  doc.text(doc.splitTextToSize(sub.join('\n'), titleWidth) as string[], MARGIN, 40)

  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(reportTitle, MARGIN, 78)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(90, 90, 90)
  doc.text(
    [
      `Generated ${formatDateTime(nowIso())} by ${auditActor().username} (${labelFor(auditActor().role)})`,
      `Project status: ${labelFor(project.status)}`,
      ctx.includeIdentifiers
        ? 'This document CONTAINS patient identifiers. Handle as confidential health information.'
        : 'This document contains aggregate data only and no patient identifiers.',
    ],
    MARGIN,
    86,
  )
  doc.setTextColor(30, 30, 30)
  ctx.y = 106
}

function clinicalLanguageNote(ctx: Ctx): void {
  ctx.doc.setFillColor(255, 249, 230)
  ctx.doc.setDrawColor(230, 190, 90)
  ensureSpace(ctx, 26)
  ctx.doc.roundedRect(MARGIN, ctx.y - 4, CONTENT_WIDTH, 24, 2, 2, 'FD')
  ctx.doc.setFont('helvetica', 'bold')
  ctx.doc.setFontSize(9)
  ctx.doc.text('How to read these figures', MARGIN + 3, ctx.y + 2)
  ctx.doc.setFont('helvetica', 'normal')
  const lines = ctx.doc.splitTextToSize(
    'All figures below describe SCREENING FINDINGS recorded during a community outreach. ' +
      'They are not clinical diagnoses. Abnormal screening results require confirmatory ' +
      'testing and assessment by a qualified healthcare professional.',
    CONTENT_WIDTH - 6,
  ) as string[]
  ctx.doc.text(lines, MARGIN + 3, ctx.y + 7)
  ctx.y += 26
}

function signOff(ctx: Ctx): void {
  ensureSpace(ctx, 45)
  heading(ctx, 'Sign-off')
  ctx.doc.setFontSize(10)
  ctx.doc.setFont('helvetica', 'normal')
  const rows: [string, string][] = [
    ['Project Director', ctx.project.project_director ?? ''],
    ['Medical Director', ctx.project.medical_director ?? ''],
    ['Report prepared by', auditActor().username],
  ]
  for (const [role, name] of rows) {
    ctx.doc.text(`${role}: ${name}`, MARGIN, ctx.y)
    ctx.doc.setDrawColor(150, 150, 150)
    ctx.doc.line(MARGIN + 95, ctx.y + 1, PAGE_WIDTH - MARGIN, ctx.y + 1)
    ctx.doc.setFontSize(8)
    ctx.doc.setTextColor(120, 120, 120)
    ctx.doc.text('Signature and date', MARGIN + 95, ctx.y + 5)
    ctx.doc.setTextColor(30, 30, 30)
    ctx.doc.setFontSize(10)
    ctx.y += 16
  }
}

function footers(doc: jsPDF, project: Project, brand: Brand): void {
  const pages = doc.getNumberOfPages()
  const WM = 150 // mm across, centred on the page
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)

    // The seal, stamped faintly across each page. It is drawn over the
    // content rather than under it - jsPDF has no z-order - so the opacity
    // is kept low enough that tables and clinical text stay fully legible.
    if (brand.watermark) {
      const gs = doc as unknown as {
        GState: (o: { opacity: number }) => unknown
        setGState: (g: unknown) => void
      }
      try {
        gs.setGState(gs.GState({ opacity: 0.14 }))
        // The alias makes jsPDF embed the image once and reference it from
        // every page. Without it a six-page report carries six copies and
        // grows from roughly 100 KB to several megabytes - which matters a
        // great deal when the report is shared over a rural connection.
        doc.addImage(
          brand.watermark,
          'JPEG',
          (PAGE_WIDTH - WM) / 2,
          (297 - WM) / 2,
          WM,
          WM,
          'nug-watermark',
          'FAST',
        )
        gs.setGState(gs.GState({ opacity: 1 }))
      } catch {
        /* older renderer without graphics state support */
      }
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(130, 130, 130)
    doc.text(
      `${project.name}  ·  ${APP_SHORT()}  ·  generated on this device, offline`,
      MARGIN,
      290,
    )
    doc.text(`Page ${i} of ${pages}`, PAGE_WIDTH - MARGIN, 290, { align: 'right' })
  }
}

function APP_SHORT(): string {
  return `${APP_SHORT_NAME} v${APP_VERSION}`
}

// -------------------------------------------------------------- sections

function sectionReach(ctx: Ctx): void {
  const reach = reachStats(ctx.project.id, ctx.project.expected_participants)
  heading(ctx, 'Reach')
  keyFigures(ctx, [
    { label: 'Expected beneficiaries', value: reach.expected },
    { label: 'Participants registered', value: reach.registered },
    {
      label: 'Participants screened (at least one measurement)',
      value: `${reach.screened} (${percent(reach.screened, reach.registered)}% of registered)`,
    },
    { label: 'Encounters completed', value: reach.completed },
    { label: 'Still in the queue', value: reach.registered - reach.completed },
    {
      label: 'Attendance against expectation',
      value: `${percent(reach.registered, reach.expected || 1)}%`,
    },
  ])
}

function sectionDemographics(ctx: Ctx): void {
  const d = demographics(ctx.project.id)
  heading(ctx, 'Demographics')
  keyFigures(ctx, [
    { label: 'Total participants', value: d.total },
    { label: 'Female', value: `${d.female} (${percent(d.female, d.total)}%)` },
    { label: 'Male', value: `${d.male} (${percent(d.male, d.total)}%)` },
    { label: 'Mean age (years)', value: d.meanAge ?? 'Not available' },
    { label: 'Age not recorded', value: d.ageNotRecorded },
  ])
  table(
    ctx,
    ['Age band', 'Participants', 'Percent of all participants'],
    d.ageBands.map((b) => [b.label, b.count, `${b.percent}%`]),
  )
  if (d.communities.length) {
    table(
      ctx,
      ['Community', 'Participants'],
      d.communities.map((c) => [c.community, c.count]),
    )
  }
}

function sectionBloodPressure(ctx: Ctx): void {
  const s = screeningStats(ctx.project.id)
  heading(ctx, 'Blood pressure screening')
  paragraph(
    ctx,
    `${s.bpElevated} participants had a blood pressure screening measurement at or above the ` +
      `configured alert threshold and were advised to have a clinical assessment. This is a ` +
      `count of screening measurements, not a count of people diagnosed with hypertension.`,
  )
  keyFigures(ctx, [
    { label: 'Participants with a blood pressure measurement', value: s.bpParticipants },
    { label: 'Total readings recorded', value: s.bpReadings },
    { label: 'Participants with a repeat measurement', value: s.bpRepeated },
    {
      label: 'Participants with an elevated screening measurement',
      value: `${s.bpElevated} (${percent(s.bpElevated, s.bpParticipants)}% of those screened)`,
    },
    { label: 'Participants meeting the urgent review threshold', value: s.bpUrgent },
  ])
}

function sectionGlucose(ctx: Ctx): void {
  const s = screeningStats(ctx.project.id)
  heading(ctx, 'Blood glucose screening')
  paragraph(
    ctx,
    `${s.glucoseAbnormal} participants had an abnormal glucose screening result requiring further ` +
      `assessment. Capillary screening results require confirmatory laboratory testing before any ` +
      `diagnosis of diabetes is made.`,
  )
  keyFigures(ctx, [
    { label: 'Participants tested', value: s.glucoseParticipants },
    { label: 'Tests performed', value: s.glucoseTests },
    { label: 'Tests recorded as fasting', value: s.glucoseFasting },
    {
      label: 'Participants with an abnormal screening result',
      value: `${s.glucoseAbnormal} (${percent(s.glucoseAbnormal, s.glucoseParticipants)}% of those tested)`,
    },
    { label: 'Participants meeting the urgent review threshold', value: s.glucoseUrgent },
  ])
}

function sectionBreast(ctx: Ctx): void {
  const s = screeningStats(ctx.project.id)
  heading(ctx, 'Breast health')
  paragraph(
    ctx,
    `${s.breastAbnormal} participants had an abnormal clinical breast examination finding ` +
      `documented and were recommended for further evaluation. No finding recorded here ` +
      `constitutes a diagnosis of breast cancer.`,
  )
  keyFigures(ctx, [
    { label: 'Breast examinations performed', value: s.breastExams },
    { label: 'Participants with an abnormal finding', value: s.breastAbnormal },
    { label: 'Participants with a palpable lump documented', value: s.breastLumps },
    {
      label: 'Abnormal findings as a share of examinations',
      value: `${percent(s.breastAbnormal, s.breastExams)}%`,
    },
  ])
}

function sectionWound(ctx: Ctx): void {
  const s = screeningStats(ctx.project.id)
  heading(ctx, 'Wound care')
  keyFigures(ctx, [
    { label: 'Wound assessments performed', value: s.woundsAssessed },
    { label: 'Participants with a wound assessed', value: s.woundParticipants },
    { label: 'Assessments that raised a clinical review prompt', value: s.woundAlerts },
  ])
  paragraph(
    ctx,
    'Wound surface area figures recorded in this system are approximate values calculated as ' +
      'length multiplied by width.',
    9,
  )
}

function sectionClinical(ctx: Ctx): void {
  const s = screeningStats(ctx.project.id)
  heading(ctx, 'Clinical consultations')
  keyFigures(ctx, [
    { label: 'Participants who received a clinical consultation', value: s.clinicalReviews },
  ])
}

function sectionReferrals(ctx: Ctx): void {
  const stats = referralStats(ctx.project.id)
  heading(ctx, 'Referrals')
  keyFigures(ctx, [
    { label: 'Total referrals issued', value: stats.total },
    { label: 'Urgent or emergency referrals', value: stats.urgent },
    {
      label: 'Referral rate (referred / screened)',
      value: `${referralRate(ctx.project.id, ctx.project.expected_participants)}%`,
    },
  ])
  table(
    ctx,
    ['Urgency', 'Referrals'],
    Object.entries(stats.byUrgency).map(([k, v]) => [labelFor(k), v]),
  )
  table(
    ctx,
    ['Status', 'Referrals'],
    Object.entries(stats.byStatus).map(([k, v]) => [labelFor(k), v]),
  )
  const reasons = topReferralReasons(ctx.project.id)
  if (reasons.length) {
    table(
      ctx,
      ['Most frequent referral reasons', 'Count'],
      reasons.map((r) => [r.reason, r.count]),
    )
  }
  const facilities = facilityBreakdown(ctx.project.id)
  if (facilities.length) {
    table(
      ctx,
      ['Referral destination', 'Referrals'],
      facilities.map((f) => [f.facility, f.count]),
    )
  }

  if (ctx.includeIdentifiers) {
    heading(ctx, 'Referral list (confidential)')
    const list = listReferrals(ctx.project.id)
    table(
      ctx,
      ['Referral', 'Participant', 'Name', 'Reason', 'Urgency', 'Destination', 'Status'],
      list.map((r) => [
        r.referral_code,
        r.participant_code,
        `${r.first_name} ${r.last_name}`,
        r.reason,
        labelFor(r.urgency),
        r.facility_name ?? '',
        labelFor(r.status),
      ]),
    )
  }
}

function sectionFollowup(ctx: Ctx): void {
  const f = followupStats(ctx.project.id)
  heading(ctx, 'Follow-up')
  keyFigures(ctx, [
    { label: 'Follow-up entries', value: f.total },
    { label: 'Pending', value: f.pending },
    { label: 'Contacted', value: f.contacted },
    { label: 'Attended a facility', value: f.attended },
    { label: 'Unreachable', value: f.unreachable },
    { label: 'Completed', value: f.completed },
    { label: 'Overdue', value: f.overdue },
    {
      label: 'Follow-up completion rate',
      value: `${percent(f.completed, f.total)}%`,
    },
  ])
  if (ctx.includeIdentifiers) {
    heading(ctx, 'Follow-up list (confidential)')
    const list = listFollowups(ctx.project.id)
    table(
      ctx,
      ['Participant', 'Name', 'Telephone', 'Reason', 'Due', 'Attempts', 'Outcome'],
      list.map((r) => [
        r.participant_code,
        `${r.first_name} ${r.last_name}`,
        r.phone ?? '',
        r.reason ?? '',
        r.due_date ?? '',
        r.contact_attempts,
        labelFor(r.outcome),
      ]),
    )
  }
}

function sectionInventory(ctx: Ctx): void {
  heading(ctx, 'Inventory reconciliation')
  const rows = inventoryReconciliation(ctx.project.id)
  table(
    ctx,
    ['Item', 'Category', 'Unit', 'Opening', 'Purchased', 'Used', 'Remaining', 'Status', 'Expiry'],
    rows.map((r) => [
      r.item.name,
      r.item.category,
      r.item.unit,
      r.item.opening_qty,
      r.item.qty_purchased,
      r.item.qty_used,
      r.remaining,
      labelFor(r.state),
      r.expiry === 'NOT_APPLICABLE' ? '' : `${r.item.expiry_date ?? ''} (${labelFor(r.expiry)})`,
    ]),
  )
  paragraph(
    ctx,
    `Approximate value of remaining stock: ${formatMoney(inventoryValuation(ctx.project.id), ctx.project.currency)}.`,
    9,
  )
}

function sectionProcurement(ctx: Ctx): void {
  const t = procurementTotals(ctx.project.id)
  heading(ctx, 'Procurement')
  keyFigures(ctx, [
    { label: 'Procurement requests', value: t.requested },
    { label: 'Outstanding requests', value: t.outstanding },
    { label: 'Estimated cost', value: formatMoney(t.estimated, ctx.project.currency) },
    { label: 'Actual cost', value: formatMoney(t.actual, ctx.project.currency) },
  ])
  const rows = listProcurement(ctx.project.id)
  table(
    ctx,
    ['Reference', 'Item', 'Qty', 'Estimated', 'Actual', 'Status', 'Delivery', 'Payment'],
    rows.map((p) => [
      p.code ?? '',
      p.item_name,
      `${p.quantity} ${p.unit ?? ''}`.trim(),
      p.estimated_cost === null ? '' : formatMoney(p.estimated_cost, ctx.project.currency),
      p.actual_cost === null ? '' : formatMoney(p.actual_cost, ctx.project.currency),
      labelFor(p.status),
      labelFor(p.delivery_status),
      labelFor(p.payment_status),
    ]),
  )
}

function sectionFinance(ctx: Ctx): void {
  const { lines, totals } = budgetSummary(ctx.project.id)
  const cur = ctx.project.currency
  heading(ctx, 'Financial summary')
  table(
    ctx,
    ['Category', 'Budget', 'Committed', 'Spent', 'Balance'],
    lines
      .filter((l) => l.budget || l.spent || l.committed)
      .map((l) => [
        l.category,
        formatMoney(l.budget, cur),
        formatMoney(l.committed, cur),
        formatMoney(l.spent, cur),
        formatMoney(l.balance, cur),
      ]),
  )
  keyFigures(ctx, [
    { label: 'Total budget', value: formatMoney(totals.budget, cur) },
    { label: 'Total committed', value: formatMoney(totals.committed, cur) },
    { label: 'Total spent', value: formatMoney(totals.spent, cur) },
    { label: 'Balance', value: formatMoney(totals.balance, cur) },
  ])
}

function sectionTeam(ctx: Ctx): void {
  const team = listTeam(ctx.project.id)
  const tasks = taskStats(ctx.project.id)
  const checklist = checklistProgress(ctx.project.id)
  heading(ctx, 'Team, tasks and preparation')
  keyFigures(ctx, [
    { label: 'Team members', value: team.filter((t) => !t.is_volunteer).length },
    { label: 'Volunteers', value: team.filter((t) => t.is_volunteer).length },
    { label: 'Planning tasks', value: tasks.total },
    { label: 'Tasks completed', value: `${tasks.completed} (${percent(tasks.completed, tasks.total)}%)` },
    { label: 'Tasks overdue', value: tasks.overdue },
    {
      label: 'Event checklist completed',
      value: `${checklist.done} of ${checklist.total}`,
    },
    {
      label: 'Mandatory checklist items completed',
      value: `${checklist.mandatoryDone} of ${checklist.mandatoryTotal}`,
    },
  ])
  table(
    ctx,
    ['Staff code', 'Name', 'Role', 'Organisation', 'Status'],
    team.map((t) => [t.staff_code, t.full_name, t.role ?? '', t.organisation ?? '', labelFor(t.status)]),
  )
}

function sectionMobilisation(ctx: Ctx): void {
  const reach = mobilisationReach(ctx.project.id)
  const rows = listMobilisation(ctx.project.id)
  if (rows.length === 0) return
  heading(ctx, 'Community mobilisation')
  keyFigures(ctx, [
    { label: 'Expected reach across activities', value: reach.expected },
    { label: 'Actual reach recorded', value: reach.actual },
    { label: 'Mobilisation cost', value: formatMoney(reach.cost, ctx.project.currency) },
  ])
  table(
    ctx,
    ['Activity', 'Type', 'Date', 'Responsible', 'Expected', 'Actual', 'Status'],
    rows.map((m) => [
      m.activity,
      m.activity_type ?? '',
      m.activity_date ?? '',
      m.responsible_person ?? '',
      m.expected_reach ?? '',
      m.actual_reach ?? '',
      labelFor(m.status),
    ]),
  )
}

function sectionDataQuality(ctx: Ctx): void {
  const q = dataQuality(ctx.project.id)
  heading(ctx, 'Data quality')
  keyFigures(ctx, [
    { label: 'Participants', value: q.totalParticipants },
    {
      label: 'Complete records (consent, age, BP and clinical review)',
      value: `${q.completeRecords} (${percent(q.completeRecords, q.totalParticipants)}%)`,
    },
    { label: 'Incomplete records', value: q.incompleteRecords },
  ])
  if (q.issues.length) {
    table(
      ctx,
      ['Data quality issue', 'Records affected'],
      q.issues.map((i) => [i.label, i.count]),
    )
  } else {
    paragraph(ctx, 'No outstanding data quality issues were found.')
  }
}

function sectionObjectives(ctx: Ctx): void {
  if (!ctx.project.objectives && !ctx.project.theme) return
  heading(ctx, 'Objectives')
  if (ctx.project.theme) paragraph(ctx, `Theme: ${ctx.project.theme}`)
  if (ctx.project.objectives) paragraph(ctx, ctx.project.objectives)
}

function sectionRecommendations(ctx: Ctx): void {
  const s = screeningStats(ctx.project.id)
  const f = followupStats(ctx.project.id)
  const q = dataQuality(ctx.project.id)
  heading(ctx, 'Recommendations')

  const recs: string[] = []
  if (s.bpElevated > 0) {
    recs.push(
      `${s.bpElevated} participants recorded an elevated blood pressure screening measurement. ` +
        `Ensure each has been advised to attend a health facility for confirmatory measurement ` +
        `and clinical assessment.`,
    )
  }
  if (s.glucoseAbnormal > 0) {
    recs.push(
      `${s.glucoseAbnormal} participants recorded an abnormal glucose screening result. ` +
        `Confirmatory laboratory testing should be arranged before any diagnosis is made.`,
    )
  }
  if (s.breastAbnormal > 0) {
    recs.push(
      `${s.breastAbnormal} participants had an abnormal breast examination finding documented and ` +
        `require timely further evaluation at the referral facility.`,
    )
  }
  if (f.overdue > 0) {
    recs.push(`${f.overdue} follow-up entries are overdue and should be contacted without delay.`)
  }
  if (f.unreachable > 0) {
    recs.push(
      `${f.unreachable} participants could not be reached. Consider community-based tracing ` +
        `through the mobilisation partners used for this outreach.`,
    )
  }
  if (q.missingPhone > 0) {
    recs.push(
      `${q.missingPhone} participants have no telephone number recorded, which limits follow-up. ` +
        `Capturing a contact number at registration should be reinforced at the next outreach.`,
    )
  }
  if (recs.length === 0) {
    recs.push('No outstanding clinical or operational actions were identified from the data.')
  }

  recs.forEach((r, i) => paragraph(ctx, `${i + 1}.  ${r}`))
}

function executiveSummary(ctx: Ctx): void {
  const reach = reachStats(ctx.project.id, ctx.project.expected_participants)
  const s = screeningStats(ctx.project.id)
  const ref = referralStats(ctx.project.id)
  heading(ctx, 'Executive summary')
  paragraph(
    ctx,
    `The ${ctx.project.name} was held at ${ctx.project.location ?? 'the outreach venue'}` +
      `${ctx.project.lga ? `, ${ctx.project.lga} Local Government Area` : ''}` +
      `${ctx.project.state ? `, ${ctx.project.state} State` : ''}` +
      `${ctx.project.proposed_date ? ` on ${formatLongDate(ctx.project.proposed_date)}` : ''}. ` +
      `Against an expectation of ${reach.expected} beneficiaries, ${reach.registered} people were ` +
      `registered and ${reach.screened} received at least one screening measurement. ` +
      `${reach.completed} participants completed the full outreach pathway.`,
  )
  paragraph(
    ctx,
    `Screening identified ${s.bpElevated} participants with an elevated blood pressure screening ` +
      `measurement and ${s.glucoseAbnormal} with an abnormal glucose screening result, each ` +
      `requiring clinical assessment. ${s.breastAbnormal} participants had an abnormal breast ` +
      `examination finding documented and ${s.woundParticipants} received wound care. ` +
      `${ref.total} referrals were issued, of which ${ref.urgent} were urgent or emergency.`,
  )
  paragraph(
    ctx,
    'These are screening findings recorded in a community setting. They are not diagnoses, and ' +
      'each requires confirmation and assessment by a qualified healthcare professional.',
  )
}

// ----------------------------------------------------------- generation

type SectionFn = (ctx: Ctx) => void

const SECTIONS: Record<ReportKey, SectionFn[]> = {
  EXECUTIVE: [
    executiveSummary,
    sectionObjectives,
    sectionReach,
    sectionDemographics,
    sectionClinical,
    sectionReferrals,
    sectionFollowup,
    sectionFinance,
    sectionRecommendations,
    signOff,
  ],
  CLINICAL_SUMMARY: [
    clinicalLanguageNote,
    sectionReach,
    sectionBloodPressure,
    sectionGlucose,
    sectionBreast,
    sectionWound,
    sectionClinical,
    sectionReferrals,
  ],
  PARTICIPANT_STATISTICS: [sectionReach, sectionDemographics],
  BP_SCREENING: [clinicalLanguageNote, sectionBloodPressure],
  GLUCOSE_SCREENING: [clinicalLanguageNote, sectionGlucose],
  BREAST_HEALTH: [clinicalLanguageNote, sectionBreast],
  WOUND_CARE: [clinicalLanguageNote, sectionWound],
  REFERRAL: [sectionReferrals],
  FOLLOWUP: [sectionFollowup],
  INVENTORY: [sectionInventory],
  PROCUREMENT: [sectionProcurement],
  FINANCIAL: [sectionFinance, sectionProcurement],
  TEAM: [sectionTeam, sectionMobilisation],
  DATA_QUALITY: [sectionDataQuality],
  COMPLETE: [
    executiveSummary,
    sectionObjectives,
    clinicalLanguageNote,
    sectionReach,
    sectionDemographics,
    sectionBloodPressure,
    sectionGlucose,
    sectionBreast,
    sectionWound,
    sectionClinical,
    sectionReferrals,
    sectionFollowup,
    sectionInventory,
    sectionProcurement,
    sectionFinance,
    sectionTeam,
    sectionMobilisation,
    sectionDataQuality,
    sectionRecommendations,
    signOff,
  ],
}

export function buildReport(
  key: ReportKey,
  project: Project,
  includeIdentifiers: boolean,
  brand: Brand = { watermark: null, seal: null },
): jsPDF {
  const definition = REPORTS.find((r) => r.key === key)!
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const ctx: Ctx = {
    doc,
    y: 20,
    project,
    includeIdentifiers: includeIdentifiers && definition.containsIdentifiers,
    brand,
  }
  coverPage(ctx, definition.title)
  for (const section of SECTIONS[key]) section(ctx)
  footers(doc, project, brand)
  return doc
}

export async function generateReportPdf(
  key: ReportKey,
  project: Project,
  includeIdentifiers: boolean,
): Promise<{ filename: string }> {
  const definition = REPORTS.find((r) => r.key === key)!
  const doc = buildReport(key, project, includeIdentifiers, await loadBrand())
  const bytes = new Uint8Array(doc.output('arraybuffer'))
  const filename = `${key.toLowerCase()}-report-${filenameStamp()}.pdf`

  const outcome = await saveFile(bytes, filename, 'application/pdf', 'PDF report')
  if (!outcome.ok) {
    if (outcome.cancelled) throw new Error('Report cancelled. No file was written.')
    throw new Error(`The report could not be written: ${outcome.error}`)
  }

  await transaction(() => {
    audit({
      action: AUDIT_ACTIONS.EXPORT,
      entityType: 'report',
      entityId: key,
      summary:
        `PDF report "${definition.title}" generated as ${outcome.name}` +
        (includeIdentifiers && definition.containsIdentifiers
          ? ' including patient identifiers'
          : ''),
    })
  })
  return { filename: outcome.name }
}

export function reportDateLabel(project: Project): string {
  return project.proposed_date ? formatLongDate(project.proposed_date) : formatLongDate(today())
}
