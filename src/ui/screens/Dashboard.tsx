/** Home dashboard and event-day operations dashboard (spec S8, S41, S43). */
import { useApp, useQuery } from '../AppState'
import { navigate } from '../router'
import { AlertBox, Badge, Card, EmptyState, Stat } from '../components/ui'
import { formatLongDate, today } from '../../core/datetime'
import { labelFor, WORKFLOW_LABELS, type WorkflowStatus, WORKFLOW_STATUSES, SETTING_KEYS } from '../../core/constants'
import { PERMISSIONS } from '../../core/permissions'
import {
  dailyStats,
  dataQuality,
  reachStats,
  screeningStats,
  referralRate,
  percent,
} from '../../db/repo/analytics'
import { queueCounts } from '../../db/repo/participants'
import { referralStats, pendingFollowupCount, followupStats } from '../../db/repo/referrals'
import { inventoryAlerts } from '../../db/repo/inventory'
import { urgentAlerts } from '../../db/repo/clinical'
import { checklistProgress, isEventDay, projectSummaryLine } from '../../db/repo/projects'
import { taskStats } from '../../db/repo/planning'
import { backupStatus } from '../../services/backup'
import { getSetting } from '../../db/repo/settings'

export function Dashboard() {
  const { project, can } = useApp()

  if (!project) {
    return (
      <EmptyState glyph="□" title="No active project">
        Create a project in Settings before registering participants.
      </EmptyState>
    )
  }

  const eventDay = isEventDay(project)
  const reach = useQuery(() => reachStats(project.id, project.expected_participants), [project.id])
  const refs = useQuery(() => referralStats(project.id), [project.id])
  const followPending = useQuery(() => pendingFollowupCount(project.id), [project.id])
  const invAlerts = useQuery(() => inventoryAlerts(project.id), [project.id])
  const urgent = useQuery(() => urgentAlerts(project.id, 6), [project.id])
  const backup = useQuery(() => backupStatus(), [])
  const checklist = useQuery(() => checklistProgress(project.id), [project.id])

  const inventoryAlertTotal =
    invAlerts.lowStock.length +
    invAlerts.outOfStock.length +
    invAlerts.expiringSoon.length +
    invAlerts.expired.length

  return (
    <>
      <Card tight>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase' }}>
          {labelFor(project.status)}
        </div>
        <h2 style={{ margin: '4px 0 2px', fontSize: 18, lineHeight: 1.25 }}>{project.name}</h2>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>{projectSummaryLine(project)}</div>
        <div style={{ fontWeight: 700, marginTop: 6, fontSize: 15 }}>
          {formatLongDate(project.proposed_date)}
        </div>
      </Card>

      {backup.freshness === 'NEVER' || backup.freshness === 'OVERDUE' ? (
        <AlertBox tone="warn" title="Backup required">
          {backup.freshness === 'NEVER'
            ? 'No backup has been made on this device yet. Create one before the outreach begins.'
            : `The last backup was ${backup.label}. Create a fresh backup.`}
        </AlertBox>
      ) : null}

      {urgent.length > 0 && can(PERMISSIONS.PARTICIPANT_VIEW) ? (
        <AlertBox tone="danger" title={`${urgent.length} urgent clinical alert${urgent.length === 1 ? '' : 's'}`}>
          Participants with an urgent screening finding are waiting for review.{' '}
          <button className="btn small secondary" style={{ marginTop: 8 }} onClick={() => navigate('/clinical')}>
            Open clinical queue
          </button>
        </AlertBox>
      ) : null}

      <div className="stat-grid">
        <Stat label="Expected" value={project.expected_participants} big />
        <Stat label="Registered" value={reach.registered} big />
      </div>
      <div style={{ height: 10 }} />
      <div className="stat-grid">
        <Stat
          label="Screened"
          value={reach.screened}
          foot={`${percent(reach.screened, reach.registered)}% of registered`}
        />
        <Stat label="Completed" value={reach.completed} tone="ok" />
        <Stat
          label="Referrals"
          value={refs.total}
          tone={refs.urgent > 0 ? 'warn' : undefined}
          foot={refs.urgent > 0 ? `${refs.urgent} urgent or emergency` : 'None urgent'}
        />
        <Stat
          label="Follow-up required"
          value={followPending}
          tone={followPending > 0 ? 'warn' : undefined}
        />
      </div>

      {eventDay ? <EventDayPanel projectId={project.id} /> : null}

      <h3 className="section-title">Quick actions</h3>
      <div className="btn-row">
        {can(PERMISSIONS.PARTICIPANT_CREATE) ? (
          <button className="btn large" onClick={() => navigate('/register')}>
            Register participant
          </button>
        ) : null}
        <button className="btn secondary large" onClick={() => navigate('/people')}>
          Find participant
        </button>
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn secondary" onClick={() => navigate('/clinical')}>
          Station queues
        </button>
        {can(PERMISSIONS.REPORTS_VIEW) ? (
          <button className="btn secondary" onClick={() => navigate('/reports')}>
            Reports
          </button>
        ) : null}
      </div>

      <h3 className="section-title">Preparation</h3>
      <Card>
        <ChecklistBar
          label="Event checklist"
          done={checklist.done}
          total={checklist.total}
          onClick={() => navigate('/operations/checklist')}
        />
        <div style={{ height: 12 }} />
        <ChecklistBar
          label="Mandatory items"
          done={checklist.mandatoryDone}
          total={checklist.mandatoryTotal}
          onClick={() => navigate('/operations/checklist')}
        />
        <TaskSummary projectId={project.id} />
      </Card>

      {inventoryAlertTotal > 0 && can(PERMISSIONS.INVENTORY_VIEW) ? (
        <Card title="Inventory alerts">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {invAlerts.outOfStock.length > 0 ? (
              <Badge tone="danger">{invAlerts.outOfStock.length} out of stock</Badge>
            ) : null}
            {invAlerts.lowStock.length > 0 ? (
              <Badge tone="warn">{invAlerts.lowStock.length} low stock</Badge>
            ) : null}
            {invAlerts.expired.length > 0 ? (
              <Badge tone="danger">{invAlerts.expired.length} expired</Badge>
            ) : null}
            {invAlerts.expiringSoon.length > 0 ? (
              <Badge tone="warn">{invAlerts.expiringSoon.length} expiring soon</Badge>
            ) : null}
          </div>
          <button className="btn secondary block" onClick={() => navigate('/operations/inventory')}>
            Open inventory
          </button>
        </Card>
      ) : null}
    </>
  )
}

