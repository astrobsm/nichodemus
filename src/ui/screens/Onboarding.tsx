/** First-run wizard, sign-in and app lock (spec S50, S87, S88). */
import { useEffect, useState } from 'react'
import { useApp } from '../AppState'
import {
  AlertBox,
  ChoiceGroup,
  NumberField,
  SelectField,
  TextArea,
  TextField,
  Toggle,
  Logo,
  friendlyError,
  useToast,
} from '../components/ui'
import { APP_NAME } from '../../core/constants'
import { SETTING_KEYS } from '../../core/constants'
import {
  activeProject,
  createProject,
  listProjects,
  setActiveProject,
} from '../../db/repo/projects'
import { saveFacility } from '../../db/repo/referrals'
import {
  changePin,
  createUser,
  hasAdministrator,
  listUsers,
  login,
  verifyUserPin,
} from '../../db/repo/users'
import { ROLES } from '../../core/permissions'
import { setSetting } from '../../db/repo/settings'
import { validatePin, validatePassphrase, firstError, required } from '../../core/validation'
import { transaction, flush } from '../../db/sqlite'
import { restoreBackup } from '../../services/backup'
import { runSync, saveSyncConfig } from '../../services/sync'
import { CloudAuthError, cloudSignIn, defaultEndpoint, probeCloud } from '../../services/cloudAuth'
import { deviceId } from '../../core/ids'
import { pickFile } from '../../services/fileIo'
import { setAuditActor } from '../../core/audit'
import { migrate } from '../../db/migrations'

// ====================================================== first-run wizard

const STEP_COUNT = 6

