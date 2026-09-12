/**
 * What the deployed application currently is, and where to get the packaged
 * builds of it.
 *
 * Every copy of the application - the hosted web page, an installed PWA, the
 * Android app and the desktop application - asks this endpoint whether it is
 * out of date. It is deliberately the only endpoint that needs no device key:
 * a phone that has been reset, or one whose key was revoked, still has to be
 * able to find out that it is running old code.
 *
 * It reveals nothing about the outreach - no project, no names, no counts.
 */
import { corsHeaders } from './_shared/http.js'
import { APP_BUILD, APP_VERSION, BUILT_AT } from './_shared/buildInfo.js'

export const config = { runtime: 'nodejs' }

/**
 * Where the packaged builds live.
 *
 * The Android package is served from this deployment, so a phone can update
 * itself with nothing else set up. The desktop installer is 124 MB - far too
 * large to ship in a web deployment - so it comes from the project's GitHub
 * releases, which is also where electron-updater looks.
 */
const GITHUB_LATEST = 'https://github.com/astrobsm/nichodemus/releases/latest/download'

export function versionPayload(origin: string | null) {
  const base = origin && /^https?:\/\//.test(origin) ? origin.replace(/\/+$/, '') : ''
  return {
    ok: true,
    version: APP_VERSION,
    build: APP_BUILD,
    builtAt: BUILT_AT,
    downloads: {
      android: `${base}/download/nug-outreach.apk`,
      desktop: `${GITHUB_LATEST}/NUG-Outreach-Setup-${APP_VERSION}.exe`,
    },
    // How each kind of copy is expected to update itself, so the application
    // can say something true rather than something generic.
    updates: {
      web: 'automatic',
      pwa: 'automatic',
      desktop: 'automatic',
      // Android forbids a sideloaded application from installing anything
      // without the person confirming it. Saying "automatic" here would be a
      // lie the user would discover at the worst moment.
      android: 'download-and-confirm',
    },
  }
}

interface NodeRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
}

interface NodeResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body: string): void
}

function headerValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export async function webHandler(request: Request): Promise<Response> {
  const cors = corsHeaders(request.headers.get('origin'))
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const url = new URL(request.url)
  return new Response(JSON.stringify(versionPayload(url.origin)), {
    status: 200,
    headers: {
      ...cors,
      'content-type': 'application/json',
      // Never cached: the entire purpose is to report what is current.
      'cache-control': 'no-store, max-age=0',
    },
  })
}

export default async function handler(
  request: NodeRequest,
  response: NodeResponse,
): Promise<void> {
  const origin = headerValue(request.headers.origin)
  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    response.setHeader(name, value)
  }
  if ((request.method ?? 'GET') === 'OPTIONS') {
    response.statusCode = 204
    response.end('')
    return
  }

  const host = headerValue(request.headers['x-forwarded-host']) ?? headerValue(request.headers.host)
  const proto = headerValue(request.headers['x-forwarded-proto']) ?? 'https'
  const self = host ? `${proto}://${host}` : null

  response.statusCode = 200
  response.setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'no-store, max-age=0')
  response.end(JSON.stringify(versionPayload(self)))
}
