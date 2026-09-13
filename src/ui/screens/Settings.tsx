/** Settings: project, clinical configuration, users, stations, facilities,
 *  backup, audit, security, demonstration data, storage and About
 *  (spec S49-S51, S61, S69-S72, S85, S86). */
import { useEffect, useState } from 'react'
import { useApp, useQuery, useStorageInfo } from '../AppState'
import {
  AlertBox,
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  KeyValue,
  Modal,
  NumberField,
  SelectField,
  Stat,
  Tabs,
  TextArea,
  TextField,
  Toggle,
  friendlyError,
  useToast,
} from '../components/ui'
import { ChangeOwnPin, PassphrasePrompt } from './Onboarding'
import {
  createStation,
  deleteStation,
  getProject,
  listStations,
  setProjectStatus,
  updateProject,
} from '../../db/repo/projects'
import {
  clinicalConfigProvenance,
  getSetting,
  listThresholdRows,
  resetThresholdsToDefault,
  setSetting,
  updateThreshold,
} from '../../db/repo/settings'
import {
  createUser,
  deactivateUser,
  listUsers,
  resetPin,
  updateUser,
  type User,
} from '../../db/repo/users'
import { deleteFacility, listFacilities, saveFacility, type Facility } from '../../db/repo/referrals'
import { listAudit, distinctAuditActions, auditCount } from '../../core/audit'
import {
  backupStatus,
  cloudBackupEnabled,
  createBackup,
  lastCloudBackupAt,
  listBackups,
  restoreBackup,
} from '../../services/backup'
import { cloudSignIn, defaultEndpoint, probeCloud } from '../../services/cloudAuth'
import { AccountRequests } from './AccountRequests'
import { checkForUpdate, platform, type UpdateState } from '../../services/appUpdate'
import { enqueueAllPhotos, photoSyncEnabled } from '../../db/repo/base'
import { photoBytes, photoCount } from '../../db/repo/photos'
import {
  downloadCloudBackup,
  listCloudBackups,
  type CloudBackupEntry,
} from '../../services/cloudBackup'
import {
  isSyncConfigured,
  recentSyncRuns,
  runSync,
  saveSyncConfig,
  syncConfig,
  syncStatus,
} from '../../services/sync'
import { SERIAL_BLOCK_SIZE, serialRange } from '../../core/constants'
import { deviceId } from '../../core/ids'
import { clearDemoData, demoRecordCount, generateDemoData } from '../../services/demoData'
import { pickFile, formatBytes, saveLocationLabel } from '../../services/fileIo'
import { integrityCheck, foreignKeyCheck, flush, transaction } from '../../db/sqlite'
import { currentSchemaVersion } from '../../db/migrations'
import { storageInfo } from '../../db/persistence'
import { ROLE_DEFINITIONS, PERMISSIONS, roleName, type RoleCode } from '../../core/permissions'
import {
  APP_BUILD,
  APP_NAME,
  APP_VERSION,
  FACILITY_TYPES,
  PROJECT_STATUSES,
  SESSION_TIMEOUTS,
  SETTING_KEYS,
  WORKFLOW_STATUSES,
  WORKFLOW_LABELS,
  labelFor,
} from '../../core/constants'
import { validatePin } from '../../core/validation'
import { formatDateTime, relativeDateTime } from '../../core/datetime'

type Tab =
  | 'PROJECT'
  | 'CLINICAL'
  | 'USERS'
  | 'STATIONS'
  | 'FACILITIES'
  | 'BACKUP'
  | 'SYNC'
  | 'SECURITY'
  | 'AUDIT'
  | 'DEMO'
  | 'ABOUT'

export function SettingsScreen() {
  const { can } = useApp()
  const [tab, setTab] = useState<Tab>('PROJECT')

  const tabs = ([
    { key: 'PROJECT', label: 'Project', show: can(PERMISSIONS.PROJECT_VIEW) },
    { key: 'CLINICAL', label: 'Clinical', show: can(PERMISSIONS.CONFIG_CLINICAL) },
    { key: 'USERS', label: 'Users', show: can(PERMISSIONS.USER_MANAGE) },
    { key: 'STATIONS', label: 'Stations', show: can(PERMISSIONS.SETTINGS_MANAGE) },
    { key: 'FACILITIES', label: 'Facilities', show: true },
    { key: 'BACKUP', label: 'Backup', show: can(PERMISSIONS.BACKUP_CREATE) },
    { key: 'SYNC', label: 'Cloud sync', show: can(PERMISSIONS.SETTINGS_MANAGE) },
    { key: 'SECURITY', label: 'Security', show: true },
    { key: 'AUDIT', label: 'Audit', show: can(PERMISSIONS.AUDIT_VIEW) },
    { key: 'DEMO', label: 'Demo data', show: can(PERMISSIONS.DEMO_MANAGE) },
    { key: 'ABOUT', label: 'About', show: true },
  ] as { key: Tab; label: string; show: boolean }[]).filter((t) => t.show)

  return (
    <>
      <Tabs active={tab} onChange={(k) => setTab(k as Tab)} tabs={tabs} />
      {tab === 'PROJECT' ? <ProjectSettings /> : null}
      {tab === 'CLINICAL' ? <ClinicalSettings /> : null}
      {tab === 'USERS' ? <UserSettings /> : null}
      {tab === 'STATIONS' ? <StationSettings /> : null}
      {tab === 'FACILITIES' ? <FacilitySettings /> : null}
      {tab === 'BACKUP' ? <BackupSettings /> : null}
      {tab === 'SYNC' ? <SyncSettings /> : null}
      {tab === 'SECURITY' ? <SecuritySettings /> : null}
      {tab === 'AUDIT' ? <AuditSettings /> : null}
      {tab === 'DEMO' ? <DemoSettings /> : null}
      {tab === 'ABOUT' ? <AboutSettings /> : null}
    </>
  )
}

// ------------------------------------------------------------- project

