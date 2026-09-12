#!/usr/bin/env node
/**
 * Launches the desktop application.
 *
 * Exists because of one environment variable: ELECTRON_RUN_AS_NODE. When it
 * is set - some editors, terminals and CI images set it - electron.exe runs
 * the entry file as a plain Node script instead of starting the browser
 * process. The failure looks like a bug in the application ("Cannot read
 * properties of undefined (reading 'registerSchemesAsPrivileged')") but is
 * nothing of the sort. Clearing it here makes "npm run desktop" behave the
 * same way everywhere.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const electron = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: 'inherit',
})
child.on('close', (code) => process.exit(code ?? 0))
