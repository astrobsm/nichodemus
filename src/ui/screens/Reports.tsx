/** Analytics, PDF reports, data export and the closure workflow (S42-S46, S77). */
import { useState } from 'react'
import { useApp, useQuery } from '../AppState'
import {
  AlertBox,
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  KeyValue,
  Modal,
  Stat,
  Tabs,
  TextArea,
  Toggle,
  friendlyError,
  useToast,
} from '../components/ui'
import { ClinicalSummaryCards, DataQualityPanel } from './Dashboard'
import {
  demographics,
  reachStats,
  screeningStats,
  dataQuality,
  hourlyThroughput,
  percent,
  topReferralReasons,
} from '../../db/repo/analytics'
import { followupStats, referralStats } from '../../db/repo/referrals'
import { checklistProgress, closeProject } from '../../db/repo/projects'
import { inventoryAlerts, inventoryReconciliation } from '../../db/repo/inventory'
import { budgetSummary, formatMoney } from '../../db/repo/finance'
import { DATASETS, exportDataset } from '../../services/exporter'
import { REPORTS, generateReportPdf, type ReportKey } from '../../services/pdfReport'
import { createBackup } from '../../services/backup'
import { PassphrasePrompt } from './Onboarding'
import { PERMISSIONS } from '../../core/permissions'
import { AGE_BANDS, labelFor } from '../../core/constants'
import { formatLongDate } from '../../core/datetime'

type Tab = 'SUMMARY' | 'DEMOGRAPHICS' | 'REPORTS' | 'EXPORT' | 'QUALITY' | 'CLOSURE'

export function ReportsScreen() {
  const { project, can } = useApp()
  const [tab, setTab] = useState<Tab>('SUMMARY')

  if (!project) return <EmptyState glyph="□" title="No active project" />

  const tabs: { key: Tab; label: string }[] = [
    { key: 'SUMMARY', label: 'Summary' },
    { key: 'DEMOGRAPHICS', label: 'Demographics' },
    { key: 'REPORTS', label: 'PDF reports' },
  ]
  if (can(PERMISSIONS.REPORTS_EXPORT)) tabs.push({ key: 'EXPORT', label: 'Export' })
  tabs.push({ key: 'QUALITY', label: 'Data quality' })
  if (can(PERMISSIONS.PROJECT_CLOSE)) tabs.push({ key: 'CLOSURE', label: 'Close outreach' })

  return (
    <>
      <Tabs active={tab} onChange={(k) => setTab(k as Tab)} tabs={tabs} />
      {tab === 'SUMMARY' ? (
        <ClinicalSummaryCards projectId={project.id} expected={project.expected_participants} />
      ) : null}
      {tab === 'DEMOGRAPHICS' ? <DemographicsPanel projectId={project.id} expected={project.expected_participants} /> : null}
      {tab === 'REPORTS' ? <ReportsPanel /> : null}
      {tab === 'EXPORT' ? <ExportPanel projectId={project.id} /> : null}
      {tab === 'QUALITY' ? <DataQualityPanel projectId={project.id} /> : null}
      {tab === 'CLOSURE' ? <ClosurePanel /> : null}
    </>
  )
}

