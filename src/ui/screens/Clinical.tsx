/** Station queues, referral tracking and the follow-up dashboard (S26-S30, S78). */
import { useState } from 'react'
import { useApp, useQuery } from '../AppState'
import { navigate } from '../router'
import {
  AlertBox,
  Badge,
  Card,
  EmptyState,
  KeyValue,
  Modal,
  SelectField,
  Stat,
  Tabs,
  TextArea,
  TextField,
  Toggle,
  friendlyError,
  useToast,
} from '../components/ui'
import { fullName, queueCounts, queueFor, moveParticipant } from '../../db/repo/participants'
import {
  listFollowups,
  listReferrals,
  followupStats,
  referralStats,
  updateFollowup,
  updateReferralStatus,
  type FollowupWithParticipant,
} from '../../db/repo/referrals'
import { urgentAlerts } from '../../db/repo/clinical'
import {
  FOLLOWUP_OUTCOMES,
  REFERRAL_STATUSES,
  REFERRAL_URGENCIES,
  WORKFLOW_LABELS,
  WORKFLOW_STATUSES,
  WORKFLOW_NEXT,
  labelFor,
  type WorkflowStatus,
} from '../../core/constants'
import { PERMISSIONS } from '../../core/permissions'
import { formatShortDate, formatDateTime, today, daysBetween } from '../../core/datetime'

type Tab = 'QUEUES' | 'REFERRALS' | 'FOLLOWUP' | 'ALERTS'

export function ClinicalScreen({ initialTab, stage }: { initialTab?: Tab; stage?: string }) {
  const { project, can } = useApp()
  const [tab, setTab] = useState<Tab>(initialTab ?? 'QUEUES')

  if (!project) return <EmptyState glyph="□" title="No active project" />
  if (stage) return <QueueDetail projectId={project.id} stage={stage as WorkflowStatus} />

  const fu = useQuery(() => followupStats(project.id), [project.id])
  const refs = useQuery(() => referralStats(project.id), [project.id])
  const alerts = useQuery(() => urgentAlerts(project.id, 30), [project.id])

  return (
    <>
      <Tabs
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        tabs={[
          { key: 'QUEUES', label: 'Queues' },
          { key: 'REFERRALS', label: 'Referrals', badge: refs.total },
          { key: 'FOLLOWUP', label: 'Follow-up', badge: fu.pending + fu.contacted },
          { key: 'ALERTS', label: 'Urgent', badge: alerts.length },
        ]}
      />
      {tab === 'QUEUES' ? <QueueOverview projectId={project.id} /> : null}
      {tab === 'REFERRALS' ? <ReferralsPanel projectId={project.id} canUpdate={can(PERMISSIONS.REFERRAL_UPDATE)} /> : null}
      {tab === 'FOLLOWUP' ? <FollowupPanel projectId={project.id} canManage={can(PERMISSIONS.FOLLOWUP_MANAGE)} /> : null}
      {tab === 'ALERTS' ? <UrgentPanel projectId={project.id} /> : null}
    </>
  )
}

function QueueOverview({ projectId }: { projectId: number }) {
  const counts = useQuery(() => queueCounts(projectId), [projectId])
  const waiting = WORKFLOW_STATUSES.filter((s) => s !== 'COMPLETED').reduce(
    (sum, s) => sum + (counts[s] ?? 0),
    0,
  )

  return (
    <>
      <div className="stat-grid">
        <Stat label="Still in the outreach" value={waiting} big tone={waiting > 40 ? 'warn' : undefined} />
        <Stat label="Completed" value={counts.COMPLETED ?? 0} big tone="ok" />
      </div>
      <h3 className="section-title">Stations</h3>
      {WORKFLOW_STATUSES.map((s) => (
        <button key={s} className="queue-pill" onClick={() => navigate(`/clinical/queue/${s}`)}>
          <span className="name">{WORKFLOW_LABELS[s]}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="count">{counts[s] ?? 0}</span>
            <span className="chevron" aria-hidden="true">›</span>
          </span>
        </button>
      ))}
    </>
  )
}

