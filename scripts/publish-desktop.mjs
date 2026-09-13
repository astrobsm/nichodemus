/**
 * Publishes the desktop installer that has already been built.
 *
 *   npm run publish:desktop
 *
 * This is what lets installed desktop copies update themselves:
 * electron-updater inside the application reads latest.yml from the project's
 * GitHub releases, compares the version, and downloads the installer beside
 * it. Until a release exists there, the desktop application checks, finds
 * nothing, and silently carries on with what it has.
 *
 * It uploads what `npm run release` already produced rather than rebuilding,
 * because the installer is 124 MB and a rebuild takes minutes for no gain.
 * The artefacts are checked against package.json first, so a stale build
 * cannot be published under a version it is not.
 */
import { execFileSync, execSync } from 'node:child_process'
import { checkToken, githubToken } from './github-token.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = pkg.version
const tag = `v${version}`
const dir = resolve(root, 'release/desktop')

let step = 0
const say = (what) => console.log(`\n[${++step}] ${what}`)

// Found once, up front, and handed to every gh call. A machine that can push
// to this repository already holds a credential GitHub accepts; making
// somebody sign the CLI in separately achieves nothing but the delay.
const found = githubToken(root)

function gh(args, options = {}) {
  return execFileSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    env: found ? { ...process.env, GH_TOKEN: found.token } : process.env,
    ...options,
  })
}

function ghQuiet(args) {
  try {
    gh(args)
    return true
  } catch {
    return false
  }
}

// ------------------------------------------------------------- who are we

say('Finding a way to authenticate')
if (!found) {
  console.error(
    '\nNo GitHub credential could be found on this machine.\n\n' +
      'Signing in to github.com in a web browser does not sign in the\n' +
      'command-line tool - they keep separate sessions. In a terminal, run:\n\n' +
      '    gh auth login\n\n' +
      'or set GH_TOKEN to a token with "repo" scope.\n',
  )
  process.exit(1)
}
const identity = checkToken(found.token)
if (!identity) {
  console.error(
    `\nThe credential from ${found.source} was not accepted by GitHub.\n` +
      'It may have expired. Run `gh auth login`, or set GH_TOKEN.\n',
  )
  process.exit(1)
}
if (!identity.canWrite) {
  console.error(
    `\nThe credential from ${found.source} belongs to ${identity.login} but\n` +
      `carries only: ${identity.scopes}\n` +
      'Publishing a release needs the "repo" scope.\n',
  )
  process.exit(1)
}
console.log(`    using ${found.source}, as ${identity.login}`)

// ------------------------------------------------------------ the payload

say('Checking what was built')
const artefacts = [
  `NUG-Outreach-Setup-${version}.exe`,
  `NUG-Outreach-Setup-${version}.exe.blockmap`,
  'latest.yml',
]
const missing = artefacts.filter((f) => !existsSync(resolve(dir, f)))
if (missing.length > 0) {
  console.error(
    `\nMissing from release/desktop: ${missing.join(', ')}\n\n` +
      'Build the desktop installer first:\n\n    npm run release\n',
  )
  process.exit(1)
}

// latest.yml is the file electron-updater actually reads. If it names a
// different version from the installer beside it, every desktop copy would
// be told about an update it then fails to download.
const feed = readFileSync(resolve(dir, 'latest.yml'), 'utf8')
const feedVersion = feed.match(/^version:\s*(.+)$/m)?.[1]?.trim()
if (feedVersion !== version) {
  console.error(
    `\nlatest.yml says version ${feedVersion}, but package.json says ${version}.\n` +
      'Publishing that would advertise an update that cannot be downloaded.\n' +
      'Rebuild with `npm run release` and try again.\n',
  )
  process.exit(1)
}
if (!feed.includes(`NUG-Outreach-Setup-${version}.exe`)) {
  console.error('\nlatest.yml does not point at the installer beside it. Rebuild.\n')
  process.exit(1)
}
console.log(`    installer, blockmap and update feed all say ${version}`)

// ---------------------------------------------------------- the release

const exists = ghQuiet(['release', 'view', tag])
say(exists ? `Updating release ${tag}` : `Creating release ${tag}`)

if (!exists) {
  gh(
    [
      'release',
      'create',
      tag,
      '--title',
      `NUG Outreach ${version}`,
      '--notes',
      'Desktop installer for the Nichodemus Ugbor Memorial Community Health Outreach.\n\n' +
        'Installed desktop copies update themselves from this release: they check on\n' +
        'startup and daily, download in the background, and install when the\n' +
        'application is next closed.',
    ],
    { inherit: true },
  )
}

gh(['release', 'upload', tag, ...artefacts.map((f) => resolve(dir, f)), '--clobber'], {
  inherit: true,
})

// --------------------------------------------------------------- verify

say('Checking that a desktop application could actually fetch this')
const url = `https://github.com/${
  pkg.build?.publish?.[0]?.owner ?? 'astrobsm'
}/${pkg.build?.publish?.[0]?.repo ?? 'nichodemus'}/releases/latest/download/latest.yml`

try {
  const fetched = execSync(`curl -sL --max-time 60 "${url}"`, { cwd: root, encoding: 'utf8' })
  if (!fetched.includes(`version: ${version}`)) {
    console.error(
      `\nThe published update feed does not read back correctly from\n  ${url}\n` +
        'Desktop copies would not see this release.\n',
    )
    process.exit(1)
  }
  console.log('    the update feed is live and readable')
} catch {
  console.log('    could not read it back just now; check the release page yourself')
}

say('Done')
console.log(`
    ${tag} published.

    Desktop copies already installed will find it: they check on startup and
    once a day, download in the background, and install when the application
    is next closed. Nothing interrupts anyone mid-consultation.
`)
