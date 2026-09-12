/**
 * Keeping installed copies current.
 *
 * The bug this guards against is quiet and severe: a service worker whose
 * file never changes between deployments. The browser sees no difference,
 * concludes there is no update, and an installed application serves the code
 * it was installed with for ever. Nothing fails, nothing is logged, and the
 * team runs last month's clinical thresholds.
 *
 * So the tests that matter most are about the stamping, not the UI.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { versionPayload } from '../api/version'
import { APP_BUILD, APP_VERSION } from '../src/core/buildInfo'

describe('the service worker can be told apart between deployments', () => {
  const source = readFileSync(resolve('public/sw.js'), 'utf8')

  it('carries a marker the build replaces', () => {
    expect(source).toContain('__BUILD__')
  })

  it('names its cache after the build', () => {
    // A fixed cache name is the other half of the same bug: even a new worker
    // would go on serving the old cached files.
    expect(source).toMatch(/const CACHE = `nug-outreach-\$\{BUILD\}`/)
  })

  it('does not take over on its own', () => {
    // skipWaiting() during install swaps the code under a nurse who may be
    // halfway through a reading.
    const install = source
      .slice(source.indexOf("addEventListener('install'"), source.indexOf("addEventListener('activate'"))
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(install).not.toContain('skipWaiting')
  })

  it('takes over when the page says it is safe', () => {
    expect(source).toContain("data.type === 'SKIP_WAITING'")
    expect(source).toContain('self.skipWaiting()')
  })

  it('removes the previous build’s cache when it activates', () => {
    expect(source).toContain("k.startsWith('nug-outreach-') && k !== CACHE")
  })

  it('answers "which build are you?" on the port it was asked through', () => {
    // event.source is null for a message sent over a MessageChannel, so a
    // worker that replies only to it answers nobody.
    expect(source).toContain('event.ports[0].postMessage(reply)')
  })

  it('never caches the API', () => {
    // A cached sign-in or version answer is worse than no answer.
    expect(source).toContain("url.pathname.startsWith('/api/')")
  })
})

describe('stamping a build', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nug-stamp-'))
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* already gone */
    }
  })

  it('identifies the commit, not the moment of building', async () => {
    // @ts-expect-error - plain JS build script, no type declarations
    const { buildInfo } = await import('../scripts/stamp-build.mjs')
    const info = buildInfo()
    expect(info.version).toBe(APP_VERSION)
    expect(info.build).toMatch(/^[0-9a-f]{9}$|^nogit$/)
    expect(info.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('gives the same answer twice, so separate builds of one commit agree', async () => {
    // The phone, the desktop installer and the deployment are built by three
    // different commands. If the identity moved with the clock they would
    // never match and every device would announce a permanent update.
    // @ts-expect-error - plain JS build script, no type declarations
    const { buildInfo } = await import('../scripts/stamp-build.mjs')
    expect(buildInfo().build).toBe(buildInfo().build)
  })

  it('knows when it cannot identify the commit', async () => {
    // Such a build would disagree with every other build of the same source,
    // and every device would be told for ever that an update exists. The
    // release script refuses to publish one; this is the flag it reads.
    // @ts-expect-error - plain JS build script, no type declarations
    const { buildInfo } = await import('../scripts/stamp-build.mjs')
    const info = buildInfo()
    expect(info.known).toBe(info.build !== 'nogit')
  })

  it('replaces the marker in a built service worker', async () => {
    // @ts-expect-error - plain JS build script, no type declarations
    const { stampServiceWorker } = await import('../scripts/stamp-build.mjs')
    const distDir = resolve('dist')
    const existed = existsSync(join(distDir, 'sw.js'))
    const original = existed ? readFileSync(join(distDir, 'sw.js'), 'utf8') : null
    try {
      mkdirSync(distDir, { recursive: true })
      writeFileSync(join(distDir, 'sw.js'), "const BUILD = '__BUILD__'\n")
      const done = stampServiceWorker({ build: 'testbuild-123' })
      expect(done).toBe(true)
      const after = readFileSync(join(distDir, 'sw.js'), 'utf8')
      expect(after).toContain('testbuild-123')
      expect(after).not.toContain('__BUILD__')
    } finally {
      if (original !== null) writeFileSync(join(distDir, 'sw.js'), original)
    }
  })

  it('refuses to report success when the marker is absent', async () => {
    // @ts-expect-error - plain JS build script, no type declarations
    const { stampServiceWorker } = await import('../scripts/stamp-build.mjs')
    const distDir = resolve('dist')
    const original = existsSync(join(distDir, 'sw.js'))
      ? readFileSync(join(distDir, 'sw.js'), 'utf8')
      : null
    try {
      mkdirSync(distDir, { recursive: true })
      // A worker with no marker was built from something other than the
      // current public/sw.js. Replacing nothing must not be reported as a
      // successful stamp: the release script stops on a false here, and the
      // alternative is shipping a worker identical to the last deployment's.
      writeFileSync(join(distDir, 'sw.js'), "const BUILD = 'already-stamped'")
      expect(stampServiceWorker({ build: 'x' })).toBe(false)
    } finally {
      if (original !== null) writeFileSync(join(distDir, 'sw.js'), original)
    }
  })
})

describe('what the server reports', () => {
  it('names the build this deployment is running', () => {
    const payload = versionPayload('https://nichodemus.vercel.app')
    expect(payload.ok).toBe(true)
    expect(payload.build).toBe(APP_BUILD)
    expect(payload.version).toBe(APP_VERSION)
  })

  it('points a phone at a package on this same deployment', () => {
    const payload = versionPayload('https://nichodemus.vercel.app')
    expect(payload.downloads.android).toBe(
      'https://nichodemus.vercel.app/download/nug-outreach.apk',
    )
  })

  it('points the desktop at the release feed electron-updater reads', () => {
    const payload = versionPayload('https://nichodemus.vercel.app')
    expect(payload.downloads.desktop).toMatch(
      /^https:\/\/github\.com\/astrobsm\/nichodemus\/releases\/latest\/download\//,
    )
  })

  it('says plainly that Android cannot update itself unattended', () => {
    // Android forbids a sideloaded application from installing without the
    // person confirming. Claiming otherwise would be found out at the worst
    // possible moment.
    expect(versionPayload(null).updates.android).toBe('download-and-confirm')
    expect(versionPayload(null).updates.pwa).toBe('automatic')
    expect(versionPayload(null).updates.desktop).toBe('automatic')
  })

  it('reveals nothing about the outreach', () => {
    const text = JSON.stringify(versionPayload('https://nichodemus.vercel.app'))
    for (const forbidden of ['participant', 'user', 'project', 'token', 'turso']) {
      expect(text.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('still answers when it cannot tell where it is hosted', () => {
    const payload = versionPayload(null)
    expect(payload.ok).toBe(true)
    expect(payload.downloads.android).toBe('/download/nug-outreach.apk')
  })
})

describe('deciding whether this copy is out of date', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.unstubAllGlobals()
  })

  async function checkWith(serverBuild: string | null, swWaiting = false) {
    vi.stubGlobal('window', {
      location: { origin: 'https://nichodemus.vercel.app', protocol: 'https:', hostname: 'nichodemus.vercel.app' },
      matchMedia: () => ({ matches: false }),
      navigator: {},
    })
    globalThis.fetch = (async () =>
      serverBuild === null
        ? { ok: false, json: async () => ({}) }
        : {
            ok: true,
            json: async () => ({
              ok: true,
              version: '1.0.0',
              build: serverBuild,
              builtAt: '2026-09-12T00:00:00.000Z',
              downloads: { android: '/download/nug-outreach.apk', desktop: 'x' },
            }),
          }) as unknown as typeof fetch

    const { checkForUpdate } = await import('../src/services/appUpdate')
    return checkForUpdate(swWaiting)
  }

  it('says nothing when the server is running the same build', async () => {
    const state = await checkWith(APP_BUILD)
    expect(state.available).toBe(false)
  })

  it('notices when the server has moved on', async () => {
    const state = await checkWith('20991231.2359-deadbeef0')
    expect(state.available).toBe(true)
    expect(state.latestBuild).toBe('20991231.2359-deadbeef0')
  })

  it('is silent, not broken, when there is no connection', async () => {
    // A device in a village with no signal must be told nothing at all.
    const state = await checkWith(null)
    expect(state.available).toBe(false)
    expect(state.error).toBeNull()
  })

  it('reports an already-downloaded update as ready to apply', async () => {
    const state = await checkWith(APP_BUILD, true)
    expect(state.available).toBe(true)
    expect(state.ready).toBe(true)
    expect(state.howToApply).toBe('RELOAD')
  })
})
