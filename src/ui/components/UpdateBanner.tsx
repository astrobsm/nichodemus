/**
 * Tells the person that a newer version exists, and lets them take it when
 * it suits them.
 *
 * Never on its own initiative: the banner appears, and nothing happens until
 * it is tapped. An outreach runs to a queue of people, and software that
 * reloads itself because a deployment finished is software that throws away
 * the reading someone was halfway through typing.
 *
 * It is also dismissible. A nurse who is busy should be able to make it go
 * away and be reminded at the end of the session rather than fight it.
 */
import { useEffect, useState } from 'react'
import {
  APP_BUILD,
  applyServiceWorkerUpdate,
  checkForUpdate,
  idleState,
  installDesktopUpdate,
  watchDesktop,
  watchServiceWorker,
  type UpdateState,
} from '../../services/appUpdate'

/** How long a dismissal lasts before the banner comes back. */
const SNOOZE_MS = 4 * 60 * 60 * 1000

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>(idleState)
  const [dismissedUntil, setDismissedUntil] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    let swWaiting = false

    const run = () => {
      void checkForUpdate(swWaiting).then((next) => {
        if (!cancelled) setState(next)
      })
    }

    const stopSw = watchServiceWorker(() => {
      swWaiting = true
      run()
    })

    watchDesktop((version) => {
      if (cancelled) return
      setState((prev) => ({
        ...prev,
        available: true,
        ready: true,
        latestVersion: version ?? prev.latestVersion,
        howToApply: 'RESTART',
      }))
    })

    run()
    // Hourly, so a device left running through a long outreach still notices.
    const timer = setInterval(run, 60 * 60_000)

    return () => {
      cancelled = true
      stopSw()
      clearInterval(timer)
    }
  }, [])

  if (!state.available) return null
  if (Date.now() < dismissedUntil) return null

  const snooze = () => setDismissedUntil(Date.now() + SNOOZE_MS)

  const apply = () => {
    setBusy(true)
    if (state.howToApply === 'RESTART') {
      installDesktopUpdate()
      // The application is about to quit and reopen; nothing follows.
      return
    }
    applyServiceWorkerUpdate()
  }

  return (
    <div className="update-bar" role="status">
      <span className="glyph" aria-hidden="true">
        ⟳
      </span>
      <div className="grow">
        <div className="update-title">
          {state.howToApply === 'DOWNLOAD'
            ? 'A newer version of the app is available'
            : 'An update is ready'}
        </div>
        <div className="update-detail">
          {state.howToApply === 'RESTART'
            ? 'It will be installed when you close the application, or you can do it now.'
            : state.howToApply === 'DOWNLOAD'
              ? 'Download it and confirm the install. Your records are not affected.'
              : 'Nothing is lost — your records are on this device, not in the page.'}
        </div>
      </div>

      {state.howToApply === 'DOWNLOAD' && state.downloadUrl ? (
        <a
          className="btn small"
          href={state.downloadUrl}
          target="_blank"
          rel="noreferrer"
          onClick={snooze}
        >
          Download
        </a>
      ) : (
        <button className="btn small" onClick={apply} disabled={busy}>
          {busy ? 'Updating…' : state.howToApply === 'RESTART' ? 'Restart now' : 'Update now'}
        </button>
      )}

      <button className="update-dismiss" onClick={snooze} aria-label="Not now">
        ✕
      </button>
    </div>
  )
}

/** The build identifier, for the About screen and for bug reports. */
export function currentBuildLabel(): string {
  return APP_BUILD
}
