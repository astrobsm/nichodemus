/**
 * Finds a GitHub token to publish releases with, without asking anybody.
 *
 * Three places are tried, in the order of how deliberately they were set:
 *
 *   1. GH_TOKEN or GITHUB_TOKEN, which somebody set on purpose for this.
 *   2. The GitHub CLI, if it has been signed in.
 *   3. The credential git itself already uses to push to this repository.
 *
 * The third is the one that makes a release need no setting up at all: a
 * machine that can push to the repository can, by definition, already prove
 * who it is to GitHub. Signing in to github.com in a browser does not sign in
 * the CLI - they keep separate sessions - so without this, publishing a
 * release failed on a machine that was plainly already authorised.
 *
 * The token is never printed, logged or written anywhere.
 */
import { execFileSync, execSync } from 'node:child_process'

function fromEnvironment() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  return token && token.trim() ? token.trim() : null
}

function fromGhCli(cwd) {
  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return token || null
  } catch {
    return null
  }
}

function fromGitCredential(cwd) {
  try {
    const output = execSync('git credential fill', {
      cwd,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const password = output.match(/^password=(.*)$/m)?.[1]
    return password && password.trim() ? password.trim() : null
  } catch {
    return null
  }
}

/** A token, and where it came from, or null if there is none to be had. */
export function githubToken(cwd = process.cwd()) {
  const fromEnv = fromEnvironment()
  if (fromEnv) return { token: fromEnv, source: 'the GH_TOKEN environment variable' }

  const fromCli = fromGhCli(cwd)
  if (fromCli) return { token: fromCli, source: 'the GitHub CLI' }

  const fromGit = fromGitCredential(cwd)
  if (fromGit) return { token: fromGit, source: "git's own credential for github.com" }

  return null
}

/** Confirms the token works and can write releases. Returns the login. */
export function checkToken(token) {
  try {
    const output = execSync(
      `curl -s -i -H "Authorization: token ${token}" https://api.github.com/user`,
      { encoding: 'utf8', maxBuffer: 4_000_000 },
    )
    if (!/^HTTP\/[\d.]+ 200/m.test(output)) return null
    const scopes = output.match(/^[Xx]-[Oo][Aa]uth-[Ss]copes:\s*(.*)$/m)?.[1] ?? ''
    const login = output.match(/"login"\s*:\s*"([^"]+)"/)?.[1] ?? null
    // A fine-grained token reports no scopes at all; only reject when scopes
    // are listed and "repo" is plainly not among them.
    const canWrite = scopes.trim() === '' || /\brepo\b/.test(scopes)
    return login ? { login, scopes: scopes.trim(), canWrite } : null
  } catch {
    return null
  }
}