function QueueDetail({ projectId, stage }: { projectId: number; stage: WorkflowStatus }) {
  const { refresh, can } = useApp()
  const toast = useToast()
  const rows = useQuery(() => queueFor(projectId, stage), [projectId, stage])
  const [busy, setBusy] = useState<number | null>(null)
  const next = WORKFLOW_NEXT[stage]

  async function advance(id: number, code: string) {
    setBusy(id)
    try {
      await moveParticipant(id, next)
      toast('ok', `${code} sent to ${WORKFLOW_LABELS[next]}.`)
      refresh()
    } catch (err) {
      toast('danger', friendlyError(err, 'The participant could not be moved.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <button className="btn ghost small" onClick={() => navigate('/clinical')}>
        ‹ All stations
      </button>
      <h2 style={{ margin: '6px 0 2px', fontSize: 20 }}>{WORKFLOW_LABELS[stage]}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        {rows.length} participant{rows.length === 1 ? '' : 's'} at this station.
      </p>

      {rows.length === 0 ? (
        <EmptyState glyph="✓" title="This queue is empty" />
      ) : (
        <Card flush>
          {rows.map((p) => (
            <div key={p.id} className="list-item" style={{ cursor: 'default' }}>
              <span className="code-chip">{p.participant_code}</span>
              <span className="grow">
                <span className="primary">{fullName(p)}</span>
                <span className="secondary">
                  {labelFor(p.sex)}
                  {p.age_years !== null ? `, ${p.age_years} yrs` : ''} · waiting since{' '}
                  {formatDateTime(p.registered_at).split(', ')[1] ?? ''}
                </span>
              </span>
              <button className="btn small secondary" onClick={() => navigate(`/participant/${p.id}`)}>
                Open
              </button>
              {can(PERMISSIONS.QUEUE_MANAGE) && stage !== 'COMPLETED' ? (
                <button
                  className="btn small"
                  disabled={busy === p.id}
                  onClick={() => void advance(p.id, p.participant_code)}
                >
                  → {WORKFLOW_LABELS[next]}
                </button>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

function ReferralsPanel({ projectId, canUpdate }: { projectId: number; canUpdate: boolean }) {
  const { refresh } = useApp()
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [urgency, setUrgency] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [newStatus, setNewStatus] = useState('')
  const [note, setNote] = useState('')

  const rows = useQuery(
    () => listReferrals(projectId, { status, urgency, search }),
    [projectId, status, urgency, search],
  )
  const stats = useQuery(() => referralStats(projectId), [projectId])

  async function apply() {
    if (!editing) return
    try {
      await updateReferralStatus(editing, newStatus as 'ISSUED', note || undefined)
      toast('ok', 'Referral status updated.')
      refresh()
      setEditing(null)
      setNote('')
    } catch (err) {
      toast('danger', friendlyError(err, 'The status could not be updated.'))
    }
  }

  return (
    <>
      <div className="stat-grid">
        <Stat label="Total referrals" value={stats.total} />
        <Stat label="Urgent or emergency" value={stats.urgent} tone={stats.urgent > 0 ? 'danger' : undefined} />
      </div>

      <div className="field">
        <input
          type="search"
          placeholder="Search by participant or referral ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search referrals"
        />
      </div>
      <div className="row">
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          placeholder="Any status"
          options={REFERRAL_STATUSES.map((s) => ({ value: s, label: labelFor(s) }))}
        />
        <SelectField
          label="Urgency"
          value={urgency}
          onChange={setUrgency}
          placeholder="Any urgency"
          options={REFERRAL_URGENCIES.map((s) => ({ value: s, label: labelFor(s) }))}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState glyph="□" title="No referrals match" />
      ) : (
        <Card flush>
          {rows.map((r) => (
            <div key={r.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
              <span className="grow">
                <span className="primary">
                  {r.participant_code} — {r.first_name} {r.last_name}
                </span>
                <span className="secondary">{r.reason}</span>
                <span className="secondary">
                  {r.facility_name ?? 'Destination not specified'} · {formatShortDate(r.referral_date)}
                </span>
                <span style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <Badge tone={r.urgency === 'ROUTINE' ? 'info' : r.urgency === 'PRIORITY' ? 'warn' : 'danger'}>
                    {labelFor(r.urgency)}
                  </Badge>
                  <Badge tone={r.status === 'COMPLETED' || r.status === 'ATTENDED' ? 'ok' : 'muted'}>
                    {labelFor(r.status)}
                  </Badge>
                </span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="btn small secondary" onClick={() => navigate(`/participant/${r.participant_id}`)}>
                  Open
                </button>
                {canUpdate ? (
                  <button
                    className="btn small"
                    onClick={() => {
                      setEditing(r.id)
                      setNewStatus(r.status)
                    }}
                  >
                    Status
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </Card>
      )}

      {editing ? (
        <Modal title="Update referral status" onClose={() => setEditing(null)}>
          <SelectField
            label="Status"
            value={newStatus}
            onChange={setNewStatus}
            options={REFERRAL_STATUSES.map((s) => ({ value: s, label: labelFor(s) }))}
          />
          <TextArea label="Note (optional)" value={note} onChange={setNote} />
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn" onClick={apply}>
              Save
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

function FollowupPanel({ projectId, canManage }: { projectId: number; canManage: boolean }) {
  const { refresh } = useApp()
  const toast = useToast()
  const [outcome, setOutcome] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [editing, setEditing] = useState<FollowupWithParticipant | null>(null)

  const stats = useQuery(() => followupStats(projectId), [projectId])
  const rows = useQuery(
    () => listFollowups(projectId, { outcome, overdueOnly }),
    [projectId, outcome, overdueOnly],
  )

  return (
    <>
      <div className="stat-grid">
        <Stat label="Total referrals" value={stats.total} />
        <Stat label="Contacted" value={stats.contacted} />
        <Stat label="Attended facility" value={stats.attended} tone="ok" />
        <Stat label="Pending" value={stats.pending} tone={stats.pending > 0 ? 'warn' : undefined} />
        <Stat label="Unreachable" value={stats.unreachable} />
        <Stat label="Completed" value={stats.completed} tone="ok" />
      </div>

      {stats.overdue > 0 ? (
        <AlertBox tone="warn" title={`${stats.overdue} follow-up${stats.overdue === 1 ? ' is' : 's are'} overdue`}>
          Contact these participants as soon as possible.
        </AlertBox>
      ) : null}

      <div className="row">
        <SelectField
          label="Outcome"
          value={outcome}
          onChange={setOutcome}
          placeholder="Any outcome"
          options={FOLLOWUP_OUTCOMES.map((o) => ({ value: o, label: labelFor(o) }))}
        />
      </div>
      <Toggle label="Show overdue only" checked={overdueOnly} onChange={setOverdueOnly} />

      {rows.length === 0 ? (
        <EmptyState glyph="✓" title="Nothing in the follow-up queue" />
      ) : (
        <Card flush>
          {rows.map((f) => {
            const overdue =
              f.due_date &&
              f.due_date < today() &&
              !['COMPLETED', 'DECLINED'].includes(f.outcome)
            return (
              <div key={f.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <span className="grow">
                  <span className="primary">
                    {f.participant_code} — {f.first_name} {f.last_name}
                  </span>
                  <span className="secondary">{f.reason ?? 'Follow-up required'}</span>
                  <span className="secondary">
                    Due {formatShortDate(f.due_date)}
                    {overdue ? ` · ${daysBetween(f.due_date!, today())} days overdue` : ''}
                    {f.contact_attempts > 0 ? ` · ${f.contact_attempts} contact attempt${f.contact_attempts === 1 ? '' : 's'}` : ''}
                  </span>
                  <span style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <Badge tone={f.outcome === 'COMPLETED' ? 'ok' : overdue ? 'danger' : 'warn'}>
                      {labelFor(f.outcome)}
                    </Badge>
                    {f.urgency ? <Badge tone="info">{labelFor(f.urgency)}</Badge> : null}
                  </span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {f.phone ? (
                    <a className="btn small secondary" href={`tel:${f.phone}`}>
                      Call
                    </a>
                  ) : null}
                  {canManage ? (
                    <button className="btn small" onClick={() => setEditing(f)}>
                      Update
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </Card>
      )}

      {editing ? (
        <FollowupEditor
          followup={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
            toast('ok', 'Follow-up updated.')
          }}
        />
      ) : null}
    </>
  )
}

function FollowupEditor({
  followup,
  onClose,
  onSaved,
}: {
  followup: FollowupWithParticipant
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [outcome, setOutcome] = useState(followup.outcome)
  const [method, setMethod] = useState(followup.contact_method ?? 'Telephone')
  const [facility, setFacility] = useState(followup.facility_attended ?? '')
  const [treatment, setTreatment] = useState(followup.further_treatment ?? '')
  const [nextDate, setNextDate] = useState(followup.next_followup_date ?? '')
  const [notes, setNotes] = useState('')
  const [attempt, setAttempt] = useState(true)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await updateFollowup(followup.id, {
        outcome,
        contactMethod: method,
        facilityAttended: facility,
        furtherTreatment: treatment,
        nextFollowupDate: nextDate,
        notes,
        recordContactAttempt: attempt,
      })
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The follow-up could not be updated.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Update follow-up"
      subtitle={`${followup.participant_code} · ${followup.first_name} ${followup.last_name}`}
      onClose={onClose}
    >
      <KeyValue k="Telephone" v={followup.phone ?? 'Not recorded'} />
      <KeyValue k="Referral" v={followup.referral_code ?? 'Not linked to a referral'} />
      <KeyValue k="Due" v={formatShortDate(followup.due_date)} />

      <div style={{ height: 12 }} />
      <SelectField
        label="Outcome"
        value={outcome}
        onChange={setOutcome}
        options={FOLLOWUP_OUTCOMES.map((o) => ({ value: o, label: labelFor(o) }))}
      />
      <Toggle label="Record a contact attempt now" checked={attempt} onChange={setAttempt} />
      <TextField label="Contact method" value={method} onChange={setMethod} />
      <TextField label="Facility attended" value={facility} onChange={setFacility} />
      <TextArea label="Further treatment received" value={treatment} onChange={setTreatment} />
      <TextField label="Next follow-up date" type="date" value={nextDate} onChange={setNextDate} />
      <TextArea label="Notes to add" value={notes} onChange={setNotes} />

      <div className="btn-row">
        <button className="btn secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save follow-up'}
        </button>
      </div>
    </Modal>
  )
}

function UrgentPanel({ projectId }: { projectId: number }) {
  const alerts = useQuery(() => urgentAlerts(projectId, 100), [projectId])
  if (alerts.length === 0) {
    return <EmptyState glyph="✓" title="No urgent screening alerts" />
  }
  return (
    <>
      <AlertBox tone="danger" title={`${alerts.length} urgent screening alert${alerts.length === 1 ? '' : 's'}`}>
        These participants recorded a screening measurement at or above the configured urgent
        threshold. Each needs clinical assessment. This is not a diagnosis.
      </AlertBox>
      <Card flush>
        {alerts.map((a, i) => (
          <button
            key={`${a.participant_id}-${i}`}
            className="list-item"
            onClick={() => navigate(`/participant/${a.participant_id}`)}
          >
            <span className="code-chip">{a.participant_code}</span>
            <span className="grow">
              <span className="primary">{a.source}</span>
              <span className="secondary">{a.alert_message}</span>
              <span className="secondary">{formatDateTime(a.occurred_at)}</span>
            </span>
            <span className="chevron" aria-hidden="true">›</span>
          </button>
        ))}
      </Card>
    </>
  )
}
