/** Application shell: boot states, header, routing and bottom navigation. */
import { useEffect } from 'react'
import { AppProvider, useApp } from './ui/AppState'
import { Logo, ToastProvider } from './ui/components/ui'
import { navigate, useRoute } from './ui/router'
import { LockScreen, LoginScreen, SetupWizard } from './ui/screens/Onboarding'
import { Dashboard } from './ui/screens/Dashboard'
import { ParticipantsScreen, RegisterScreen } from './ui/screens/Participants'
import { ParticipantProfile } from './ui/screens/ParticipantProfile'
import { ClinicalScreen } from './ui/screens/Clinical'
import { OperationsScreen } from './ui/screens/Operations'
import { ReportsScreen } from './ui/screens/Reports'
import { SettingsScreen } from './ui/screens/Settings'
import { APP_NAME, APP_SHORT_NAME } from './core/constants'
import { projectSummaryLine } from './db/repo/projects'
import { PERMISSIONS } from './core/permissions'

const NAV = [
  { path: '/home', label: 'Home', glyph: '⌂' },
  { path: '/people', label: 'People', glyph: '☷' },
  { path: '/clinical', label: 'Clinical', glyph: '✚' },
  { path: '/operations', label: 'Operations', glyph: '☰' },
  { path: '/reports', label: 'Reports', glyph: '▤' },
]

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </AppProvider>
  )
}

function Root() {
  const { phase, bootError, locked } = useApp()

  // Restore accessibility preferences before first paint of the shell.
  useEffect(() => {
    if (localStorage.getItem('nug.largeText') === 'true') {
      document.body.classList.add('large-text')
    }
    if (localStorage.getItem('nug.highContrast') === 'true') {
      document.body.classList.add('high-contrast')
    }
  }, [])

  if (phase === 'BOOTING') {
    return (
      <div className="centre-screen">
        <div className="brand">
          <h1>{APP_NAME}</h1>
          <p>Opening the database on this device…</p>
        </div>
      </div>
    )
  }

  if (phase === 'ERROR') {
    return (
      <div className="centre-screen">
        <div className="brand">
          <h1>The application could not start</h1>
        </div>
        <div className="panel">
          <div className="alert danger" role="alert">
            <span className="glyph" aria-hidden="true">▲</span>
            <div className="body">
              <div className="title">Database problem</div>
              <div className="text">{bootError}</div>
            </div>
          </div>
          <p className="hint">
            Your data has not been deleted. Restore the most recent backup from another device, or
            ask the project administrator for help.
          </p>
          <button className="btn block" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'SETUP') return <SetupWizard />
  if (phase === 'LOGIN') return <LoginScreen />
  if (locked) return <LockScreen />
  return <Shell />
}

function Shell() {
  const { project, online, demoMode, signOut, lock } = useApp()
  const route = useRoute()
  const [section] = route.segments

  useEffect(() => {
    if (!window.location.hash) navigate('/home')
  }, [])

  const activeNav =
    NAV.find((n) => n.path === `/${section}`)?.path ??
    (section === 'register' || section === 'participant' ? '/people' : '/home')

  return (
    <div className="app-shell">
      <header className="app-header">
        <Logo size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>
            {project?.name ?? APP_SHORT_NAME}
            <span className="sub">{project ? projectSummaryLine(project) : 'No active project'}</span>
          </h1>
        </div>
        <button className="header-btn" onClick={() => navigate('/settings')} aria-label="Settings">
          ⚙
        </button>
        <button className="header-btn" onClick={lock} aria-label="Lock the application">
          ⎉
        </button>
        <button className="header-btn" onClick={() => void signOut()} aria-label="Sign out">
          ⏻
        </button>
      </header>

      {demoMode ? <div className="demo-ribbon">Demo data present — not real patient records</div> : null}

      <div className={`offline-strip ${online ? '' : 'warn'}`}>
        {online
          ? 'All data is stored on this device only. Nothing is uploaded.'
          : 'Offline mode — all data is being stored securely on this device.'}
      </div>

      <main className="app-main">
        <Screen route={route} />
      </main>

      <nav className="bottom-nav" aria-label="Main">
        {NAV.map((n) => (
          <button
            key={n.path}
            onClick={() => navigate(n.path)}
            aria-current={activeNav === n.path ? 'page' : undefined}
          >
            <span className="glyph" aria-hidden="true">
              {n.glyph}
            </span>
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Screen({ route }: { route: ReturnType<typeof useRoute> }) {
  const { can } = useApp()
  const [section, a, b] = route.segments

  switch (section) {
    case undefined:
    case 'home':
      return <Dashboard />

    case 'people':
      return <ParticipantsScreen />

    case 'register': {
      if (!can(PERMISSIONS.PARTICIPANT_CREATE) && !can(PERMISSIONS.PARTICIPANT_EDIT)) {
        return <NotPermitted />
      }
      const edit = route.query.get('edit')
      return <RegisterScreen editId={edit ? Number(edit) : undefined} />
    }

    case 'participant':
      if (!can(PERMISSIONS.PARTICIPANT_VIEW)) return <NotPermitted />
      return <ParticipantProfile id={Number(a)} />

    case 'clinical':
      if (a === 'queue') return <ClinicalScreen stage={b} />
      if (a === 'followup') return <ClinicalScreen initialTab="FOLLOWUP" />
      if (a === 'referrals') return <ClinicalScreen initialTab="REFERRALS" />
      return <ClinicalScreen />

    case 'operations':
      return <OperationsScreen initial={a} />

    case 'reports':
      if (!can(PERMISSIONS.REPORTS_VIEW) && !can(PERMISSIONS.ANALYTICS_VIEW)) return <NotPermitted />
      return <ReportsScreen />

    case 'settings':
      return <SettingsScreen />

    default:
      return (
        <div className="empty">
          <span className="glyph" aria-hidden="true">□</span>
          <div style={{ fontWeight: 700 }}>Page not found</div>
          <button className="btn small secondary" style={{ marginTop: 12 }} onClick={() => navigate('/home')}>
            Go to the dashboard
          </button>
        </div>
      )
  }
}

function NotPermitted() {
  return (
    <div className="empty">
      <span className="glyph" aria-hidden="true">⊘</span>
      <div style={{ fontWeight: 700, color: 'var(--ink-2)' }}>Not available for your role</div>
      <div style={{ fontSize: 13.5, marginTop: 6 }}>
        Ask an administrator if you need access to this part of the application.
      </div>
      <button className="btn small secondary" style={{ marginTop: 12 }} onClick={() => navigate('/home')}>
        Back to the dashboard
      </button>
    </div>
  )
}
