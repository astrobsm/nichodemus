/**
 * Application state: database lifecycle, session, active project and the
 * cached clinical thresholds. Everything below the provider can assume the
 * local database is open and migrated.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { openDatabase, DatabaseCorruptError, flush, databaseSizeBytes, backendName } from '../db/sqlite'
import { migrate } from '../db/migrations'
import { activeProject, type Project } from '../db/repo/projects'
import { getSetting, loadThresholds } from '../db/repo/settings'
import { hasAdministrator, recordLogout, type User } from '../db/repo/users'
import { setAuditActor, clearAuditActor, setAuditProject } from '../core/audit'
import { permissionsForRole } from '../core/permissions'
import { SETTING_KEYS } from '../core/constants'
import { DEFAULT_THRESHOLDS, type ClinicalThresholds } from '../core/clinicalRules'
import { requestPersistentStorage } from '../db/persistence'

export type BootPhase = 'BOOTING' | 'SETUP' | 'LOGIN' | 'READY' | 'ERROR'

interface AppContextValue {
  phase: BootPhase
  bootError: string | null
  user: User | null
  project: Project | null
  thresholds: ClinicalThresholds
  demoMode: boolean
  online: boolean
  locked: boolean
  dataVersion: number
  storageBackend: string
  can: (permission: string) => boolean
  refresh: () => void
  signIn: (user: User) => void
  signOut: () => Promise<void>
  lock: () => void
  unlock: () => void
  completeSetup: () => void
  reloadProject: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<BootPhase>('BOOTING')
  const [bootError, setBootError] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [thresholds, setThresholds] = useState<ClinicalThresholds>(DEFAULT_THRESHOLDS)
  const [demoMode, setDemoMode] = useState(false)
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? false : navigator.onLine,
  )
  const [locked, setLocked] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const [storageBackend, setStorageBackend] = useState('memory')

  const refresh = useCallback(() => setDataVersion((v) => v + 1), [])

  const reloadProject = useCallback(() => {
    const p = activeProject()
    setProject(p)
    setAuditProject(p?.id ?? null)
    setThresholds(loadThresholds())
    setDemoMode(getSetting(SETTING_KEYS.DEMO_MODE) === 'true')
  }, [])

  // ------------------------------------------------------------- boot
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await openDatabase()
        migrate()
        await requestPersistentStorage()
        if (cancelled) return
        setStorageBackend(backendName())

        const setupDone = getSetting(SETTING_KEYS.SETUP_COMPLETE) === 'true' && hasAdministrator()
        reloadProject()
        setPhase(setupDone ? 'LOGIN' : 'SETUP')
      } catch (err) {
        if (cancelled) return
        setBootError(
          err instanceof DatabaseCorruptError
            ? err.message
            : 'The local database could not be opened on this device.',
        )
        setPhase('ERROR')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadProject])

  // -------------------------------------------------- network awareness
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  // --------------------------------------- flush on background/close
  useEffect(() => {
    const onHide = () => {
      void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  // ------------------------------------------------- inactivity lock
  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    if (phase !== 'READY' || !user) return
    const minutes = Number(getSetting(SETTING_KEYS.SESSION_TIMEOUT_MINUTES) ?? 5)
    if (!minutes) return

    const reset = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setLocked(true), minutes * 60_000)
    }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'focus']
    events.forEach((e) => window.addEventListener(e, reset))
    reset()
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset))
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [phase, user, dataVersion])

  const signIn = useCallback(
    (u: User) => {
      setAuditActor({ id: u.id, username: u.username, role: u.role_code })
      setUser(u)
      setLocked(false)
      reloadProject()
      setPhase('READY')
    },
    [reloadProject],
  )

  const signOut = useCallback(async () => {
    await recordLogout(user)
    await flush()
    clearAuditActor()
    setUser(null)
    setLocked(false)
    setPhase('LOGIN')
  }, [user])

  const completeSetup = useCallback(() => {
    reloadProject()
    setPhase('LOGIN')
  }, [reloadProject])

  const permissions = useMemo(
    () => (user ? permissionsForRole(user.role_code) : new Set<string>()),
    [user],
  )

  const can = useCallback((permission: string) => permissions.has(permission), [permissions])

  const value = useMemo<AppContextValue>(
    () => ({
      phase,
      bootError,
      user,
      project,
      thresholds,
      demoMode,
      online,
      locked,
      dataVersion,
      storageBackend,
      can,
      refresh,
      signIn,
      signOut,
      lock: () => setLocked(true),
      unlock: () => setLocked(false),
      completeSetup,
      reloadProject,
    }),
    [
      phase, bootError, user, project, thresholds, demoMode, online, locked,
      dataVersion, storageBackend, can, refresh, signIn, signOut, completeSetup,
      reloadProject,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

/** Re-runs a database read whenever data changes. */
export function useQuery<T>(fn: () => T, deps: unknown[] = []): T {
  const { dataVersion } = useApp()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(fn, [dataVersion, ...deps])
}

export function useStorageInfo(): { sizeBytes: number; backend: string } {
  const { dataVersion, storageBackend } = useApp()
  return useMemo(
    () => ({ sizeBytes: databaseSizeBytes(), backend: storageBackend }),
    [dataVersion, storageBackend],
  )
}
