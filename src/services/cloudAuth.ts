/**
 * Signing in against the outreach in the cloud.
 *
 * Exists so that a nurse, doctor, pharmacist or administrator opening the
 * application on a device it has never run on does not have to set up an
 * outreach, or be handed a device key, before they can work. They enter the
 * username and PIN their administrator gave them; everything else — the
 * synchronisation key, the participant-number block, the outreach itself —
 * arrives with the answer.
 *
 * The PIN is checked against the same PBKDF2 derivation the devices store. It
 * is sent over HTTPS to be verified and is never stored by the server.
 */

export interface CloudProbe {
  reachable: boolean
  /** True when the cloud holds an outreach and at least one active account. */
  ready: boolean
  outreach: string | null
}

export interface CloudSignIn {
  syncToken: string
  serialBlock: number
  user: { username: string; fullName: string; role: string; mustChangePin: boolean }
}

export class CloudAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudAuthError'
  }
}

/**
 * The address this build was compiled with, if any.
 *
 * The Android and desktop builds run from private schemes and cannot work out
 * where the outreach lives, so the address is baked in at build time (.env,
 * VITE_CLOUD_ENDPOINT). Without it every nurse installing the application
 * would have to be told a URL to type on a phone keyboard, which is exactly
 * the kind of step that does not survive a field day.
 */
export function builtInEndpoint(): string {
  const configured = import.meta.env.VITE_CLOUD_ENDPOINT
  return typeof configured === 'string' ? configured.trim().replace(/\/+$/, '') : ''
}

/**
 * Where this build should look for the outreach by default.
 *
 * The hosted web application is served from the same origin as the API, so it
 * can find it without being told. The packaged builds fall back to the
 * address compiled into them.
 */
export function defaultEndpoint(): string {
  if (typeof window === 'undefined') return builtInEndpoint()
  const { origin, protocol, hostname } = window.location
  if (protocol !== 'https:' && protocol !== 'http:') return builtInEndpoint()
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // The Android build is served from https://localhost by Capacitor, and a
    // developer's dev server is served from http://localhost. Neither has an
    // API beside it, so both use the address this build carries.
    return builtInEndpoint()
  }
  return origin
}

function normalise(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

async function call(endpoint: string, body: unknown, timeoutMs = 20_000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${normalise(endpoint)}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const json = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null
    if (!json) throw new CloudAuthError('The outreach did not answer in a way we understand.')
    if (!json.ok) throw new CloudAuthError(json.error ?? 'The outreach refused the request.')
    return json
  } catch (err) {
    if (err instanceof CloudAuthError) throw err
    if ((err as Error)?.name === 'AbortError') {
      throw new CloudAuthError('The outreach did not answer in time. Check the connection.')
    }
    throw new CloudAuthError(
      'The outreach could not be reached. Check the address and the connection.',
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Asks whether there is an outreach at this address, without signing in. */
export async function probeCloud(endpoint: string): Promise<CloudProbe> {
  if (!normalise(endpoint)) return { reachable: false, ready: false, outreach: null }
  try {
    const result = (await call(endpoint, { action: 'probe' }, 12_000)) as {
      ready?: boolean
      outreach?: string | null
    }
    return {
      reachable: true,
      ready: Boolean(result.ready),
      outreach: result.outreach ?? null,
    }
  } catch {
    return { reachable: false, ready: false, outreach: null }
  }
}

export async function cloudSignIn(
  endpoint: string,
  username: string,
  pin: string,
  deviceId: string,
): Promise<CloudSignIn> {
  const result = (await call(endpoint, {
    username: username.trim(),
    pin,
    deviceId,
  })) as CloudSignIn
  if (!result.syncToken) {
    throw new CloudAuthError('The outreach did not return a synchronisation key.')
  }
  return result
}
