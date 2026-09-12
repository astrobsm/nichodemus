#!/usr/bin/env node
/**
 * One command, one installable APK.
 *
 *   npm run apk            debug build, installable immediately
 *   npm run apk -- --release   unsigned release build
 *   npm run apk -- --install   also push it to a connected phone over USB
 *
 * Does everything: builds the web app, creates the Android project if it is
 * missing, points Gradle at the local SDK, generates the launcher icons,
 * builds, and copies the result to release/ with a readable name.
 *
 * Requires a JDK (17 or newer) and an Android SDK. It finds both itself and
 * tells you exactly what is missing if it cannot.
 */
import { execFileSync, execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, platform } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = platform() === 'win32'
const args = process.argv.slice(2)
const wantRelease = args.includes('--release')
const wantInstall = args.includes('--install')

let step = 0
const say = (msg) => console.log(`\n[${++step}] ${msg}`)
const detail = (msg) => console.log(`    ${msg}`)
const fail = (msg, hint) => {
  console.error(`\n  ✗ ${msg}`)
  if (hint) console.error(`\n${hint}\n`)
  process.exit(1)
}

function run(command, options = {}) {
  execSync(command, { cwd: root, stdio: 'inherit', ...options })
}

// ----------------------------------------------------------- toolchain

/**
 * Capacitor 8 compiles against Java 21, and Gradle itself must run on a JVM
 * that new. A machine with only JDK 17 fails deep in the build with
 * "invalid source release: 21", so the version is checked up front.
 */
const REQUIRED_JAVA = 21

