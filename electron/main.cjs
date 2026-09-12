/**
 * Desktop application main process.
 *
 * The web application is served from a custom `app://` scheme rather than
 * file://. This matters more than it looks:
 *
 *   - file:// gives every load an opaque origin, so OPFS and IndexedDB would
 *     not persist reliably between restarts. The clinical database would
 *     appear to vanish.
 *   - `app://` is registered as standard AND secure, which gives a stable
 *     origin and a secure context. WebCrypto's subtle API - which hashes
 *     every PIN and encrypts every backup - is unavailable otherwise.
 *
 * Nothing here opens a network socket. The scheme handler reads files from
 * the packaged application directory.
 */
const { app, BrowserWindow, protocol, dialog, ipcMain, shell, net } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const SCHEME = 'app'
const DIST = path.join(__dirname, '..', 'dist')

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

let mainWindow = null

function resolveRequest(url) {
  // app://local/icons/logo.png -> <dist>/icons/logo.png
  const { pathname } = new URL(url)
  const decoded = decodeURIComponent(pathname)
  const candidate = path.normalize(path.join(DIST, decoded))

  // Never serve anything outside the packaged application.
  if (!candidate.startsWith(DIST)) return path.join(DIST, 'index.html')
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate

  // Single-page app: unknown paths fall back to the shell.
  return path.join(DIST, 'index.html')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0f3a5a',
    title: 'Nichodemus Ugbor Memorial Community Health Outreach',
    icon: path.join(__dirname, '..', 'build', 'electron', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.loadURL(`${SCHEME}://local/index.html`)

  // A clinical application has no reason to navigate anywhere else, and
  // nothing in it should open an external page without the user asking.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) event.preventDefault()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, (request) => net.fetch(pathToFileURL(resolveRequest(request.url)).toString()))
  createWindow()
  configureUpdates()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ------------------------------------------------------------- updating
//
// The desktop application keeps itself current: it asks the project's
// releases whether a newer installer exists, downloads it in the background
// and installs it when the application is next closed.
//
// It never installs while the application is open. Someone may be halfway
// through a consultation, and a restart chosen by the software rather than
// by the person using it is how a morning's records get lost.

const { autoUpdater } = require('electron-updater')

let updateReady = null

function notifyRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function configureUpdates() {
  // A development run has no packaged application to replace.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  // The whole point is that the update is ready without anyone being asked
  // to sit and wait for it; installing is still a deliberate act.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('update-downloaded', (info) => {
    updateReady = info
    notifyRenderer('nug:updateReady', { version: info?.version })
  })

  autoUpdater.on('error', () => {
    // No releases published yet, or no connection. An update check that
    // cannot reach anything must never interrupt the application.
  })

  // Once at startup, then daily for a machine that is left running.
  const check = () => autoUpdater.checkForUpdates().catch(() => undefined)
  setTimeout(check, 8000)
  setInterval(check, 24 * 60 * 60 * 1000)
}

ipcMain.handle('nug:checkForUpdate', async () => {
  if (!app.isPackaged) return { available: false, reason: 'development build' }
  if (updateReady) return { available: true, version: updateReady.version, ready: true }
  try {
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version
    return { available: Boolean(version && version !== app.getVersion()), version }
  } catch {
    return { available: false, reason: 'unreachable' }
  }
})

ipcMain.handle('nug:installUpdate', async () => {
  if (!updateReady) return false
  // isSilent false, isForceRunAfter true: the person sees the installer and
  // the application comes back up when it is done.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return true
})

// ------------------------------------------------------------ file access

/**
 * Native save dialog. An Electron window has no File System Access API and
 * ignores <a download> on a blob URL, so without this a backup would report
 * success and write nothing.
 */
ipcMain.handle('nug:saveFile', async (_event, { data, filename, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: filename,
    filters: filters ?? [{ name: 'All files', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true }
  await fs.promises.writeFile(result.filePath, Buffer.from(data))
  return { ok: true, path: result.filePath, name: path.basename(result.filePath) }
})

ipcMain.handle('nug:openFile', async (_event, { filters }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters ?? [{ name: 'All files', extensions: ['*'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true }
  const filePath = result.filePaths[0]
  const buffer = await fs.promises.readFile(filePath)
  return { ok: true, name: path.basename(filePath), data: new Uint8Array(buffer) }
})

ipcMain.handle('nug:revealFile', async (_event, filePath) => {
  shell.showItemInFolder(filePath)
})
