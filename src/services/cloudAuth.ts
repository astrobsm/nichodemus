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
 * Where this build should look for the outreach by default.
 *
 * The hosted web application is served from the same origin as the API, so it
 * can find it without being told. The Android and desktop builds run from
 * private schemes (https://localhost and app://local), which are not the
 * cloud, so those ask for the address once.
 */
export function defaultEndpoint(): string {
  if (typeof window === 'undefined') return ''
  const { origin, protocol, hostname } = window.location
  if (protocol !== 'https:' && protocol !== 'http:') return ''
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // A local dev server has no API beside it unless it is the real one.
    return import.meta.env.DEV ? '' : origin
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