function DemographicsPanel({ projectId, expected }: { projectId: number; expected: number }) {
  const d = useQuery(() => demographics(projectId), [projectId])
  const reach = useQuery(() => reachStats(projectId, expected), [projectId, expected])
  const hours = useQuery(() => hourlyThroughput(projectId), [projectId])
  const reasons = useQuery(() => topReferralReasons(projectId), [projectId])

  const maxBand = Math.max(1, ...d.ageBands.map((b) => b.count))

  return (
    <>
      <div className="stat-grid">
        <Stat label="Registered" value={reach.registered} big />
        <Stat label="Against expectation" value={`${percent(reach.registered, expected || 1)}%`} />
        <Stat label="Female" value={d.female} foot={`${percent(d.female, d.total)}%`} />
        <Stat label="Male" value={d.male} foot={`${percent(d.male, d.total)}%`} />
        <Stat label="Mean age" value={d.meanAge ?? '—'} foot="years" />
        <Stat label="Age not recorded" value={d.ageNotRecorded} tone={d.ageNotRecorded > 0 ? 'warn' : undefined} />
      </div>

      <Card title="Age distribution">
        {d.ageBands.map((b) => (
          <div key={b.label} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{b.label}</span>
              <span>
                {b.count} ({b.percent}%)
              </span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${(b.count / maxBand) * 100}%` }} />
            </div>
          </div>
        ))}
        <p className="hint">Age bands as defined in the outreach reporting standard.</p>
      </Card>

      {d.communities.length ? (
        <Card title="Communities reached">
          {d.communities.map((c) => (
            <KeyValue key={c.community} k={c.community} v={c.count} />
          ))}
        </Card>
      ) : null}

      {hours.length ? (
        <Card title="Registrations by hour today">
          {hours.map((h) => (
            <KeyValue key={h.hour} k={`${h.hour}:00`} v={h.count} />
          ))}
        </Card>
      ) : null}

      {reasons.length ? (
        <Card title="Most frequent referral reasons">
          {reasons.map((r) => (
            <KeyValue key={r.reason} k={r.reason} v={r.count} />
          ))}
        </Card>
      ) : null}
    </>
  )
}

function ReportsPanel() {
  const { project, can } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState<ReportKey | null>(null)
  const [includeIdentifiers, setIncludeIdentifiers] = useState(false)
  const mayIdentify = can(PERMISSIONS.REPORTS_IDENTIFIABLE)

  async function generate(key: ReportKey) {
    if (!project) return
    setBusy(key)
    try {
      const { filename } = await generateReportPdf(key, project, includeIdentifiers && mayIdentify)
      toast('ok', `Report saved as ${filename}.`)
    } catch (err) {
      toast('danger', friendlyError(err, 'The report could not be generated.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <AlertBox tone="info" title="Reports are produced on this device">
        The PDF is rendered locally. Nothing is uploaded and no internet connection is needed.
      </AlertBox>

      {mayIdentify ? (
        <Card>
          <Toggle
            label="Include patient identifiers"
            help="Only applies to the referral and follow-up reports. Executive and statistical reports never contain identifiers."
            checked={includeIdentifiers}
            onChange={setIncludeIdentifiers}
          />
          {includeIdentifiers ? (
            <AlertBox tone="warn" title="Confidential document">
              The generated file will contain names and telephone numbers. Store and share it only
              as your information governance arrangements allow.
            </AlertBox>
          ) : null}
        </Card>
      ) : null}

      <Card flush>
        {REPORTS.map((r) => (
          <button key={r.key} className="list-item" onClick={() => void generate(r.key)} disabled={busy !== null}>
            <span className="grow">
              <span className="primary">{r.title}</span>
              <span className="secondary" style={{ whiteSpace: 'normal' }}>{r.description}</span>
              {r.containsIdentifiers ? (
                <span style={{ marginTop: 6, display: 'block' }}>
                  <Badge tone={includeIdentifiers && mayIdentify ? 'warn' : 'muted'}>
                    {includeIdentifiers && mayIdentify ? 'Will include identifiers' : 'De-identified'}
                  </Badge>
                </span>
              ) : null}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>
              {busy === r.key ? 'Working…' : 'PDF'}
            </span>
          </button>
        ))}
      </Card>
    </>
  )
}

function ExportPanel({ projectId }: { projectId: number }) {
  const { can } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const mayIdentify = can(PERMISSIONS.REPORTS_IDENTIFIABLE)
  const [includeIdentifiers, setIncludeIdentifiers] = useState(false)

  async function run(key: string) {
    const dataset = DATASETS.find((d) => d.key === key)!
    setBusy(key)
    try {
      const { rows, filename } = await exportDataset(
        dataset,
        projectId,
        includeIdentifiers && mayIdentify,
      )
      toast('ok', `${rows} rows exported to ${filename}.`)
    } catch (err) {
      toast('danger', friendlyError(err, 'The export could not be completed.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <AlertBox tone="info" title="CSV files open in any spreadsheet">
        Files are written to the folder you choose on this device. Nothing is uploaded.
      </AlertBox>

      {mayIdentify ? (
        <Card>
          <Toggle
            label="Include patient identifiers"
            help="Without this, exports use the participant code only."
            checked={includeIdentifiers}
            onChange={setIncludeIdentifiers}
          />
        </Card>
      ) : (
        <AlertBox tone="muted" title="De-identified exports">
          Your role exports participant codes rather than names and telephone numbers.
        </AlertBox>
      )}

      <Card flush>
        {DATASETS.map((d) => (
          <button key={d.key} className="list-item" onClick={() => void run(d.key)} disabled={busy !== null}>
            <span className="grow">
              <span className="primary">{d.label}</span>
              <span className="secondary" style={{ whiteSpace: 'normal' }}>{d.description}</span>
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>
              {busy === d.key ? 'Working…' : 'CSV'}
            </span>
          </button>
        ))}
      </Card>
    </>
  )
}

// ------------------------------------------------------------- closure

function ClosurePanel() {
  const { project: activeProject, refresh, can } = useApp()
  const project = activeProject!
  const toast = useToast()
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [backupPrompt, setBackupPrompt] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!project) return null

  const quality = useQuery(() => dataQuality(project.id), [project.id])
  const checklist = useQuery(() => checklistProgress(project.id), [project.id])
  const refs = useQuery(() => referralStats(project.id), [project.id])
  const fu = useQuery(() => followupStats(project.id), [project.id])
  const inventory = useQuery(() => inventoryReconciliation(project.id), [project.id])
  const alerts = useQuery(() => inventoryAlerts(project.id), [project.id])
  const budget = useQuery(() => budgetSummary(project.id), [project.id])
  const screening = useQuery(() => screeningStats(project.id), [project.id])
  const reach = useQuery(() => reachStats(project.id, project.expected_participants), [project.id])

  const blockers: string[] = []
  if (checklist.mandatoryDone < checklist.mandatoryTotal) {
    blockers.push(
      `${checklist.mandatoryTotal - checklist.mandatoryDone} mandatory checklist item(s) are not complete.`,
    )
  }
  if (quality.referralsWithoutOutcome > 0) {
    blockers.push(`${quality.referralsWithoutOutcome} referral(s) have no recorded outcome.`)
  }
  const warnings: string[] = []
  if (fu.pending > 0) warnings.push(`${fu.pending} follow-up entries are still pending.`)
  if (alerts.expired.length > 0) warnings.push(`${alerts.expired.length} inventory item(s) are expired.`)
  if (quality.incompleteRecords > 0) {
    warnings.push(`${quality.incompleteRecords} participant record(s) are incomplete.`)
  }

  const closed = project.status === 'COMPLETED' || project.status === 'CLOSED'

  async function doClose() {
    setBusy(true)
    try {
      closeProject(project.id, notes || null)
      refresh()
      toast('ok', 'The outreach has been closed and marked completed.')
      setConfirming(false)
    } catch (err) {
      toast('danger', friendlyError(err, 'The outreach could not be closed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {closed ? (
        <AlertBox tone="ok" title="This outreach is closed">
          Closed on {formatLongDate(project.closed_at)}. Records remain available for reporting and
          follow-up.
        </AlertBox>
      ) : null}

      <Card title="Final position">
        <KeyValue k="Registered" v={reach.registered} />
        <KeyValue k="Screened" v={reach.screened} />
        <KeyValue k="Completed the pathway" v={reach.completed} />
        <KeyValue k="Elevated BP screening findings" v={screening.bpElevated} />
        <KeyValue k="Abnormal glucose screening findings" v={screening.glucoseAbnormal} />
        <KeyValue k="Abnormal breast findings" v={screening.breastAbnormal} />
        <KeyValue k="Referrals issued" v={refs.total} />
        <KeyValue k="Follow-up completed" v={`${fu.completed} of ${fu.total}`} />
        <KeyValue k="Total spent" v={formatMoney(budget.totals.spent, project.currency)} />
        <KeyValue k="Inventory items to reconcile" v={inventory.length} />
      </Card>

      {blockers.length > 0 ? (
        <AlertBox tone="danger" title="These must be resolved before closing">
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </AlertBox>
      ) : null}

      {warnings.length > 0 ? (
        <AlertBox tone="warn" title="Worth checking first">
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </AlertBox>
      ) : null}

      {can(PERMISSIONS.BACKUP_CREATE) ? (
        <Card title="Closure backup">
          <p className="hint" style={{ marginTop: 0 }}>
            Take a final encrypted backup before closing the outreach.
          </p>
          <button className="btn block secondary" onClick={() => setBackupPrompt(true)}>
            Create closure backup
          </button>
        </Card>
      ) : null}

      {!closed ? (
        <>
          <TextArea label="Closure notes" value={notes} onChange={setNotes} />
          <button
            className="btn block large"
            disabled={blockers.length > 0 || busy}
            onClick={() => setConfirming(true)}
          >
            Close outreach
          </button>
          {blockers.length > 0 ? (
            <p className="hint">Resolve the items listed above to enable this button.</p>
          ) : null}
        </>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title="Close this outreach?"
          message="The project will be marked COMPLETED. Records stay available for follow-up and reporting, and the project can be reopened by an administrator from project settings."
          confirmLabel="Close outreach"
          onConfirm={doClose}
          onCancel={() => setConfirming(false)}
          busy={busy}
        />
      ) : null}

      {backupPrompt ? (
        <Modal title="Closure backup" onClose={() => setBackupPrompt(false)}>
          <PassphrasePrompt
            description="Choose a password to encrypt the backup file. You will need it to restore."
            confirmLabel="Create backup"
            requireConfirm
            onCancel={() => setBackupPrompt(false)}
            onSubmit={async (pass) => {
              const r = await createBackup(pass, 'CLOSURE', 'Backup taken at outreach closure')
              toast('ok', `Backup saved as ${r.filename}.`)
              refresh()
              setBackupPrompt(false)
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

export { AGE_BANDS, labelFor }