export function SetupWizard() {
  const { completeSetup } = useApp()
  const toast = useToast()
  const [mode, setMode] = useState<'CHOOSE' | 'CREATE' | 'JOIN' | 'RESTORE'>('CHOOSE')
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Project details, pre-filled with the outreach this app was built for
  // and fully editable (spec S72).
  const [name, setName] = useState(APP_NAME)
  const [honouree, setHonouree] = useState('Nichodemus Ugbor')
  const [location, setLocation] = useState('Umunna community, Umuhu village, Owelli Court')
  const [lga, setLga] = useState('Awgu')
  const [state, setState] = useState('Enugu')
  const [date, setDate] = useState('2026-12-29')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('16:00')
  const [expected, setExpected] = useState('500')
  const [prefix, setPrefix] = useState('NUG')
  const [theme, setTheme] = useState('Community health for all')
  const [objectives, setObjectives] = useState(
    'Provide free blood pressure and blood glucose screening, clinical breast examination, ' +
      'wound care and health counselling to the community, and refer those who need further care.',
  )
  const [director, setDirector] = useState('')
  const [medicalDirector, setMedicalDirector] = useState('')

  // Administrator account
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')

  // Security
  const [timeout, setTimeoutMinutes] = useState('5')
  const [backupReminder, setBackupReminder] = useState('12')

  // Referral facility
  const [facilityName, setFacilityName] = useState('')
  const [facilityType, setFacilityType] = useState('General hospital')
  const [facilityPhone, setFacilityPhone] = useState('')

  const [loadDemo, setLoadDemo] = useState(false)

  // Signing in to an outreach that already exists
  const [joinEndpoint, setJoinEndpoint] = useState(defaultEndpoint())
  const [joinUser, setJoinUser] = useState('')
  const [joinPin, setJoinPin] = useState('')
  const [joinProgress, setJoinProgress] = useState('')
  const [noOutreach, setNoOutreach] = useState(false)
  const [cloud, setCloud] = useState<{
    reachable: boolean
    ready: boolean
    outreach: string | null
  } | null>(null)

  // Ask the address this application is served from whether an outreach is
  // already running there. When there is one, staff sign straight in and
  // never see the setup wizard at all.
  useEffect(() => {
    let cancelled = false
    const endpoint = defaultEndpoint()
    if (!endpoint) {
      setCloud({ reachable: false, ready: false, outreach: null })
      return
    }
    probeCloud(endpoint).then((result) => {
      if (cancelled) return
      setCloud({ reachable: result.reachable, ready: result.ready, outreach: result.outreach })
      // Only send people straight to sign-in when there is actually something
      // to sign in to. Otherwise they meet a sign-in form that cannot succeed.
      if (result.ready) setMode('JOIN')
    })
    return () => {
      cancelled = true
    }
  }, [])

  function validateStep(): string | null {
    if (step === 0) {
      const r = firstError(required(name, 'Project name'), required(location, 'Location'))
      return r.ok ? null : r.message ?? null
    }
    if (step === 1) {
      const r = firstError(
        required(fullName, 'Your full name'),
        required(username, 'A username'),
      )
      if (!r.ok) return r.message ?? null
      const p = validatePin(pin)
      if (!p.ok) return p.message ?? null
      if (pin !== pinConfirm) return 'The two PINs do not match.'
      return null
    }
    return null
  }

  async function finish() {
    setBusy(true)
    setError(null)
    try {
      const projectId = await transaction(() =>
        createProject({
          name: name.trim(),
          memorialHonouree: honouree,
          location,
          lga,
          state,
          proposedDate: date,
          startTime,
          endTime,
          expectedParticipants: Number(expected) || 0,
          objectives,
          theme,
          projectDirector: director,
          medicalDirector,
          participantPrefix: prefix,
        }),
      )

      const adminId = await createUser({
        username: username.trim(),
        fullName: fullName.trim(),
        role: ROLES.ADMINISTRATOR,
        pin,
      })
      setAuditActor({ id: adminId, username: username.trim(), role: ROLES.ADMINISTRATOR })

      await transaction(() => {
        setActiveProject(projectId)
        setSetting(SETTING_KEYS.SESSION_TIMEOUT_MINUTES, timeout)
        setSetting(SETTING_KEYS.BACKUP_REMINDER_HOURS, backupReminder)
        setSetting(SETTING_KEYS.DEMO_MODE, loadDemo ? 'true' : 'false')
        setSetting(SETTING_KEYS.SETUP_COMPLETE, 'true')
        if (facilityName.trim()) {
          saveFacility({
            name: facilityName.trim(),
            facility_type: facilityType,
            phone: facilityPhone,
            project_id: projectId,
          })
        }
      })

      await flush()
      toast('ok', 'Project created. Sign in with the administrator account you just made.')
      completeSetup()
    } catch (err) {
      setError(friendlyError(err, 'The project could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Signs this device in to an outreach that already exists.
   *
   * No project is created and no device key is typed: the username and PIN
   * the administrator issued are enough. The cloud checks them, reserves a
   * participant-number block for this device so two devices can never issue
   * the same participant number, and returns the synchronisation key.
   */
  async function doJoin() {
    setBusy(true)
    setError(null)
    setNoOutreach(false)
    try {
      setJoinProgress('Checking your details…')
      const credentials = await cloudSignIn(joinEndpoint, joinUser, joinPin, deviceId())

      setJoinProgress('Setting up this device…')
      await transaction(() => {
        saveSyncConfig({
          endpoint: joinEndpoint.trim(),
          token: credentials.syncToken,
          serialBlock: credentials.serialBlock,
          enabled: true,
          cursor: 0,
        })
      })

      setJoinProgress('Downloading the outreach…')
      const result = await runSync()

      if (listProjects().length === 0) {
        setError(
          'You signed in, but the outreach has not been synchronised to the cloud yet. ' +
            'Open it on the device it was set up on and press Synchronise, then try again.',
        )
        return
      }
      if (!hasAdministrator()) {
        setError(
          'The outreach arrived but its user accounts did not, so there would be no way to ' +
            'sign in. Synchronise the first device again, then try here.',
        )
        return
      }

      const project = activeProject()
      await transaction(() => {
        if (project) setActiveProject(project.id)
        setSetting(SETTING_KEYS.SESSION_TIMEOUT_MINUTES, timeout)
        setSetting(SETTING_KEYS.BACKUP_REMINDER_HOURS, backupReminder)
        setSetting(SETTING_KEYS.SETUP_COMPLETE, 'true')
      })
      await flush()

      toast('ok', `Welcome, ${credentials.user.fullName}. ${result.pulled} records received.`)
      completeSetup()
    } catch (err) {
      // Distinguish "your PIN is wrong" from "there is nothing here" — they
      // lead to completely different actions.
      if (err instanceof CloudAuthError && err.reason === 'NO_OUTREACH') {
        setNoOutreach(true)
        setCloud((prev) => ({ reachable: true, ready: false, outreach: prev?.outreach ?? null }))
      }
      setError(friendlyError(err, 'You could not be signed in.'))
    } finally {
      setJoinProgress('')
      setBusy(false)
    }
  }

  async function doRestore() {
    setBusy(true)
    setError(null)
    try {
      const file = await pickFile(
        { 'application/octet-stream': ['.nugbak', '.sqlite', '.db'] },
        'Outreach backup',
      )
      if (!file) {
        setBusy(false)
        return
      }
      const pass = window.prompt(
        'Enter the backup password for this file. Leave blank if the file is an unencrypted database.',
      )
      await restoreBackup(file, pass && pass.length ? pass : null)
      migrate()
      await flush()
      const users = listUsers()
      if (users.length === 0) {
        setError(
          'That backup was restored but contains no user accounts. Create a new project instead.',
        )
        setBusy(false)
        return
      }
      toast('ok', 'Backup restored. Sign in with an account from the restored database.')
      completeSetup()
    } catch (err) {
      setError(friendlyError(err, 'The backup could not be restored.'))
    } finally {
      setBusy(false)
    }
  }

  // The address answered, and said there is no outreach and no account there.
  const firstEver = cloud?.reachable === true && cloud?.ready === false

  if (mode === 'CHOOSE') {
    return (
      <div className="centre-screen">
        <div className="brand">
          <Logo size={104} className="brand-seal" />
          <h1>Welcome</h1>
          <p>{APP_NAME}</p>
        </div>
        <div className="panel">
          <p style={{ marginTop: 0, fontSize: 14.5 }}>
            This application keeps all of its information in a database on this device. It works
            without internet, mobile data or a server.
          </p>

          {firstEver ? (
            // Nothing exists yet. Offering "sign in" first would send the
            // first person into a form that cannot possibly succeed, and the
            // only answer it could give them is that their PIN is wrong.
            <>
              <AlertBox tone="info" title="Nobody has set this outreach up yet">
                You are the first. Create the outreach and your own administrator account here,
                then synchronise — after that everyone else just signs in.
              </AlertBox>
              <button className="btn block large" onClick={() => setMode('CREATE')}>
                Set up the outreach
              </button>
              <div style={{ height: 12 }} />
              <button className="btn block secondary" onClick={() => setMode('JOIN')}>
                Sign in to an outreach elsewhere
              </button>
            </>
          ) : (
            <>
              <button className="btn block large" onClick={() => setMode('JOIN')}>
                Sign in to an outreach
              </button>
              <p className="hint" style={{ marginTop: 6 }}>
                For everyone but the person setting the outreach up. Your username and PIN bring
                the project, the team and the records to this device.
              </p>
              <div style={{ height: 12 }} />
              <button className="btn block secondary" onClick={() => setMode('CREATE')}>
                Set up a new outreach
              </button>
            </>
          )}
          <div style={{ height: 10 }} />
          <button className="btn block secondary" onClick={() => setMode('RESTORE')}>
            Restore existing backup
          </button>
          {error ? (
            <div style={{ marginTop: 14 }}>
              <AlertBox tone="danger" title="Could not continue">
                {error}
              </AlertBox>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (mode === 'JOIN') {
    const known = cloud?.ready === true
    return (
      <div className="centre-screen">
        <div className="brand">
          <Logo size={104} className="brand-seal" />
          <h1>{known ? 'Sign in' : 'Sign in to an outreach'}</h1>
          <p>{cloud?.outreach ?? APP_NAME}</p>
        </div>
        <div className="panel">
          {known ? (
            <p style={{ marginTop: 0, fontSize: 14.5 }}>
              Use the username and PIN your administrator gave you. Everything this device needs
              arrives with you — there is nothing to set up.
            </p>
          ) : firstEver ? (
            <AlertBox tone="warn" title="There is no outreach at this address yet">
              No account exists here, so no username or PIN can work. Somebody has to set the
              outreach up once and synchronise it first.
            </AlertBox>
          ) : (
            <AlertBox tone="info" title="Where is the outreach?">
              Enter the web address your administrator gave you, then your own username and PIN.
            </AlertBox>
          )}

          {firstEver ? (
            <>
              <button className="btn block large" onClick={() => setMode('CREATE')}>
                Set up the outreach on this device
              </button>
              <div style={{ height: 10 }} />
            </>
          ) : null}

          {!known ? (
            <TextField
              label="Web address"
              value={joinEndpoint}
              onChange={setJoinEndpoint}
              placeholder="https://nichodemus.vercel.app"
              required
            />
          ) : null}

          <TextField
            label="Username"
            value={joinUser}
            onChange={setJoinUser}
            required
            autoFocus={known}
          />
          <TextField
            label="PIN"
            value={joinPin}
            onChange={setJoinPin}
            type="password"
            inputMode="numeric"
            maxLength={12}
            required
          />

          {joinProgress ? <p className="hint">{joinProgress}</p> : null}
          {error ? (
            <AlertBox
              tone={noOutreach ? 'warn' : 'danger'}
              title={noOutreach ? 'There is nothing to sign in to yet' : 'Could not sign in'}
            >
              {error}
              {noOutreach ? (
                <>
                  <div style={{ height: 10 }} />
                  <button className="btn small" onClick={() => setMode('CREATE')}>
                    Set up the outreach
                  </button>
                </>
              ) : null}
            </AlertBox>
          ) : null}

          <button
            className="btn block large"
            onClick={doJoin}
            disabled={busy || !joinEndpoint.trim() || !joinUser.trim() || !joinPin}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div style={{ height: 10 }} />
          <button className="btn block ghost" onClick={() => setMode('CHOOSE')} disabled={busy}>
            Other options
          </button>

          <p className="hint">
            This needs a connection once. Afterwards the device works offline like every other and
            synchronises again whenever there is a signal.
          </p>
        </div>
      </div>
    )
  }

  if (mode === 'RESTORE') {
    return (
      <div className="centre-screen">
        <div className="brand">
          <Logo size={104} className="brand-seal" />
          <h1>Restore a backup</h1>
          <p>Choose a .nugbak backup file saved from this or another device.</p>
        </div>
        <div className="panel">
          <AlertBox tone="warn" title="This replaces any data on this device">
            Restoring a backup replaces the local database entirely. On a fresh installation there
            is nothing to lose, but check you have the right file.
          </AlertBox>
          <button className="btn block large" onClick={doRestore} disabled={busy}>
            {busy ? 'Restoring…' : 'Choose backup file'}
          </button>
          <div style={{ height: 10 }} />
          <button className="btn block ghost" onClick={() => setMode('CHOOSE')} disabled={busy}>
            Back
          </button>
          {error ? (
            <div style={{ marginTop: 14 }}>
              <AlertBox tone="danger" title="Restore failed">
                {error}
              </AlertBox>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const stepError = validateStep()

  return (
    <div className="centre-screen" style={{ alignItems: 'stretch', justifyContent: 'flex-start', paddingTop: 26 }}>
      <div style={{ width: '100%', maxWidth: 520, margin: '0 auto' }}>
        <div className="wizard-steps">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <div key={i} className={`step ${i <= step ? 'done' : ''}`} />
          ))}
        </div>
        <div className="brand" style={{ textAlign: 'left' }}>
          <Logo size={72} className="brand-seal" />
          <h1>{['Project details', 'Administrator account', 'Security', 'Clinical setup', 'Referral facility', 'Ready'][step]}</h1>
          <p>Step {step + 1} of {STEP_COUNT}</p>
        </div>

        <div className="panel">
          {step === 0 ? (
            <>
              <TextField label="Project name" value={name} onChange={setName} required />
              <TextField label="In memory of" value={honouree} onChange={setHonouree} />
              <TextField label="Location / venue" value={location} onChange={setLocation} required />
              <div className="row">
                <TextField label="LGA" value={lga} onChange={setLga} />
                <TextField label="State" value={state} onChange={setState} />
              </div>
              <TextField label="Proposed date" value={date} onChange={setDate} type="date" />
              <div className="row">
                <TextField label="Start time" value={startTime} onChange={setStartTime} type="time" />
                <TextField label="End time" value={endTime} onChange={setEndTime} type="time" />
              </div>
              <div className="row">
                <NumberField label="Expected participants" value={expected} onChange={setExpected} />
                <TextField
                  label="Participant ID prefix"
                  value={prefix}
                  onChange={(v) => setPrefix(v.toUpperCase())}
                  maxLength={6}
                  help="Example: NUG-0001"
                />
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <AlertBox tone="info" title="Create your own credentials">
                There is no default password in this application. The account you create here is the
                first administrator.
              </AlertBox>
              <TextField label="Your full name" value={fullName} onChange={setFullName} required />
              <TextField
                label="Username"
                value={username}
                onChange={setUsername}
                required
                help="Short and easy to type, for example: admin or ada"
              />
              <TextField
                label="PIN (4 to 12 digits)"
                value={pin}
                onChange={setPin}
                type="password"
                inputMode="numeric"
                maxLength={12}
                required
              />
              <TextField
                label="Confirm PIN"
                value={pinConfirm}
                onChange={setPinConfirm}
                type="password"
                inputMode="numeric"
                maxLength={12}
                required
              />
            </>
          ) : null}

          {step === 2 ? (
            <>
              <SelectField
                label="Lock the application after inactivity"
                value={timeout}
                onChange={setTimeoutMinutes}
                options={[
                  { value: '1', label: '1 minute' },
                  { value: '5', label: '5 minutes (recommended)' },
                  { value: '10', label: '10 minutes' },
                  { value: '30', label: '30 minutes' },
                  { value: '0', label: 'Never' },
                ]}
              />
              <SelectField
                label="Remind me to back up after"
                value={backupReminder}
                onChange={setBackupReminder}
                options={[
                  { value: '4', label: '4 hours' },
                  { value: '12', label: '12 hours' },
                  { value: '24', label: '24 hours' },
                ]}
              />
              <div className="security-note">
                This device will contain confidential health information. Do not share your device,
                application PIN or backup files with unauthorised persons.
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <AlertBox tone="info" title="Clinical thresholds are pre-loaded">
                Blood pressure, glucose, wound and breast alert thresholds have been seeded with
                widely used screening values. A clinical administrator can review and change every
                one of them in Settings before the outreach.
              </AlertBox>
              <TextField label="Theme" value={theme} onChange={setTheme} />
              <TextArea label="Objectives" value={objectives} onChange={setObjectives} />
              <TextField label="Project director" value={director} onChange={setDirector} />
              <TextField
                label="Medical director"
                value={medicalDirector}
                onChange={setMedicalDirector}
              />
            </>
          ) : null}

          {step === 4 ? (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Add the main facility you will refer participants to. You can add more later, and
                the directory works entirely offline.
              </p>
              <TextField label="Facility name" value={facilityName} onChange={setFacilityName} />
              <SelectField
                label="Facility type"
                value={facilityType}
                onChange={setFacilityType}
                options={[
                  'Primary health centre',
                  'General hospital',
                  'Teaching hospital',
                  'Specialist hospital',
                  'Mission hospital',
                  'Private clinic',
                ].map((t) => ({ value: t, label: t }))}
              />
              <TextField
                label="Telephone"
                value={facilityPhone}
                onChange={setFacilityPhone}
                type="tel"
                inputMode="tel"
              />
            </>
          ) : null}

          {step === 5 ? (
            <>
              <AlertBox tone="ok" title="Everything is ready">
                Stations, the event checklist, the logistics list and the budget categories will be
                created automatically for this project.
              </AlertBox>
              <Toggle
                label="Load demonstration data"
                help="Creates clearly marked practice records so staff can train. It can be cleared later without affecting real records."
                checked={loadDemo}
                onChange={setLoadDemo}
              />
              <div style={{ marginTop: 12 }}>
                <div className="kv">
                  <span className="k">Project</span>
                  <span className="v">{name}</span>
                </div>
                <div className="kv">
                  <span className="k">Location</span>
                  <span className="v">
                    {[location, lga, state].filter(Boolean).join(', ')}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Date</span>
                  <span className="v">{date || 'Not set'}</span>
                </div>
                <div className="kv">
                  <span className="k">Expected</span>
                  <span className="v">{expected}</span>
                </div>
                <div className="kv">
                  <span className="k">Administrator</span>
                  <span className="v">{username}</span>
                </div>
              </div>
            </>
          ) : null}

          {error ? (
            <div style={{ marginTop: 12 }}>
              <AlertBox tone="danger" title="Could not continue">
                {error}
              </AlertBox>
            </div>
          ) : null}
          {stepError ? (
            <div style={{ marginTop: 12 }}>
              <AlertBox tone="warn" title="Please check this step">
                {stepError}
              </AlertBox>
            </div>
          ) : null}

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              className="btn secondary"
              onClick={() => (step === 0 ? setMode('CHOOSE') : setStep(step - 1))}
              disabled={busy}
            >
              Back
            </button>
            {step < STEP_COUNT - 1 ? (
              <button
                className="btn"
                onClick={() => setStep(step + 1)}
                disabled={busy || Boolean(stepError)}
              >
                Continue
              </button>
            ) : (
              <button className="btn" onClick={finish} disabled={busy}>
                {busy ? 'Creating…' : 'Create project'}
              </button>
            )}
          </div>
        </div>
        <p className="fab-note" style={{ color: 'rgba(255,255,255,0.8)' }}>
          Nothing on this screen is sent anywhere. All information stays on this device.
        </p>
      </div>
    </div>
  )
}

// ============================================================== sign-in

export function LoginScreen() {
  const { signIn } = useApp()
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState<{ userId: number } | null>(null)
  const [newPin, setNewPin] = useState('')
  const [newPinConfirm, setNewPinConfirm] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await login(username, pin)
      if (!result.ok) {
        setError(
          result.attemptsRemaining !== undefined
            ? `${result.reason} ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} remaining before this account is locked.`
            : result.reason,
        )
        setPin('')
        return
      }
      if (result.mustChangePin) {
        setChanging({ userId: result.user.id })
        return
      }
      signIn(result.user)
    } catch (err) {
      setError(friendlyError(err, 'Sign-in could not be completed.'))
    } finally {
      setBusy(false)
    }
  }

  async function submitNewPin(e: React.FormEvent) {
    e.preventDefault()
    if (!changing) return
    const v = validatePin(newPin)
    if (!v.ok) {
      setError(v.message ?? 'That PIN is not acceptable.')
      return
    }
    if (newPin !== newPinConfirm) {
      setError('The two PINs do not match.')
      return
    }
    setBusy(true)
    try {
      await changePin(changing.userId, newPin)
      const result = await login(username, newPin)
      if (result.ok) signIn(result.user)
    } catch (err) {
      setError(friendlyError(err, 'The PIN could not be changed.'))
    } finally {
      setBusy(false)
    }
  }

  if (changing) {
    return (
      <div className="centre-screen">
        <div className="brand">
          <Logo size={104} className="brand-seal" />
          <h1>Set your new PIN</h1>
          <p>Your administrator reset this account. Choose a PIN only you know.</p>
        </div>
        <form className="panel" onSubmit={submitNewPin}>
          <TextField
            label="New PIN"
            value={newPin}
            onChange={setNewPin}
            type="password"
            inputMode="numeric"
            maxLength={12}
            autoFocus
          />
          <TextField
            label="Confirm new PIN"
            value={newPinConfirm}
            onChange={setNewPinConfirm}
            type="password"
            inputMode="numeric"
            maxLength={12}
          />
          {error ? <AlertBox tone="danger" title="Could not set the PIN">{error}</AlertBox> : null}
          <button className="btn block large" type="submit" disabled={busy}>
            Save PIN and continue
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="centre-screen">
      <div className="brand">
        <h1>{APP_NAME}</h1>
        <p>Sign in to continue. All data stays on this device.</p>
      </div>
      <form className="panel" onSubmit={submit}>
        <TextField label="Username" value={username} onChange={setUsername} autoFocus />
        <div className="field">
          <label htmlFor="pin-field">PIN</label>
          <input
            id="pin-field"
            className="pin-input"
            type="password"
            inputMode="numeric"
            maxLength={12}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </div>
        {error ? (
          <AlertBox tone="danger" title="Sign-in failed">
            {error}
          </AlertBox>
        ) : null}
        <button className="btn block large" type="submit" disabled={busy || !username || !pin}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

// ============================================================= app lock

export function LockScreen() {
  const { user, unlock, signOut } = useApp()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const ok = await verifyUserPin(user.id, pin)
      if (ok) {
        setPin('')
        unlock()
      } else {
        setError('That PIN is not correct.')
        setPin('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="centre-screen">
      <div className="brand">
        <h1>Application locked</h1>
        <p>Signed in as {user?.full_name}. Enter your PIN to continue.</p>
      </div>
      <form className="panel" onSubmit={submit}>
        <div className="field">
          <label htmlFor="lock-pin">PIN</label>
          <input
            id="lock-pin"
            className="pin-input"
            type="password"
            inputMode="numeric"
            maxLength={12}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
          />
        </div>
        {error ? <AlertBox tone="danger" title="Locked">{error}</AlertBox> : null}
        <button className="btn block large" type="submit" disabled={busy || !pin}>
          Unlock
        </button>
        <div style={{ height: 10 }} />
        <button className="btn block ghost" type="button" onClick={() => void signOut()}>
          Sign out instead
        </button>
      </form>
    </div>
  )
}

export function ChangeOwnPin({ onDone }: { onDone: () => void }) {
  const { user } = useApp()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setError(null)
    const v = validatePin(next)
    if (!v.ok) return setError(v.message ?? null)
    if (next !== confirm) return setError('The two new PINs do not match.')
    setBusy(true)
    try {
      const ok = await verifyUserPin(user.id, current)
      if (!ok) {
        setError('Your current PIN is not correct.')
        return
      }
      await changePin(user.id, next)
      toast('ok', 'Your PIN has been changed.')
      onDone()
    } catch (err) {
      setError(friendlyError(err, 'The PIN could not be changed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <TextField label="Current PIN" value={current} onChange={setCurrent} type="password" inputMode="numeric" />
      <TextField label="New PIN" value={next} onChange={setNext} type="password" inputMode="numeric" />
      <TextField label="Confirm new PIN" value={confirm} onChange={setConfirm} type="password" inputMode="numeric" />
      {error ? <AlertBox tone="danger" title="Could not change PIN">{error}</AlertBox> : null}
      <button className="btn block" type="submit" disabled={busy}>
        Change PIN
      </button>
    </form>
  )
}

/** Shared passphrase prompt used by backup and restore. */
export function PassphrasePrompt({
  description,
  confirmLabel,
  requireConfirm,
  onSubmit,
  onCancel,
}: {
  description: string
  confirmLabel: string
  requireConfirm?: boolean
  onSubmit: (passphrase: string) => Promise<void>
  onCancel: () => void
}) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function go() {
    setError(null)
    if (requireConfirm) {
      const v = validatePassphrase(pass)
      if (!v.ok) return setError(v.message ?? null)
      if (pass !== confirm) return setError('The two passwords do not match.')
    }
    setBusy(true)
    try {
      await onSubmit(pass)
    } catch (err) {
      setError(friendlyError(err, 'That did not work.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>{description}</p>
      <TextField label="Backup password" value={pass} onChange={setPass} type="password" autoFocus />
      {requireConfirm ? (
        <TextField label="Confirm backup password" value={confirm} onChange={setConfirm} type="password" />
      ) : null}
      {requireConfirm ? (
        <AlertBox tone="warn" title="Keep this password safe">
          Without it the backup file cannot be opened. There is no way to recover it.
        </AlertBox>
      ) : null}
      {error ? <AlertBox tone="danger" title="Could not continue">{error}</AlertBox> : null}
      <div className="btn-row">
        <button className="btn secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn" onClick={go} disabled={busy || !pass}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </>
  )
}

export { ChoiceGroup }
