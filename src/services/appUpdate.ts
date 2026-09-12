/**
 * Keeping every installed copy of the application current.
 *
 * There are three kinds of copy and they update by three different routes:
 *
 *   - The web page and the installed PWA update through the service worker.
 *     A new deployment changes sw.js, the browser installs it in the
 *     background, and the new code waits until it is told to take over.
 *   - The desktop application updates through electron-updater, which
 *     downloads in the background and installs when the application is next
 *     closed. The main process tells the page when that is ready.
 *   - The Android application cannot. Android does not permit a sideloaded
 *     application to install anything without the person confirming it, so
 *     the best that is honest is to notice, say so, and hand over a download
 *     that opens the system installer in one tap.
 *
 * THE RULE THIS FILE EXISTS TO PROTECT
 * ------------------------------------
 * An update never interrupts care. Nothing here reloads the page by itself,
 * and nothing here runs on the path of registering a participant or
 * recording a reading. A device with no signal is never worse off: every
 * check fails silently and the application carries on with the code it has.
 */
import { APP_BUILD, APP_VERSION, BUILT_AT } from '../core/buildInfo'
import { defaultEndpoint } from './cloudAuth'

export { APP_BUILD, APP_VERSION, BUILT_AT }

export type Platform = 'WEB' | 'PWA' | 'ANDROID' | 'DESKTOP'

export interface UpdateState {
  /** Something newer exists and this copy is not it. */
  available: boolean
  /** The new code is downloaded and one action away from being live. */
  ready: boolean
  platform: Platform
  currentBuild: string
  latestBuild: string | null
  latestVersion: string | null
  /** Where to get the packaged build, when that is how this copy updates. */
  downloadUrl: string | null
  /** Whether applying it is a single tap here, or a download and a confirm. */
  howToApply: 'RELOAD' | 'RESTART' | 'DOWNLOAD' | 'NONE'
  checkedAt: string | null
  error: string | null
}

interface DesktopUpdateBridge {
  check(): Promise<{ available: boolean; version?: string } | null>
  onReady(listener: (info: { version?: string }) => void): void
  install(): void
}

interface UpdateBridgeWindow {
  nugUpdate?: DesktopUpdateBridge
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }
}

function bridge(): UpdateBridgeWindow {
  return window as unknown as UpdateBridgeWindow
}

export function platform(): Platform {
  if (typeof window === 'undefined') return 'WEB'
  if (bridge().nugUpdate) return 'DESKTOP'

  const cap = bridge().Capacitor
  if (cap?.isNativePlatform?.()) return 'ANDROID'

  // An installed PWA runs in its own window rather than a browser tab.
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return standalone ? 'PWA' : 'WEB'
}

export function idleState(): UpdateState {
  return {
    available: false,
    ready: false,
    platform: platform(),
    currentBuild: APP_BUILD,
    latestBuild: null,
    latestVersion: null,
    downloadUrl: null,
    howToApply: 'NONE',
    checkedAt: null,
    error: null,
  }
}

// -------------------------------------------------------- the server's view

export interface ServerVersion {
  version: string
  build: string
  builtAt: string
  downloads: { android: string; desktop: string }
}

/** Asks the deployment what the current build is. Never throws. */
export async function fetchServerVersion(timeoutMs = 12_000): Promise<ServerVersion | null> {
  const endpoint = defaultEndpoint()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${endpoint}/api/version`, {
      // Asking for the current version through a cache would defeat it.
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const json = (await response.json()) as { ok?: boolean } & ServerVersion
    return json?.ok ? json : null
  } catch {
    // Offline, or no deployment configured. Not an error worth showing.
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ------------------------------------------------------- the service worker

let waitingWorker: ServiceWorker | null = null

/**
 * Watches for a new service worker and reports when one is waiting.
 *
 * Returns a function that stops watching.
 */
export function watchServiceWorker(onWaiting: () => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {}

  let stopped = false
  let interval: ReturnType<typeof setInterval> | undefined
  let stopFocus = () => {}

  const note = (worker: ServiceWorker | null) => {
    if (stopped || !worker) return
    waitingWorker = worker
    onWaiting()
  }

  navigator.serviceWorker.ready
    .then((registration) => {
      if (stopped) return

      // Already waiting when the page opened - the update arrived last time.
      if (registration.waiting && navigator.serviceWorker.controller) {
        note(registration.waiting)
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          // "installed" with a controller present means an update, not a
          // first install. Announcing a first install as an update would ask
          // someone to reload the page they just opened.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            note(installing)
          }
        })
      })

      // Browsers check for a new worker on navigation, which a single-page
      // application performs once a week. Ask explicitly instead.
      const check = () => void registration.update().catch(() => undefined)
      check()
      interval = setInterval(check, 30 * 60_000)
      window.addEventListener('focus', check)
      stopFocus = () => window.removeEventListener('focus', check)
    })
    .catch(() => undefined)

  return () => {
    stopped = true
    if (interval) clearInterval(interval)
    stopFocus()
  }
}

/**
 * Lets the waiting service worker take over, then reloads once it has.
 *
 * The reload waits for controllerchange rather than happening immediately,
 * or the page would reload into the old worker and appear not to have
 * updated at all.
 */
export function applyServiceWorkerUpdate(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    window.location.reload()
    return
  }

  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })

  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
  } else {
    navigator.serviceWorker.ready
      .then((r) => r.waiting?.postMessage({ type: 'SKIP_WAITING' }))
      .catch(() => undefined)
  }

  // If the worker never hands over - an old browser, or no worker at all -
  // a plain reload is still better than a button that does nothing.
  setTimeout(() => {
    if (!reloaded) window.location.reload()
  }, 4000)
}

// ------------------------------------------------------------- the desktop

export function watchDesktop(onReady: (version?: string) => void): void {
  bridge().nugUpdate?.onReady((info) => onReady(info?.version))
}

export function installDesktopUpdate(): void {
  bridge().nugUpdate?.install()
}

// ------------------------------------------------------------- the whole job

/**
 * One update check, for whichever kind of copy this is.
 *
 * `swWaiting` is passed in by the caller, which is watching the service
 * worker continuously; this function only has to fold that in.
 */
export async function checkForUpdate(swWaiting: boolean): Promise<UpdateState> {
  const state = idleState()
  const kind = state.platform

  if (kind === 'DESKTOP') {
    try {
      const result = await bridge().nugUpdate?.check()
      state.available = Boolean(result?.available)
      state.latestVersion = result?.version ?? null
      state.howToApply = state.available ? 'RESTART' : 'NONE'
    } catch {
      // No feed configured yet, or no connection. Nothing to say.
    }
    state.checkedAt = new Date().toISOString()
    return state
  }

  if (swWaiting) {
    // The new code is already downloaded and sitting behind the current one.
    state.available = true
    state.ready = true
    state.howToApply = 'RELOAD'
  }

  const server = await fetchServerVersion()
  state.checkedAt = new Date().toISOString()
  if (!server) return state

  state.latestBuild = server.build
  state.latestVersion = server.version

  if (server.build !== APP_BUILD) {
    state.available = true
    if (kind === 'ANDROID') {
      state.downloadUrl = server.downloads.android
      state.howToApply = 'DOWNLOAD'
    } else if (!state.ready) {
      // The server has something newer but the worker has not fetched it
      // yet. Reloading will pick it up.
      state.howToApply = 'RELOAD'
    }
  }

  return state
}