/** Reads the major version out of a JDK's own release file or its binary. */
function javaMajorOf(home) {
  try {
    const releaseFile = join(home, 'release')
    if (existsSync(releaseFile)) {
      const text = readFileSync(releaseFile, 'utf8')
      const m = text.match(/JAVA_VERSION="?(\d+)/)
      if (m) return Number(m[1])
    }
    const bin = join(home, 'bin', isWindows ? 'java.exe' : 'java')
    if (!existsSync(bin)) return 0
    const out = execFileSync(bin, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const m = out.match(/version "(\d+)/)
    return m ? Number(m[1]) : 0
  } catch {
    return 0
  }
}

function candidateJavaHomes() {
  const out = []
  if (process.env.JAVA_HOME) out.push(process.env.JAVA_HOME)

  // Whatever "java" on PATH resolves to.
  try {
    const props = execSync('java -XshowSettings:properties -version', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const m = props.match(/java\.home\s*=\s*(.+)/)
    if (m) out.push(m[1].trim())
  } catch {
    /* java not on PATH */
  }

  // JDKs Gradle has already downloaded for toolchain requests - on a machine
  // that has built this once, a suitable JDK is usually already sitting here.
  const gradleJdks = join(homedir(), '.gradle', 'jdks')
  if (existsSync(gradleJdks)) {
    for (const entry of readdirSync(gradleJdks)) {
      const dir = join(gradleJdks, entry)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      out.push(dir)
      // Some distributions unpack one level deeper.
      try {
        for (const inner of readdirSync(dir)) {
          const nested = join(dir, inner)
          if (existsSync(join(nested, 'bin'))) out.push(nested)
        }
      } catch {
        /* not readable */
      }
    }
  }

  // Common install locations.
  const roots = [
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    '/usr/lib/jvm',
    '/Library/Java/JavaVirtualMachines',
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      out.push(join(root, entry))
      out.push(join(root, entry, 'Contents', 'Home')) // macOS layout
    }
  }

  return out.filter((d) => d && existsSync(d))
}

function findJavaHome() {
  const seen = new Set()
  let best = null
  let bestVersion = 0

  for (const home of candidateJavaHomes()) {
    if (seen.has(home)) continue
    seen.add(home)
    const version = javaMajorOf(home)
    if (version > bestVersion) {
      bestVersion = version
      best = home
    }
    if (version >= REQUIRED_JAVA) return { home, version }
  }
  return best ? { home: best, version: bestVersion } : null
}

function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    join(homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
    '/usr/lib/android-sdk',
  ].filter(Boolean)

  for (const dir of candidates) {
    if (existsSync(join(dir, 'platforms'))) return dir
  }
  return null
}

say('Checking the build toolchain')

const java = findJavaHome()
if (!java) {
  fail(
    'No Java Development Kit found.',
    `Android builds need a JDK ${REQUIRED_JAVA} or newer.\n` +
      '  Install one:\n\n' +
      `    winget install Microsoft.OpenJDK.${REQUIRED_JAVA}      (Windows)\n` +
      '    brew install --cask temurin                  (macOS)\n' +
      '    https://adoptium.net                         (any platform)\n\n' +
      '  Everything else about this application works without it - the JDK is\n' +
      '  only needed to produce an APK. See docs/INSTALL.md for the browser\n' +
      '  install route, which needs no Android tooling at all.',
  )
}
if (java.version < REQUIRED_JAVA) {
  fail(
    `Java ${java.version} found, but Java ${REQUIRED_JAVA} or newer is required.`,
    `  Found at: ${java.home}\n\n` +
      '  Capacitor 8 compiles against Java 21. Install a newer JDK:\n\n' +
      `    winget install Microsoft.OpenJDK.${REQUIRED_JAVA}      (Windows)\n` +
      '    brew install --cask temurin                  (macOS)\n' +
      '    https://adoptium.net                         (any platform)\n\n' +
      '  This script then finds it automatically - you do not need to set\n' +
      '  JAVA_HOME yourself.',
  )
}
const javaHome = java.home
detail(`JDK ${java.version}: ${javaHome}`)

const sdk = findAndroidSdk()
if (!sdk) {
  fail(
    'No Android SDK found.',
    'Install the command line tools from\n' +
      '  https://developer.android.com/studio#command-line-tools-only\n' +
      '  then accept the licences and install a platform:\n\n' +
      '    sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"\n' +
      '    sdkmanager --licenses\n\n' +
      '  Or use the browser install route in docs/INSTALL.md, which needs none\n' +
      '  of this.',
  )
}
detail(`Android SDK: ${sdk}`)

// A bare SDK directory is not enough: Gradle needs a platform and build-tools.
const installedPlatforms = readdirSync(join(sdk, 'platforms')).filter((d) =>
  d.startsWith('android-'),
)
if (installedPlatforms.length === 0) {
  fail(
    'The Android SDK has no platform installed.',
    'Install one:\n\n    sdkmanager "platforms;android-35" "build-tools;35.0.0"',
  )
}
detail(`Platforms: ${installedPlatforms.join(', ')}`)

const buildToolsDir = join(sdk, 'build-tools')
const buildTools = existsSync(buildToolsDir) ? readdirSync(buildToolsDir) : []
if (buildTools.length === 0) {
  fail(
    'The Android SDK has no build-tools installed.',
    'Install them:\n\n    sdkmanager "build-tools;35.0.0"',
  )
}
detail(`Build tools: ${buildTools.join(', ')}`)

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
}

// -------------------------------------------------------------- build

// The published copy of the previous APK lives under public/, which vite
// copies wholesale into dist, which Capacitor then packages. Left in place,
// each release would ship the previous release inside itself and the file
// would double in size every time.
const publishedApk = resolve(root, 'public/download/nug-outreach.apk')
if (existsSync(publishedApk)) rmSync(publishedApk)

say('Building the web application')
run('npm run build')

const distIndex = resolve(root, 'dist/index.html')
if (!existsSync(distIndex)) fail('The web build produced no dist/index.html.')
detail('dist/ ready')

// ---------------------------------------------------- android project

const androidDir = resolve(root, 'android')

if (!existsSync(androidDir)) {
  say('Creating the Android project (first run only)')
  run('npx cap add android', { env })
} else {
  say('Android project already present')
}

// Gradle finds the SDK through this file rather than the environment.
writeFileSync(
  resolve(androidDir, 'local.properties'),
  `# Written by scripts/build-apk.mjs\nsdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`,
)
detail('local.properties written')

// Capacitor 8 asks Gradle for a Java 21 toolchain. Rather than require every
// builder to install a second JDK by hand, let Gradle fetch a matching one on
// demand. Applied idempotently, so deleting android/ and rebuilding is safe.
function ensureToolchainResolver() {
  const file = resolve(androidDir, 'settings.gradle')
  const current = readFileSync(file, 'utf8')
  if (current.includes('foojay-resolver')) return false

  const pluginBlock = `plugins {
    // Lets Gradle download a matching JDK when the build asks for a Java
    // toolchain this machine does not have. Added by scripts/build-apk.mjs.
    id 'org.gradle.toolchains.foojay-resolver-convention' version '0.8.0'
}

`
  // A settings plugins {} block must come before anything else in the file.
  writeFileSync(file, pluginBlock + current)
  return true
}

say('Checking the Java toolchain resolver')
detail(ensureToolchainResolver() ? 'added to settings.gradle' : 'already configured')

say('Copying the web build into the Android project')
run('npx cap sync android', { env })

say('Generating launcher icons from the outreach seal')
// Run as a subprocess rather than an import: make-brand.mjs regenerates every
// brand asset when it loads, and the Android launcher icons can only be
// written once "cap add android" has created the resources directory.
run('node scripts/make-brand.mjs')

// -------------------------------------------------------------- gradle

const task = wantRelease ? 'assembleRelease' : 'assembleDebug'
say(`Running Gradle (${task})`)
detail('The first build downloads Gradle and the Android plugin; be patient.')

// An absolute path: the working directory is not on PATH under every shell
// npm may hand us, and a bare "gradlew.bat" then fails to resolve.
const gradlew = resolve(androidDir, isWindows ? 'gradlew.bat' : 'gradlew')
if (!existsSync(gradlew)) fail(`The Gradle wrapper is missing at ${gradlew}.`)

try {
  run(`"${gradlew}" ${task} --no-daemon`, { cwd: androidDir, env })
} catch {
  fail(
    'The Gradle build failed.',
    'The output above says why. The usual causes are:\n' +
      '  - no internet on the first build (Gradle and the Android plugin are\n' +
      '    downloaded once, then cached)\n' +
      '  - a JDK older than 17\n' +
      '  - Android SDK licences not accepted: run "sdkmanager --licenses"',
  )
}

// -------------------------------------------------------------- output

const built = wantRelease
  ? resolve(androidDir, 'app/build/outputs/apk/release/app-release-unsigned.apk')
  : resolve(androidDir, 'app/build/outputs/apk/debug/app-debug.apk')

if (!existsSync(built)) fail(`Gradle reported success but ${built} does not exist.`)

const releaseDir = resolve(root, 'release')
mkdirSync(releaseDir, { recursive: true })

const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const name = `nug-outreach-${version}-${wantRelease ? 'release-unsigned' : 'debug'}-${stamp}.apk`
const out = resolve(releaseDir, name)
copyFileSync(built, out)

// Also publish it at a stable address inside the web deployment, which is
// where an installed phone looks when it finds it is out of date. Without
// this the update banner on Android would point at nothing.
const downloadDir = resolve(root, 'public/download')
mkdirSync(downloadDir, { recursive: true })
copyFileSync(built, resolve(downloadDir, 'nug-outreach.apk'))

const sizeMb = (statSync(out).size / (1024 * 1024)).toFixed(1)

say('Done')
console.log(`
    ${out}
    ${sizeMb} MB
`)

// ------------------------------------------------------------- install

if (wantInstall) {
  const adb = join(sdk, 'platform-tools', isWindows ? 'adb.exe' : 'adb')
  say('Installing on the connected phone')
  try {
    const devices = execFileSync(adb, ['devices'], { encoding: 'utf8' })
      .split('\n')
      .slice(1)
      .filter((l) => l.trim().endsWith('device'))
    if (devices.length === 0) {
      fail(
        'No phone is connected.',
        'Enable Developer options and USB debugging on the phone, plug it in,\n' +
          '  accept the prompt on its screen, then run this again.',
      )
    }
    execFileSync(adb, ['install', '-r', out], { stdio: 'inherit' })
    detail('Installed. Look for "NUG Outreach" in the app drawer.')
  } catch (err) {
    fail(`Installation failed: ${err.message}`)
  }
} else {
  console.log(`    To put it on a phone:

      Over USB:   npm run apk -- --install
      By hand:    copy the .apk to the phone and open it
                  (allow "install from unknown sources" when asked)
`)
}