function ProjectSettings() {
  const { project, can, refresh, reloadProject } = useApp()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  if (!project) return <EmptyState glyph="□" title="No active project" />
  const editable = can(PERMISSIONS.PROJECT_EDIT)

  return (
    <>
      <Card title="Project">
        <KeyValue k="Name" v={project.name} />
        <KeyValue k="In memory of" v={project.memorial_honouree ?? '—'} />
        <KeyValue k="Location" v={project.location ?? '—'} />
        <KeyValue k="LGA" v={project.lga ?? '—'} />
        <KeyValue k="State" v={project.state ?? '—'} />
        <KeyValue k="Date" v={project.proposed_date ?? '—'} />
        <KeyValue k="Time" v={`${project.start_time ?? '—'} to ${project.end_time ?? '—'}`} />
        <KeyValue k="Expected participants" v={project.expected_participants} />
        <KeyValue k="Participant prefix" v={project.participant_prefix} />
        <KeyValue k="Project director" v={project.project_director ?? '—'} />
        <KeyValue k="Medical director" v={project.medical_director ?? '—'} />
        <KeyValue k="Status" v={<Badge tone="info">{labelFor(project.status)}</Badge>} />
        {editable ? (
          <button className="btn block secondary" style={{ marginTop: 12 }} onClick={() => setEditing(true)}>
            Edit project
          </button>
        ) : null}
      </Card>

      {editable ? (
        <Card title="Project status">
          <SelectField
            label="Change status"
            value={project.status}
            onChange={(v) => {
              setProjectStatus(project.id, v as 'PLANNING')
              reloadProject()
              refresh()
              toast('ok', `Project status set to ${labelFor(v)}.`)
            }}
            options={PROJECT_STATUSES.map((s) => ({ value: s, label: labelFor(s) }))}
          />
          <p className="hint">
            Setting the status to Active turns on the event-day dashboard regardless of the date.
          </p>
        </Card>
      ) : null}

      {editing ? (
        <Modal title="Edit project" onClose={() => setEditing(false)} wide>
          <ProjectForm
            onSaved={() => {
              setEditing(false)
              reloadProject()
              refresh()
              toast('ok', 'Project updated.')
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function ProjectForm({ onSaved }: { onSaved: () => void }) {
  const { project } = useApp()
  const toast = useToast()
  const p = useQuery(() => (project ? getProject(project.id) : null), [project?.id])
  const [form, setForm] = useState(() => ({
    name: p?.name ?? '',
    memorial_honouree: p?.memorial_honouree ?? '',
    location: p?.location ?? '',
    lga: p?.lga ?? '',
    state: p?.state ?? '',
    proposed_date: p?.proposed_date ?? '',
    end_date: p?.end_date ?? '',
    start_time: p?.start_time ?? '',
    end_time: p?.end_time ?? '',
    expected_participants: String(p?.expected_participants ?? 0),
    theme: p?.theme ?? '',
    objectives: p?.objectives ?? '',
    project_director: p?.project_director ?? '',
    medical_director: p?.medical_director ?? '',
    notes: p?.notes ?? '',
  }))
  const [busy, setBusy] = useState(false)

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function save() {
    if (!project) return
    setBusy(true)
    try {
      updateProject(project.id, {
        ...form,
        expected_participants: Number(form.expected_participants) || 0,
      } as never)
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The project could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TextField label="Project name" value={form.name} onChange={(v) => set('name', v)} required />
      <TextField label="In memory of" value={form.memorial_honouree} onChange={(v) => set('memorial_honouree', v)} />
      <TextField label="Location" value={form.location} onChange={(v) => set('location', v)} />
      <div className="row">
        <TextField label="LGA" value={form.lga} onChange={(v) => set('lga', v)} />
        <TextField label="State" value={form.state} onChange={(v) => set('state', v)} />
      </div>
      <div className="row">
        <TextField label="Start date" type="date" value={form.proposed_date} onChange={(v) => set('proposed_date', v)} />
        <TextField label="End date" type="date" value={form.end_date} onChange={(v) => set('end_date', v)} />
      </div>
      <div className="row">
        <TextField label="Start time" type="time" value={form.start_time} onChange={(v) => set('start_time', v)} />
        <TextField label="End time" type="time" value={form.end_time} onChange={(v) => set('end_time', v)} />
      </div>
      <NumberField
        label="Expected participants"
        value={form.expected_participants}
        onChange={(v) => set('expected_participants', v)}
      />
      <TextField label="Theme" value={form.theme} onChange={(v) => set('theme', v)} />
      <TextArea label="Objectives" value={form.objectives} onChange={(v) => set('objectives', v)} />
      <TextField label="Project director" value={form.project_director} onChange={(v) => set('project_director', v)} />
      <TextField label="Medical director" value={form.medical_director} onChange={(v) => set('medical_director', v)} />
      <TextArea label="Notes" value={form.notes} onChange={(v) => set('notes', v)} />
      <button className="btn block" onClick={save} disabled={busy || !form.name.trim()}>
        {busy ? 'Saving…' : 'Save project'}
      </button>
    </>
  )
}

// ------------------------------------------------------------ clinical

function ClinicalSettings() {
  const { refresh, reloadProject } = useApp()
  const toast = useToast()
  const rows = useQuery(() => listThresholdRows(), [])
  const provenance = useQuery(() => clinicalConfigProvenance(), [])
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [resetting, setResetting] = useState(false)

  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    const g = r.group_name ?? 'Other'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(r)
  }

  function save() {
    if (!editing) return
    try {
      updateThreshold(editing, Number(value))
      reloadProject()
      refresh()
      setEditing(null)
      toast('ok', 'Clinical threshold updated. The change has been recorded in the audit trail.')
    } catch (err) {
      toast('danger', friendlyError(err, 'The threshold could not be changed.'))
    }
  }

  return (
    <>
      <AlertBox tone="warn" title="Clinical governance">
        These thresholds decide when the application raises a screening alert or suggests a
        referral. Change them only under the authority of the medical director. Every change is
        recorded with the previous and new value.
      </AlertBox>

      <Card tight>
        <KeyValue k="Last modified by" v={provenance.by ?? 'Never changed'} />
        <KeyValue k="Last modified" v={provenance.at ? formatDateTime(provenance.at) : '—'} />
      </Card>

      {[...groups.entries()].map(([group, items]) => (
        <Card key={group} title={group} flush>
          {items.map((r) => (
            <button key={r.key} className="list-item" onClick={() => { setEditing(r.key); setValue(r.value) }}>
              <span className="grow">
                <span className="primary" style={{ whiteSpace: 'normal' }}>{r.label}</span>
                <span className="secondary" style={{ whiteSpace: 'normal' }}>{r.description}</span>
              </span>
              <span style={{ fontWeight: 800, fontSize: 17, whiteSpace: 'nowrap' }}>
                {r.value} <span style={{ fontSize: 12, fontWeight: 500 }}>{r.unit}</span>
              </span>
              <span className="chevron" aria-hidden="true">›</span>
            </button>
          ))}
        </Card>
      ))}

      <button className="btn block danger secondary" onClick={() => setResetting(true)}>
        Reset all thresholds to defaults
      </button>

      {editing ? (
        <Modal
          title="Change clinical threshold"
          subtitle={rows.find((r) => r.key === editing)?.label ?? undefined}
          onClose={() => setEditing(null)}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            {rows.find((r) => r.key === editing)?.description}
          </p>
          <NumberField
            label="Value"
            unit={rows.find((r) => r.key === editing)?.unit ?? ''}
            value={value}
            onChange={setValue}
            autoFocus
          />
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn" onClick={save} disabled={value === '' || Number.isNaN(Number(value))}>
              Save threshold
            </button>
          </div>
        </Modal>
      ) : null}

      {resetting ? (
        <ConfirmDialog
          title="Reset clinical thresholds?"
          message="All alert thresholds return to the values shipped with the application. Each change is recorded in the audit trail."
          destructive
          confirmLabel="Reset thresholds"
          onCancel={() => setResetting(false)}
          onConfirm={() => {
            resetThresholdsToDefault()
            reloadProject()
            refresh()
            setResetting(false)
            toast('ok', 'Clinical thresholds reset to defaults.')
          }}
        />
      ) : null}
    </>
  )
}

// --------------------------------------------------------------- users

function UserSettings() {
  const { user: currentUser, refresh } = useApp()
  const toast = useToast()
  const users = useQuery(() => listUsers(), [])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)

  return (
    <>
      <AccountRequests />

      <button className="btn block" onClick={() => setAdding(true)}>
        Add user account
      </button>

      <Card flush>
        {users.map((u) => (
          <div key={u.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
            <span className="grow">
              <span className="primary">{u.full_name}</span>
              <span className="secondary">
                {u.username} · {roleName(u.role_code)}
              </span>
              <span className="secondary">
                {u.last_login_at ? `Last signed in ${relativeDateTime(u.last_login_at)}` : 'Never signed in'}
              </span>
              <span style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <Badge tone={u.is_active ? 'ok' : 'muted'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
                {u.must_change_pin ? <Badge tone="warn">Must change PIN</Badge> : null}
                {u.locked_until ? <Badge tone="danger">Locked</Badge> : null}
                {u.id === currentUser?.id ? <Badge tone="info">You</Badge> : null}
              </span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button className="btn small secondary" onClick={() => setEditing(u)}>
                Edit
              </button>
              {u.id !== currentUser?.id ? (
                <button className="btn small ghost" onClick={() => setDeleting(u)}>
                  Remove
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </Card>

      <Card title="Roles and what they can do">
        {ROLE_DEFINITIONS.map((r) => (
          <KeyValue key={r.code} k={r.name} v={<span style={{ fontWeight: 400, fontSize: 13 }}>{r.description}</span>} />
        ))}
      </Card>

      {adding || editing ? (
        <Modal
          title={adding ? 'Add user account' : 'Edit user account'}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
        >
          <UserForm
            user={editing}
            onSaved={() => {
              setAdding(false)
              setEditing(null)
              refresh()
              toast('ok', 'User account saved.')
            }}
          />
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Remove ${deleting.full_name}?`}
          message="The account is deactivated and can no longer sign in. Records they created are kept, and the audit trail still shows their name."
          destructive
          confirmLabel="Remove account"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await deactivateUser(deleting.id)
              refresh()
              toast('ok', 'User account removed.')
            } catch (err) {
              toast('danger', friendlyError(err, 'The account could not be removed.'))
            } finally {
              setDeleting(null)
            }
          }}
        />
      ) : null}
    </>
  )
}

function UserForm({ user, onSaved }: { user: User | null; onSaved: () => void }) {
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [role, setRole] = useState<RoleCode>(user?.role_code ?? 'VOLUNTEER')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [pin, setPin] = useState('')
  const [active, setActive] = useState(user ? Boolean(user.is_active) : true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    setBusy(true)
    try {
      if (user) {
        await updateUser(user.id, { fullName, role, phone, isActive: active })
        if (pin) {
          const v = validatePin(pin)
          if (!v.ok) {
            setError(v.message ?? null)
            return
          }
          await resetPin(user.id, pin)
        }
      } else {
        const v = validatePin(pin)
        if (!v.ok) {
          setError(v.message ?? null)
          return
        }
        await createUser({
          username,
          fullName,
          role,
          pin,
          phone,
          mustChangePin: true,
        })
      }
      onSaved()
    } catch (err) {
      setError(friendlyError(err, 'The account could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TextField label="Full name" value={fullName} onChange={setFullName} required autoFocus />
      <TextField
        label="Username"
        value={username}
        onChange={setUsername}
        required
        help={user ? 'The username cannot be changed.' : undefined}
      />
      <SelectField
        label="Role"
        value={role}
        onChange={(v) => setRole(v as RoleCode)}
        options={ROLE_DEFINITIONS.map((r) => ({ value: r.code, label: r.name }))}
        help={ROLE_DEFINITIONS.find((r) => r.code === role)?.description}
      />
      <TextField label="Telephone" value={phone} onChange={setPhone} type="tel" inputMode="tel" />
      <TextField
        label={user ? 'Reset PIN (leave blank to keep)' : 'Initial PIN'}
        value={pin}
        onChange={setPin}
        type="password"
        inputMode="numeric"
        maxLength={12}
        help="The user is asked to choose their own PIN at first sign-in."
      />
      {user ? <Toggle label="Account active" checked={active} onChange={setActive} /> : null}
      {error ? <AlertBox tone="danger" title="Could not save">{error}</AlertBox> : null}
      <button
        className="btn block"
        onClick={save}
        disabled={busy || !fullName.trim() || !username.trim() || (!user && !pin)}
      >
        {busy ? 'Saving…' : 'Save account'}
      </button>
    </>
  )
}

// ------------------------------------------------------------ stations

function StationSettings() {
  const { project, refresh } = useApp()
  const toast = useToast()
  const stations = useQuery(() => (project ? listStations(project.id, false) : []), [project?.id])
  const [adding, setAdding] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [stage, setStage] = useState('VITALS')

  if (!project) return null

  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        Stations map the physical desks at the venue onto the stages of the participant journey.
      </p>
      <button className="btn block" onClick={() => setAdding(true)}>
        Add station
      </button>

      <Card flush>
        {stations.map((s) => (
          <div key={s.id} className="list-item" style={{ cursor: 'default' }}>
            <span className="code-chip">{s.code}</span>
            <span className="grow">
              <span className="primary">{s.name}</span>
              <span className="secondary">Stage: {WORKFLOW_LABELS[s.stage as 'VITALS'] ?? s.stage}</span>
            </span>
            <button
              className="btn small ghost"
              onClick={() => {
                deleteStation(s.id)
                refresh()
                toast('ok', 'Station removed.')
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </Card>

      {adding ? (
        <Modal title="Add station" onClose={() => setAdding(false)}>
          <TextField label="Short code" value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={4} required />
          <TextField label="Station name" value={name} onChange={setName} required />
          <SelectField
            label="Stage"
            value={stage}
            onChange={setStage}
            options={WORKFLOW_STATUSES.map((s) => ({ value: s, label: WORKFLOW_LABELS[s] }))}
          />
          <button
            className="btn block"
            disabled={!code.trim() || !name.trim()}
            onClick={() => {
              try {
                createStation(project.id, { code, name, stage })
                refresh()
                setAdding(false)
                setCode('')
                setName('')
                toast('ok', 'Station added.')
              } catch (err) {
                toast('danger', friendlyError(err, 'The station could not be added.'))
              }
            }}
          >
            Add station
          </button>
        </Modal>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------- facilities

function FacilitySettings() {
  const { project, can, refresh } = useApp()
  const toast = useToast()
  const facilities = useQuery(() => listFacilities(), [])
  const [editing, setEditing] = useState<Facility | 'NEW' | null>(null)
  const editable = can(PERMISSIONS.SETTINGS_MANAGE) || can(PERMISSIONS.REFERRAL_CREATE)

  return (
    <>
      <AlertBox tone="info" title="This directory works offline">
        Referral destinations are stored on this device so a referral can be issued with no
        connection.
      </AlertBox>

      {editable ? (
        <button className="btn block" onClick={() => setEditing('NEW')}>
          Add referral facility
        </button>
      ) : null}

      {facilities.length === 0 ? (
        <EmptyState glyph="□" title="No referral facilities saved" />
      ) : (
        <Card flush>
          {facilities.map((f) => (
            <div key={f.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
              <span className="grow">
                <span className="primary">{f.name}</span>
                <span className="secondary">
                  {f.facility_type ?? ''}
                  {f.location ? ` · ${f.location}` : ''}
                </span>
                {f.phone ? <span className="secondary">{f.phone}</span> : null}
                {f.services ? <span className="secondary" style={{ whiteSpace: 'normal' }}>{f.services}</span> : null}
              </span>
              {editable ? (
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button className="btn small secondary" onClick={() => setEditing(f)}>
                    Edit
                  </button>
                  <button
                    className="btn small ghost"
                    onClick={() => {
                      deleteFacility(f.id)
                      refresh()
                      toast('ok', 'Facility removed.')
                    }}
                  >
                    Remove
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </Card>
      )}

      {editing ? (
        <Modal title="Referral facility" onClose={() => setEditing(null)}>
          <FacilityForm
            facility={editing === 'NEW' ? null : editing}
            projectId={project?.id ?? null}
            onSaved={() => {
              setEditing(null)
              refresh()
              toast('ok', 'Facility saved.')
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function FacilityForm({
  facility,
  projectId,
  onSaved,
}: {
  facility: Facility | null
  projectId: number | null
  onSaved: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(facility?.name ?? '')
  const [type, setType] = useState(facility?.facility_type ?? FACILITY_TYPES[0])
  const [location, setLocation] = useState(facility?.location ?? '')
  const [phone, setPhone] = useState(facility?.phone ?? '')
  const [contact, setContact] = useState(facility?.contact_person ?? '')
  const [services, setServices] = useState(facility?.services ?? '')
  const [notes, setNotes] = useState(facility?.notes ?? '')

  function save() {
    try {
      saveFacility(
        {
          name,
          facility_type: type,
          location,
          phone,
          contact_person: contact,
          services,
          notes,
          project_id: projectId,
        },
        facility?.id,
      )
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The facility could not be saved.'))
    }
  }

  return (
    <>
      <TextField label="Facility name" value={name} onChange={setName} required autoFocus />
      <SelectField
        label="Type"
        value={type}
        onChange={setType}
        options={FACILITY_TYPES.map((t) => ({ value: t, label: t }))}
      />
      <TextField label="Location" value={location} onChange={setLocation} />
      <TextField label="Telephone" value={phone} onChange={setPhone} type="tel" inputMode="tel" />
      <TextField label="Contact person" value={contact} onChange={setContact} />
      <TextArea label="Services available" value={services} onChange={setServices} />
      <TextArea label="Referral notes" value={notes} onChange={setNotes} />
      <button className="btn block" onClick={save} disabled={!name.trim()}>
        Save facility
      </button>
    </>
  )
}

// -------------------------------------------------------------- backup

/**
 * The off-site copy.
 *
 * A backup on the phone that took it survives a corrupted database. It does
 * not survive the phone being lost, stolen or dropped in water, which on a
 * field outreach is the likelier of the two.
 */
function CloudBackupCard() {
  const { can, refresh, reloadProject } = useApp()
  const toast = useToast()
  const enabled = useQuery(() => cloudBackupEnabled(), [])
  const lastAt = useQuery(() => lastCloudBackupAt(), [])
  const configured = useQuery(() => isSyncConfigured(), [])

  const [remote, setRemote] = useState<CloudBackupEntry[] | null>(null)
  const [busy, setBusy] = useState('')
  const [restoring, setRestoring] = useState<CloudBackupEntry | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadList() {
    setBusy('Looking for backups in the cloud…')
    setError(null)
    try {
      setRemote(await listCloudBackups())
    } catch (err) {
      setError(friendlyError(err, 'The list could not be fetched.'))
    } finally {
      setBusy('')
    }
  }

  if (!configured) {
    return (
      <Card title="Off-site copy">
        <AlertBox tone="muted" title="Not available yet">
          This device is not connected to the cloud. Set the web address under Cloud sync first;
          then every backup can also be kept off the device.
        </AlertBox>
      </Card>
    )
  }

  return (
    <>
      <Card title="Off-site copy">
        <Toggle
          label="Also keep each backup in the cloud"
          checked={enabled}
          onChange={(v) => {
            void transaction(() => setSetting('backup.cloud_enabled', v ? 'true' : 'false'))
            refresh()
          }}
          help="The file is encrypted on this device before it is sent. The server never sees the password and cannot open it."
        />
        <KeyValue k="Last cloud copy" v={lastAt ? relativeDateTime(lastAt) : 'Never'} />

        <AlertBox tone="warn" title="The password is the whole protection">
          A cloud copy nobody can decrypt is not a backup. Write the backup password down and keep
          it somewhere other than the phone — there is no way to recover it.
        </AlertBox>

        <button className="btn block secondary" onClick={() => void loadList()} disabled={!!busy}>
          {busy || 'Show backups in the cloud'}
        </button>
        {error ? <AlertBox tone="danger" title="Could not reach the cloud">{error}</AlertBox> : null}
      </Card>

      {remote ? (
        <Card title={`In the cloud (${remote.length})`}>
          {remote.length === 0 ? (
            <p className="hint" style={{ marginTop: 0 }}>
              No backups have been uploaded yet. Turn the setting above on and take a backup.
            </p>
          ) : (
            remote.map((b) => (
              <div key={b.uuid} className="list-item" style={{ cursor: 'default' }}>
                <span className="grow">
                  <span className="primary">{formatDateTime(b.createdAt)}</span>
                  <span className="secondary">
                    {formatBytes(b.sizeBytes)} · from device {b.deviceId.slice(0, 8)}
                    {b.createdBy ? ` · ${b.createdBy}` : ''}
                  </span>
                </span>
                {can(PERMISSIONS.BACKUP_RESTORE) ? (
                  <button className="btn small secondary" onClick={() => setRestoring(b)}>
                    Restore
                  </button>
                ) : null}
              </div>
            ))
          )}
        </Card>
      ) : null}

      {restoring ? (
        <Modal title="Restore from the cloud" onClose={() => setRestoring(null)}>
          <AlertBox tone="danger" title="This replaces everything on this device">
            Every record currently on this device is replaced by the contents of that backup.
            Anything registered since it was taken and not yet synchronised will be lost.
          </AlertBox>
          <PassphrasePrompt
            description={`Enter the password used when that backup was made on ${formatDateTime(
              restoring.createdAt,
            )}.`}
            confirmLabel="Download and restore"
            onCancel={() => setRestoring(null)}
            onSubmit={async (pass) => {
              const bytes = await downloadCloudBackup(restoring)
              await restoreBackup(bytes, pass, restoring.filename)
              await flush()
              await reloadProject()
              refresh()
              toast('ok', 'The database was restored from the cloud copy.')
              setRestoring(null)
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}


function BackupSettings() {
  const { can, refresh, reloadProject } = useApp()
  const toast = useToast()
  const status = useQuery(() => backupStatus(), [])
  const history = useQuery(() => listBackups(15), [])
  const storage = useStorageInfo()
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)

  async function chooseRestoreFile() {
    const file = await pickFile(
      { 'application/octet-stream': ['.nugbak', '.sqlite', '.db'] },
      'Outreach backup',
    )
    if (file) {
      setRestoreFile(file)
      setConfirmRestore(true)
    }
  }

  return (
    <>
      <Card title="Backup status">
        <KeyValue k="Last backup" v={status.label} />
        <KeyValue
          k="Status"
          v={
            <Badge tone={status.freshness === 'CURRENT' ? 'ok' : status.freshness === 'DUE' ? 'warn' : 'danger'}>
              {labelFor(status.freshness)}
            </Badge>
          }
        />
        <KeyValue k="Database size" v={formatBytes(storage.sizeBytes)} />
      </Card>

      <AlertBox tone="info" title="Backups are encrypted">
        The backup file is sealed with a password you choose. Without that password the file cannot
        be opened — keep it somewhere safe. Files are saved to {saveLocationLabel()}.
      </AlertBox>

      <button className="btn block large" onClick={() => setCreating(true)}>
        Back up database
      </button>

      {can(PERMISSIONS.BACKUP_RESTORE) ? (
        <>
          <div style={{ height: 10 }} />
          <button className="btn block secondary" onClick={chooseRestoreFile}>
            Restore database
          </button>
        </>
      ) : null}

      <CloudBackupCard />

      {history.length ? (
        <Card title="Backups made from this device">
          {history.map((b) => (
            <KeyValue
              key={b.id}
              k={`${formatDateTime(b.created_at)} · ${labelFor(b.kind)}`}
              v={`${b.filename} (${formatBytes(Number(b.size_bytes ?? 0))})`}
            />
          ))}
          <p className="hint">
            This list records that a backup was made. The files themselves are wherever you saved
            them on this device.
          </p>
        </Card>
      ) : null}

      {creating ? (
        <Modal title="Back up database" onClose={() => setCreating(false)}>
          <PassphrasePrompt
            description="Choose a password to encrypt this backup. You will need it to restore."
            confirmLabel="Create backup"
            requireConfirm
            onCancel={() => setCreating(false)}
            onSubmit={async (pass) => {
              const r = await createBackup(pass, 'MANUAL')
              const where = r.location ? ` in ${r.location}.` : '.'
              if (r.cloud?.uploaded) {
                toast(
                  'ok',
                  `Backup saved as ${r.filename} (${formatBytes(r.sizeBytes)})${where} A copy is also in the cloud.`,
                )
              } else if (r.cloud) {
                // The file on this device is written and valid; only the
                // off-site copy failed, and saying so plainly matters.
                toast(
                  'warn',
                  `Backup saved on this device as ${r.filename}, but the cloud copy failed: ${r.cloud.error}`,
                )
              } else {
                toast('ok', `Backup saved as ${r.filename} (${formatBytes(r.sizeBytes)})${where}`)
              }
              refresh()
              setCreating(false)
            }}
          />
        </Modal>
      ) : null}

      {confirmRestore && restoreFile ? (
        <Modal title="Restore database" onClose={() => setConfirmRestore(false)}>
          <AlertBox tone="danger" title="Restoring replaces the data on this device">
            Everything currently stored here will be replaced by the contents of{' '}
            {restoreFile.name}. Create a backup of the current data first if you have not already.
          </AlertBox>
          <PassphrasePrompt
            description="Enter the backup password for this file. Leave blank for an unencrypted database file."
            confirmLabel="Restore now"
            onCancel={() => setConfirmRestore(false)}
            onSubmit={async (pass) => {
              setRestoring(true)
              try {
                const { counts } = await restoreBackup(restoreFile, pass || null)
                await flush()
                reloadProject()
                refresh()
                setConfirmRestore(false)
                toast(
                  'ok',
                  `Database restored: ${counts.participants ?? 0} participants, ${counts.referrals ?? 0} referrals.`,
                )
              } finally {
                setRestoring(false)
              }
            }}
          />
          {restoring ? <p className="hint">Restoring…</p> : null}
        </Modal>
      ) : null}
    </>
  )
}

// ------------------------------------------------------------ security

function SecuritySettings() {
  const { refresh, user } = useApp()
  const toast = useToast()
  const timeout = useQuery(() => getSetting(SETTING_KEYS.SESSION_TIMEOUT_MINUTES) ?? '5', [])
  const reminder = useQuery(() => getSetting(SETTING_KEYS.BACKUP_REMINDER_HOURS) ?? '12', [])
  const [changingPin, setChangingPin] = useState(false)
  const [largeText, setLargeText] = useState(() => document.body.classList.contains('large-text'))
  const [highContrast, setHighContrast] = useState(() =>
    document.body.classList.contains('high-contrast'),
  )

  return (
    <>
      <div className="security-note">
        This device contains confidential health information. Do not share your device, application
        PIN or backup files with unauthorised persons.
      </div>

      <Card title="Signed in as">
        <KeyValue k="Name" v={user?.full_name ?? ''} />
        <KeyValue k="Username" v={user?.username ?? ''} />
        <KeyValue k="Role" v={roleName(user?.role_code ?? '')} />
        <button className="btn block secondary" style={{ marginTop: 12 }} onClick={() => setChangingPin(true)}>
          Change my PIN
        </button>
      </Card>

      <Card title="Application lock">
        <SelectField
          label="Lock after inactivity"
          value={timeout}
          onChange={(v) => {
            setSetting(SETTING_KEYS.SESSION_TIMEOUT_MINUTES, v)
            refresh()
            toast('ok', 'Lock timeout updated.')
          }}
          options={SESSION_TIMEOUTS.map((t) => ({ value: String(t.minutes), label: t.label }))}
        />
        <SelectField
          label="Remind me to back up after"
          value={reminder}
          onChange={(v) => {
            setSetting(SETTING_KEYS.BACKUP_REMINDER_HOURS, v)
            refresh()
            toast('ok', 'Backup reminder updated.')
          }}
          options={[
            { value: '4', label: '4 hours' },
            { value: '12', label: '12 hours' },
            { value: '24', label: '24 hours' },
          ]}
        />
      </Card>

      <Card title="Accessibility">
        <Toggle
          label="Larger text"
          checked={largeText}
          onChange={(v) => {
            setLargeText(v)
            document.body.classList.toggle('large-text', v)
            localStorage.setItem('nug.largeText', String(v))
          }}
        />
        <Toggle
          label="High contrast"
          checked={highContrast}
          onChange={(v) => {
            setHighContrast(v)
            document.body.classList.toggle('high-contrast', v)
            localStorage.setItem('nug.highContrast', String(v))
          }}
        />
      </Card>

      {changingPin ? (
        <Modal title="Change my PIN" onClose={() => setChangingPin(false)}>
          <ChangeOwnPin onDone={() => setChangingPin(false)} />
        </Modal>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------- cloud sync

/**
 * Connecting an already-running device to the cloud.
 *
 * The device key is a shared secret. Typing a 32-character secret onto a
 * phone keyboard, from a note somebody read out, is how secrets end up
 * written on the back of the phone. Signing in fetches it instead — the same
 * exchange a new device makes — and reserves this device its own
 * participant-number block at the same time.
 */
function ConnectToCloud({ endpoint, onConnected }: { endpoint: string; onConnected: () => void }) {
  const toast = useToast()
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const credentials = await cloudSignIn(endpoint, username, pin, deviceId())
      await transaction(() => {
        saveSyncConfig({
          endpoint: endpoint.trim(),
          token: credentials.syncToken,
          serialBlock: credentials.serialBlock,
          enabled: true,
        })
      })
      toast('ok', `Connected as ${credentials.user.fullName}. This device is ready to sync.`)
      onConnected()
    } catch (err) {
      setError(friendlyError(err, 'This device could not be connected.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TextField label="Your username" value={username} onChange={setUsername} autoFocus />
      <TextField
        label="Your PIN"
        value={pin}
        onChange={setPin}
        type="password"
        inputMode="numeric"
        maxLength={12}
      />
      {error ? <AlertBox tone="danger" title="Could not connect">{error}</AlertBox> : null}
      <button
        className="btn block large"
        onClick={() => void connect()}
        disabled={busy || !username.trim() || !pin}
      >
        {busy ? 'Connecting…' : 'Connect this device'}
      </button>
      <p className="hint">
        Your account is checked against the outreach in the cloud. The device key and this device’s
        participant-number block arrive with the answer — there is nothing to type in by hand.
      </p>
    </>
  )
}

function SyncSettings() {
  const { refresh, online } = useApp()
  const toast = useToast()
  const config = useQuery(() => syncConfig(), [])
  const status = useQuery(() => syncStatus(), [])
  const runs = useQuery(() => recentSyncRuns(8), [])

  const [endpoint, setEndpoint] = useState(config.endpoint || defaultEndpoint())
  const [token, setToken] = useState(config.token)
  const [block, setBlock] = useState(String(config.serialBlock))
  const [busy, setBusy] = useState(false)
  const [clash, setClash] = useState(false)
  const [manualKey, setManualKey] = useState(false)
  // null while we are still asking; false means the cloud is reachable but
  // holds no outreach yet, which is what makes this the first device.
  const [cloudReady, setCloudReady] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const address = endpoint || defaultEndpoint()
    if (!address) {
      setCloudReady(null)
      return
    }
    probeCloud(address).then((r) => {
      if (!cancelled) setCloudReady(r.reachable ? r.ready : null)
    })
    return () => {
      cancelled = true
    }
  }, [endpoint])
  const photoSync = useQuery(() => photoSyncEnabled(), [])
  const photoStats = useQuery(() => ({ count: photoCount(), bytes: photoBytes() }), [])

  const range = serialRange(Number(block) || 0)

  function save() {
    try {
      saveSyncConfig({
        endpoint,
        token,
        serialBlock: Number(block) || 0,
        enabled: endpoint.trim() !== '' && token.trim() !== '',
      })
      refresh()
      toast('ok', 'Cloud settings saved.')
    } catch (err) {
      toast('danger', friendlyError(err, 'The settings could not be saved.'))
    }
  }

  async function sync() {
    setBusy(true)
    try {
      const result = await runSync()
      refresh()
      setClash(result.blockConflict)
      toast(
        'ok',
        `Synchronised: ${result.pushed} sent, ${result.pulled} received` +
          (result.pendingAfter > 0 ? `, ${result.pendingAfter} still waiting.` : '.'),
      )
    } catch (err) {
      toast('danger', friendlyError(err, 'Synchronisation could not be completed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {clash ? (
        <AlertBox tone="danger" title="Two devices share a number block">
          Another device is already issuing participant numbers from block {block}. Both will give
          the same number to different people, and that cannot be corrected afterwards. Stop
          registering on one of them and give it an unused block below, then synchronise again.
        </AlertBox>
      ) : null}

      <AlertBox tone="info" title="The device stays in charge">
        Synchronisation is optional and never blocks care. Registration, screening and every
        clinical record work exactly as before with no connection; changes are queued here and
        sent whenever a connection happens to exist.
      </AlertBox>

      <div className="stat-grid">
        <Stat
          label="Waiting to send"
          value={status.pending}
          tone={status.pending > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Last sync"
          value={status.lastAt ? relativeDateTime(status.lastAt) : 'Never'}
          tone={status.lastOk === false ? 'danger' : undefined}
          foot={status.lastOk === false ? 'The last attempt failed' : undefined}
        />
      </div>

      <Card title="This device">
        <KeyValue k="Device identifier" v={deviceId()} />
        <KeyValue
          k="Participant numbers"
          v={`${range.min.toLocaleString()} to ${range.max.toLocaleString()}`}
        />
        <NumberField
          label="Number block"
          value={block}
          onChange={setBlock}
          help={`Reserved for this device by the cloud when it signed in — you do not normally set this. Block 0 issues numbers 1 to ${SERIAL_BLOCK_SIZE.toLocaleString()}, block 1 continues from ${(SERIAL_BLOCK_SIZE + 1).toLocaleString()}, and so on. Two devices sharing a block would issue the same participant number to different people.`}
        />
      </Card>

      <Card title="Clinical photographs">
        <Toggle
          label="Include photographs in synchronisation"
          checked={photoSync}
          onChange={(v) => {
            void transaction(() => {
              setSetting('photos.sync_enabled', v ? 'true' : 'false')
              // Images taken while this was off were never queued, so turning
              // it on has to go back for them.
              if (v) enqueueAllPhotos()
            })
            refresh()
          }}
          help="Off by default. A photograph identifies a person more surely than a name does, so it stays on the device that took it until you decide otherwise."
        />
        <KeyValue
          k="On this device"
          v={`${photoStats.count} photograph${photoStats.count === 1 ? '' : 's'}, ${formatBytes(photoStats.bytes)}`}
        />
        {photoSync ? (
          <AlertBox tone="warn" title="Photographs will be uploaded">
            They travel to the same cloud database as the clinical records and count against its
            storage. Expect roughly {formatBytes(300 * 1024)} for each image.
          </AlertBox>
        ) : null}
      </Card>

      <Card title="Cloud address">
        <TextField
          label="Web address"
          value={endpoint}
          onChange={setEndpoint}
          placeholder={defaultEndpoint() || 'https://your-project.vercel.app'}
          help="The address of the hosted application. Leave blank to keep this device entirely offline."
        />

        {token ? (
          <>
            <TextField
              label="Device key"
              value={token}
              onChange={setToken}
              type="password"
              help="Fetched when this device signed in. Change it only if an administrator gives you a new one."
            />
            <button className="btn block" onClick={save}>
              Save cloud settings
            </button>
          </>
        ) : cloudReady === false ? (
          // This device holds the only copy of the outreach. Signing in to
          // fetch a key cannot work yet, because the accounts it would check
          // against are the ones sitting on this very device, unsent. The
          // first device is the one case that needs the server key by hand.
          <>
            <AlertBox tone="info" title="This is the first device">
              Nothing has been sent to the cloud yet, so there is no account there to sign in
              against. Enter the server key once — the <code>SYNC_TOKEN</code> from your Vercel
              settings — and synchronise. Every other device afterwards just signs in.
            </AlertBox>
            <TextField
              label="Device key"
              value={token}
              onChange={setToken}
              type="password"
              help="The SYNC_TOKEN set on the server. Needed on this device only."
            />
            <button className="btn block large" onClick={save} disabled={!token.trim()}>
              Save cloud settings
            </button>
          </>
        ) : (
          <>
            <AlertBox tone="info" title="Sign in to connect this device">
              This device has no key yet. Rather than typing a long secret, sign in with your own
              username and PIN: the key and this device’s participant-number block come back with
              the answer.
            </AlertBox>
            <ConnectToCloud
              endpoint={endpoint || defaultEndpoint()}
              onConnected={() => {
                setToken(syncConfig().token)
                setBlock(String(syncConfig().serialBlock))
                setEndpoint(syncConfig().endpoint)
                refresh()
              }}
            />
            {manualKey ? (
              <>
                <TextField
                  label="Device key"
                  value={token}
                  onChange={setToken}
                  type="password"
                  help="The SYNC_TOKEN set on the server."
                />
                <button className="btn block secondary" onClick={save}>
                  Save cloud settings
                </button>
              </>
            ) : (
              <button className="btn block ghost" onClick={() => setManualKey(true)}>
                Enter the device key by hand instead
              </button>
            )}
          </>
        )}
      </Card>

      {isSyncConfigured() ? (
        <>
          <button className="btn block large" onClick={sync} disabled={busy}>
            {busy ? 'Synchronising…' : 'Synchronise now'}
          </button>
          {!online ? (
            <p className="hint">
              This device is offline. Synchronising will fail until there is a connection — that is
              expected, and nothing is lost in the meantime.
            </p>
          ) : null}
        </>
      ) : (
        <AlertBox tone="muted" title="Not configured">
          Enter the cloud address and device key above to enable synchronisation. Until then this
          device works entirely on its own, exactly as designed.
        </AlertBox>
      )}

      {runs.length ? (
        <Card title="Recent synchronisations">
          {runs.map((r) => (
            <div key={r.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{formatDateTime(r.started_at)}</strong>
                <Badge tone={r.ok ? 'ok' : 'danger'}>{r.ok ? 'Completed' : 'Failed'}</Badge>
              </div>
              <div className="hint">
                {r.pushed} sent · {r.pulled} received
                {r.message ? ` · ${r.message}` : ''}
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      <div className="security-note">
        Records sent to the cloud include patient information. The cloud database is reachable only
        through the hosted application, using the device key above. Changing SYNC_TOKEN on the
        server immediately locks out every device — which is how a lost phone is revoked.
      </div>
    </>
  )
}

// --------------------------------------------------------------- audit

function AuditSettings() {
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 60
  const rows = useQuery(
    () => listAudit({ action: action || undefined, limit: pageSize, offset: page * pageSize }),
    [action, page],
  )
  const actions = useQuery(() => distinctAuditActions(), [])
  const total = useQuery(() => auditCount({ action: action || undefined }), [action])

  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        {total} audit event{total === 1 ? '' : 's'} recorded on this device.
      </p>
      <SelectField
        label="Filter by action"
        value={action}
        onChange={(v) => {
          setAction(v)
          setPage(0)
        }}
        placeholder="All actions"
        options={actions.map((a) => ({ value: a, label: labelFor(a) }))}
      />

      <Card flush>
        {rows.length === 0 ? (
          <EmptyState glyph="□" title="No audit events" />
        ) : (
          rows.map((a) => (
            <div key={a.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{a.summary ?? labelFor(a.action)}</strong>
                <Badge tone={a.action.includes('FAILED') ? 'danger' : 'muted'}>{labelFor(a.action)}</Badge>
              </div>
              <div className="hint">
                {formatDateTime(a.occurred_at)} · {a.username} ({labelFor(a.user_role)})
                {a.entity_type ? ` · ${labelFor(a.entity_type)} ${a.entity_id ?? ''}` : ''}
              </div>
              {a.previous_value || a.new_value ? (
                <div className="hint" style={{ marginTop: 3, wordBreak: 'break-word' }}>
                  {a.previous_value ? `Was: ${a.previous_value}` : ''}
                  {a.previous_value && a.new_value ? ' → ' : ''}
                  {a.new_value ? `Now: ${a.new_value}` : ''}
                </div>
              ) : null}
            </div>
          ))
        )}
      </Card>

      {total > pageSize ? (
        <div className="btn-row">
          <button className="btn secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Newer
          </button>
          <button
            className="btn secondary"
            disabled={(page + 1) * pageSize >= total}
            onClick={() => setPage(page + 1)}
          >
            Older
          </button>
        </div>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------- demo

function DemoSettings() {
  const { project: activeProject, thresholds, demoMode, refresh, reloadProject } = useApp()
  const project = activeProject!
  const toast = useToast()
  const demoCount = useQuery(() => demoRecordCount(), [])
  const [count, setCount] = useState('40')
  const [busy, setBusy] = useState(false)
  const [clearing, setClearing] = useState(false)

  if (!project) return null

  async function generate() {
    setBusy(true)
    try {
      const r = await generateDemoData(project, thresholds, { participants: Number(count) || 20 })
      reloadProject()
      refresh()
      toast('ok', `${r.participants} demonstration participants created.`)
    } catch (err) {
      toast('danger', friendlyError(err, 'Demonstration data could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AlertBox tone={demoMode ? 'warn' : 'info'} title={demoMode ? 'Demonstration mode is on' : 'Demonstration data'}>
        Demonstration records are clearly marked and can be removed without touching a single real
        clinical record. Names of demonstration participants always end in "(DEMO)".
      </AlertBox>

      <div className="stat-grid">
        <Stat label="Demonstration rows" value={demoCount} />
      </div>

      <Card title="Create practice data">
        <NumberField label="Number of participants" value={count} onChange={setCount} />
        <button className="btn block" onClick={generate} disabled={busy}>
          {busy ? 'Creating…' : 'Generate demonstration data'}
        </button>
        <p className="hint">
          Useful for training volunteers before the outreach. Generating 40 participants takes a few
          seconds.
        </p>
      </Card>

      <button
        className="btn block danger secondary"
        onClick={() => setClearing(true)}
        disabled={demoCount === 0}
      >
        Clear demonstration data
      </button>

      {clearing ? (
        <ConfirmDialog
          title="Clear demonstration data?"
          message={`${demoCount} demonstration rows will be permanently removed. Real clinical records are not affected.`}
          destructive
          confirmLabel="Clear demo data"
          onCancel={() => setClearing(false)}
          onConfirm={async () => {
            try {
              const r = await clearDemoData()
              reloadProject()
              refresh()
              toast('ok', `${r.removed} demonstration rows removed.`)
            } catch (err) {
              toast('danger', friendlyError(err, 'Demonstration data could not be cleared.'))
            } finally {
              setClearing(false)
            }
          }}
        />
      ) : null}
    </>
  )
}

// --------------------------------------------------------------- about

/** How this copy of the application was installed, in plain words. */
function platformLabel(): string {
  switch (platform()) {
    case 'DESKTOP':
      return 'Desktop application'
    case 'ANDROID':
      return 'Android application'
    case 'PWA':
      return 'Installed on the home screen'
    default:
      return 'Web browser'
  }
}

/**
 * An explicit "am I current?" for the administrator.
 *
 * The banner appears on its own when there is something to say; this is for
 * the person who wants to check before an outreach rather than be told
 * during one.
 */
function UpdateCheck() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [busy, setBusy] = useState(false)

  async function check() {
    setBusy(true)
    try {
      setState(await checkForUpdate(false))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn block secondary" onClick={() => void check()} disabled={busy}>
        {busy ? 'Checking…' : 'Check for updates'}
      </button>

      {state && !busy ? (
        state.available ? (
          <AlertBox tone="warn" title="A newer version is available">
            {state.latestVersion ? `Version ${state.latestVersion}. ` : ''}
            {state.howToApply === 'DOWNLOAD'
              ? 'Use the banner at the top of the screen to download it.'
              : state.howToApply === 'RESTART'
                ? 'It installs when you next close the application.'
                : 'Use the banner at the top of the screen to apply it.'}
          </AlertBox>
        ) : state.checkedAt && state.latestBuild ? (
          <AlertBox tone="ok" title="This is the current version">
            Checked against the outreach server just now.
          </AlertBox>
        ) : (
          <AlertBox tone="muted" title="Could not reach the server">
            This device is offline, or no cloud address is set. The application is unaffected —
            it does not need the server to work.
          </AlertBox>
        )
      ) : null}
    </>
  )
}


function AboutSettings() {
  const { online, storageBackend } = useApp()
  const toast = useToast()
  const storage = useStorageInfo()
  const schema = useQuery(() => currentSchemaVersion(), [])
  const [check, setCheck] = useState<{ ok: boolean; details: string; fk: string[] } | null>(null)
  const [quota, setQuota] = useState<{ quota: number | null; usage: number | null } | null>(null)

  async function runCheck() {
    const integrity = integrityCheck()
    const fk = foreignKeyCheck()
    setCheck({ ...integrity, fk })
    const info = await storageInfo(storage.sizeBytes)
    setQuota({ quota: info.quotaBytes, usage: info.usageBytes })
    toast(integrity.ok && fk.length === 0 ? 'ok' : 'danger', 'Database check complete.')
  }

  return (
    <>
      <Card title="Application">
        <KeyValue k="Name" v={APP_NAME} />
        <KeyValue k="Version" v={APP_VERSION} />
        <KeyValue k="Database schema" v={`Version ${schema}`} />
        <KeyValue k="Storage" v={labelFor(storageBackend)} />
        <KeyValue k="Database size" v={formatBytes(storage.sizeBytes)} />
        <KeyValue
          k="Network"
          v={<Badge tone={online ? 'info' : 'muted'}>{online ? 'Online' : 'Offline'}</Badge>}
        />
      </Card>

      <AlertBox tone="info" title="This application is offline-first">
        The local database is the source of truth. No participant data is sent anywhere, whether or
        not this device has an internet connection.
      </AlertBox>

      <Card title="Database health">
        <button className="btn block secondary" onClick={runCheck}>
          Run database check
        </button>
        {check ? (
          <div style={{ marginTop: 12 }}>
            <KeyValue
              k="Integrity check"
              v={<Badge tone={check.ok ? 'ok' : 'danger'}>{check.ok ? 'Healthy' : check.details}</Badge>}
            />
            <KeyValue
              k="Referential integrity"
              v={
                <Badge tone={check.fk.length === 0 ? 'ok' : 'danger'}>
                  {check.fk.length === 0 ? 'No problems' : `${check.fk.length} problem(s)`}
                </Badge>
              }
            />
            {check.fk.length > 0 ? (
              <AlertBox tone="danger" title="Referential integrity problems found">
                Restore from your most recent backup, and report this to the project administrator.
              </AlertBox>
            ) : null}
          </div>
        ) : null}
        {quota ? (
          <div style={{ marginTop: 12 }}>
            <KeyValue k="Storage used by this app" v={quota.usage !== null ? formatBytes(quota.usage) : 'Unknown'} />
            <KeyValue k="Storage available" v={quota.quota !== null ? formatBytes(quota.quota) : 'Unknown'} />
            {quota.quota !== null && quota.usage !== null && quota.quota - quota.usage < 50 * 1024 * 1024 ? (
              <AlertBox tone="danger" title="Device storage is critically low">
                Free space on this device before continuing to register participants.
              </AlertBox>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card title="This installation">
        <KeyValue k="Version" v={APP_VERSION} />
        <KeyValue k="Build" v={APP_BUILD} />
        <KeyValue k="Installed as" v={platformLabel()} />
        <UpdateCheck />
      </Card>

      <Card title="What this version does">
        <KeyValue k="Clinical photography" v={<Badge tone="ok">Built</Badge>} />
        <KeyValue k="Synchronisation between devices" v={<Badge tone="ok">Built</Badge>} />
        <KeyValue k="Off-site backup" v={<Badge tone="ok">Built</Badge>} />
        <p className="hint">
          Photographs need a separate photography consent and stay on the device that took them
          unless an administrator turns synchronisation on for them. Records are matched between
          devices on their UUID, and the off-site backup copy is encrypted here before it is sent,
          so the server holds ciphertext it cannot open.
        </p>
      </Card>

      <Card title="Not built in version 1">
        <p className="hint" style={{ marginTop: 0 }}>
          Designed for in the database, deliberately left out. They are named here so nobody plans
          the outreach around a feature that does not exist:
        </p>
        <div className="not-implemented">NOT IMPLEMENTED — SMS reminders to participants</div>
        <div style={{ height: 8 }} />
        <div className="not-implemented">NOT IMPLEMENTED — printing to a Bluetooth label printer</div>
        <div style={{ height: 8 }} />
        <div className="not-implemented">NOT IMPLEMENTED — a second language for the interface</div>
      </Card>
    </>
  )
}
