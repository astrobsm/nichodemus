/**
 * One command that puts a new version in front of every installed copy.
 *
 *   npm run release
 *
 * It builds the web application, the Android package and the desktop
 * installer from the same commit, deploys the web application, and publishes
 * the packaged builds so the installed ones can find them.
 *
 * WHY THIS IS ONE SCRIPT AND NOT FOUR
 * -----------------------------------
 * The three builds must carry the same build identity. If the Android
 * package were built from a different commit than the deployment, the phone
 * would compare its build against the server's, see a difference that is not
 * really an update, and offer a download for ever. Building them together is
 * what makes "is this copy current?" a question with an answer.
 *
 *   --skip-android    web and desktop only
 *   --skip-desktop    web and Android only (much faster: no 124 MB installer)
 *   --no-publish      build everything, deploy nothing
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const skipAndroid = args.includes('--skip-android')
const skipDesktop = args.includes('--skip-desktop')
const noPublish = args.includes('--no-publish')

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

let step = 0
const say = (what) => console.log(`\n[${++step}] ${what}`)

function run(command, options = {}) {
  execSync(command, { cwd: root, stdio: 'inherit', ...options })
}

function tryRun(command) {
  try {
    execSync(command, { cwd: root, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function generatedBuild() {
  const source = readFileSync(resolve(root, 'src/core/buildInfo.ts'), 'utf8')
  return source.match(/APP_BUILD = '([^']+)'/)?.[1] ?? 'unknown'
}

// --------------------------------------------------------------- checks

if (!tryRun('git diff --quiet && git diff --cached --quiet')) {
  console.error(
    '\nThere are uncommitted changes.\n\n' +
      'A release stamps itself with the current commit. Releasing with a dirty\n' +
      'tree would produce a build nobody can trace back to source. Commit first.\n',
  )
  process.exit(1)
}

// --------------------------------------------------------------- the web

say('Building the web application')
run('npm run build')
const build = generatedBuild()
console.log(`    build ${build}`)

if (!existsSync(resolve(root, 'dist/sw.js'))) {
  console.error('dist/sw.js is missing — installed copies would never update.')
  process.exit(1)
}
const sw = readFileSync(resolve(root, 'dist/sw.js'), 'utf8')
if (sw.includes('__BUILD__') || !sw.includes(build)) {
  console.error(
    '\nThe service worker was not stamped with this build.\n' +
      'An unstamped worker is byte-identical between deployments, so browsers\n' +
      'conclude there is no update and installed copies never refresh. Stopping.\n',
  )
  process.exit(1)
}
console.log('    service worker carries this build — installed copies will see it')

// ------------------------------------------------------------- android

if (!skipAndroid) {
  say('Building the Android package')
  run('npm run apk')
  const apk = resolve(root, 'public/download/nug-outreach.apk')
  if (!existsSync(apk)) {
    console.error('The APK was not published to public/download — phones would find nothing.')
    process.exit(1)
  }
  console.log('    published to public/download/nug-outreach.apk')
} else {
  console.log('\n    skipping Android')
}

// ------------------------------------------------------------- desktop

if (!skipDesktop) {
  say('Building the desktop installer')
  if (noPublish) {
    run('npx electron-builder --publish never')
  } else if (tryRun('gh auth status')) {
    // electron-builder publishes to GitHub releases, which is where
    // electron-updater in the installed application looks.
    const token = execSync('gh auth token', { cwd: root }).toString().trim()
    run('npx electron-builder --publish always', {
      env: { ...process.env, GH_TOKEN: token },
    })
    console.log('    published to GitHub releases — installed desktop copies will update')
  } else {
    run('npx electron-builder --publish never')
    console.log(
      '\n    NOT PUBLISHED. The desktop installer was built but not uploaded,\n' +
        '    so installed desktop copies have nothing to update from.\n' +
        '    Run `gh auth login` once, then `npm run release` again.',
    )
  }
} else {
  console.log('\n    skipping desktop')
}

// -------------------------------------------------------------- deploy

if (!noPublish) {
  say('Deploying the web application')
  run('npx vercel deploy --prod --yes')
}

say('Done')
console.log(`
    version ${pkg.version}
    build   ${build}

    Web and installed-to-home-screen copies pick this up on their own: the
    service worker changed, so the next time each device opens the
    application it downloads the update in the background and offers it.

    Desktop copies check on startup and daily, download in the background
    and install when the application is next closed.

    Android copies notice within the hour and offer the download. Android
    does not allow a sideloaded application to install an update without the
    person confirming it, so that last tap is theirs.
`)
