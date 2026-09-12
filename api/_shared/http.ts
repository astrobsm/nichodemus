/**
 * Shared HTTP concerns for the cloud endpoints: CORS and JSON replies.
 *
 * CORS is not optional here. The browser build is served from the same origin
 * as the API, but the other two are not:
 *
 *   Android APK   origin https://localhost   (Capacitor's WebView scheme)
 *   Desktop       origin app://local         (Electron's private scheme)
 *
 * Both are cross-origin calls carrying a custom `x-sync-token` header, which
 * makes the browser send a preflight OPTIONS first. Without the headers below
 * every synchronisation from a phone or a laptop is refused by the browser
 * before it ever reaches this code — and the failure looks like a network
 * problem rather than a missing header.
 */

/** Origins the application itself runs from. */
const APP_ORIGINS = [
  'https://localhost', // Capacitor on Android
  'http://localhost', // Capacitor fallback
  'capacitor://localhost', // Capacitor on iOS
  'app://local', // Electron desktop
  'app://.', // Electron on some platforms
]

/** Local development servers. */
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/**
 * Any deployment of this application. Vercel gives preview builds their own
 * hostnames, and a self-hosted copy will have its own domain, so the site's
 * own origin is always allowed.
 */
function isOwnDeployment(origin: string): boolean {
  const extra = (process.env.SYNC_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (extra.includes(origin)) return true

  try {
    const { hostname, protocol } = new URL(origin)
    if (protocol !== 'https:') return false
    if (hostname.endsWith('.vercel.app')) return true
    const own = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
    return Boolean(own) && hostname === own
  } catch {
    return false
  }
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  if (APP_ORIGINS.includes(origin)) return true
  if (DEV_ORIGIN.test(origin)) return true
  return isOwnDeployment(origin)
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-sync-token',
    'Access-Control-Max-Age': '86400',
  }
  // Only a recognised origin is echoed back. An unknown site gets no header
  // and the browser blocks it, which is the point.
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin as string
  return headers
}

export interface EndpointResult {
  status: number
  body: unknown
}

export const reply = (body: unknown, status = 200): EndpointResult => ({ status, body })

/** Preflight. Answered for any origin; only an allowed one gets the header. */
export function preflight(origin: string | null): { status: number; headers: Record<string, string> } {
  return { status: 204, headers: corsHeaders(origin) }
}