function ChecklistBar({
  label,
  done,
  total,
  onClick,
}: {
  label: string
  done: number
  total: number
  onClick: () => void
}) {
  const pct = total ? Math.round((done / total) * 100) : 0
  const tone = pct === 100 ? 'ok' : pct >= 60 ? '' : 'warn'
  return (
    <button
      onClick={onClick}
      style={{ background: 'none', border: 0, padding: 0, width: '100%', textAlign: 'left', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 5 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ fontWeight: 700 }}>
          {done} of {total} ({pct}%)
        </span>
      </div>
      <div className="progress-track">
        <div className={`progress-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </button>
  )
}

function TaskSummary({ projectId }: { projectId: number }) {
  const stats = useQuery(() => taskStats(projectId), [projectId])
  if (stats.total === 0) return null
  return (
    <div style={{ marginTop: 14 }}>
      <div className="kv">
        <span className="k">Planning tasks completed</span>
        <span className="v">
          {stats.completed} of {stats.total}
        </span>
      </div>
      {stats.overdue > 0 ? (
        <div className="kv">
          <span className="k">Overdue tasks</span>
          <span className="v">
            <Badge tone="warn">{stats.overdue}</Badge>
          </span>
        </div>
      ) : null}
      {stats.critical > 0 ? (
        <div className="kv">
          <span className="k">Critical tasks outstanding</span>
          <span className="v">
            <Badge tone="danger">{stats.critical}</Badge>
          </span>
        </div>
      ) : null}
      <button
        className="btn secondary block small"
        style={{ marginTop: 10 }}
        onClick={() => navigate('/operations/tasks')}
      >
        Open tasks
      </button>
    </div>
  )
}

function EventDayPanel({ projectId }: { projectId: number }) {
  const stats = useQuery(() => dailyStats(projectId, today()), [projectId])
  const counts = useQuery(() => queueCounts(projectId), [projectId])

  return (
    <>
      <h3 className="section-title">Today</h3>
      <div className="stat-grid">
        <Stat label="Registered today" value={stats.registered} />
        <Stat label="Screened today" value={stats.screened} />
        <Stat label="Completed today" value={stats.completed} tone="ok" />
        <Stat label="Still in the queue" value={stats.waiting} tone={stats.waiting > 30 ? 'warn' : undefined} />
      </div>

      <Card title="Activity today" tight>
        <div className="kv"><span className="k">Blood pressure readings</span><span className="v">{stats.bp}</span></div>
        <div className="kv"><span className="k">Glucose tests</span><span className="v">{stats.glucose}</span></div>
        <div className="kv"><span className="k">Clinical consultations</span><span className="v">{stats.clinical}</span></div>
        <div className="kv"><span className="k">Wound assessments</span><span className="v">{stats.wound}</span></div>
        <div className="kv"><span className="k">Breast examinations</span><span className="v">{stats.breast}</span></div>
        <div className="kv">
          <span className="k">Referrals issued</span>
          <span className="v">
            {stats.referrals}
            {stats.urgentReferrals > 0 ? <> <Badge tone="danger">{stats.urgentReferrals} urgent</Badge></> : null}
          </span>
        </div>
      </Card>

      <Card title="Station queues" flush>
        {WORKFLOW_STATUSES.filter((s) => s !== 'COMPLETED').map((s) => (
          <button
            key={s}
            className="list-item"
            onClick={() => navigate(`/clinical/queue/${s}`)}
          >
            <span className="grow">
              <span className="primary">{WORKFLOW_LABELS[s as WorkflowStatus]}</span>
            </span>
            <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {counts[s] ?? 0}
            </span>
            <span className="chevron" aria-hidden="true">›</span>
          </button>
        ))}
      </Card>
    </>
  )
}

/** Clinical summary cards, aggregate only - no patient identifiers. */
export function ClinicalSummaryCards({ projectId, expected }: { projectId: number; expected: number }) {
  const s = useQuery(() => screeningStats(projectId), [projectId])
  const refs = useQuery(() => referralStats(projectId), [projectId])
  const fu = useQuery(() => followupStats(projectId), [projectId])
  const rate = useQuery(() => referralRate(projectId, expected), [projectId, expected])

  return (
    <>
      <AlertBox tone="info" title="These are screening findings, not diagnoses">
        Figures below count screening measurements and clinical findings recorded at this outreach.
        They do not represent confirmed diagnoses.
      </AlertBox>
      <div className="stat-grid">
        <Stat label="BP screened" value={s.bpParticipants} />
        <Stat
          label="BP elevated"
          value={s.bpElevated}
          tone={s.bpElevated > 0 ? 'warn' : undefined}
          foot={`${percent(s.bpElevated, s.bpParticipants)}% of those screened`}
        />
        <Stat label="Glucose tested" value={s.glucoseParticipants} />
        <Stat
          label="Glucose abnormal"
          value={s.glucoseAbnormal}
          tone={s.glucoseAbnormal > 0 ? 'warn' : undefined}
          foot={`${percent(s.glucoseAbnormal, s.glucoseParticipants)}% of those tested`}
        />
        <Stat label="Breast examinations" value={s.breastExams} />
        <Stat
          label="Breast findings"
          value={s.breastAbnormal}
          tone={s.breastAbnormal > 0 ? 'warn' : undefined}
        />
        <Stat label="Wounds assessed" value={s.woundsAssessed} />
        <Stat label="Clinical reviews" value={s.clinicalReviews} />
        <Stat label="Referrals" value={refs.total} foot={`Referral rate ${rate}%`} />
        <Stat label="Urgent cases" value={refs.urgent} tone={refs.urgent > 0 ? 'danger' : undefined} />
        <Stat label="Follow-up pending" value={fu.pending + fu.contacted} tone={fu.overdue > 0 ? 'warn' : undefined} foot={fu.overdue > 0 ? `${fu.overdue} overdue` : undefined} />
      </div>
    </>
  )
}

export function DataQualityPanel({ projectId }: { projectId: number }) {
  const q = useQuery(() => dataQuality(projectId), [projectId])
  return (
    <>
      <div className="stat-grid">
        <Stat label="Complete records" value={q.completeRecords} tone="ok" />
        <Stat
          label="Incomplete records"
          value={q.incompleteRecords}
          tone={q.incompleteRecords > 0 ? 'warn' : undefined}
        />
      </div>
      <Card title="Checks">
        {q.issues.length === 0 ? (
          <EmptyState glyph="✓" title="No outstanding data quality issues" />
        ) : (
          q.issues.map((i) => (
            <div key={i.label} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <strong style={{ fontSize: 14.5 }}>{i.label}</strong>
                <Badge tone="warn">{i.count}</Badge>
              </div>
              <div className="hint" style={{ marginTop: 2 }}>{i.detail}</div>
            </div>
          ))
        )}
      </Card>
      <p className="hint">
        A record counts as complete when consent, age, a blood pressure reading and a clinical
        review have all been recorded.
      </p>
    </>
  )
}

export function offlineLabel(online: boolean): string {
  return online
    ? 'Online — data is still stored only on this device'
    : 'Offline mode — all data is being stored securely on this device'
}

export function storageWarningMb(): number {
  return Number(getSetting(SETTING_KEYS.LOW_STORAGE_WARN_MB) ?? 200)
}
