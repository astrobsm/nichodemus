/**
 * The only bridge between the web application and the desktop shell.
 *
 * Deliberately tiny: two file operations and nothing else. No Node APIs, no
 * filesystem access and no database access are exposed to the page.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nugDesktop', {
  isDesktop: true,

  /** Native save dialog. Returns the chosen path, or a cancellation. */
  saveFile: (data, filename, filters) =>
    ipcRenderer.invoke('nug:saveFile', { data, filename, filters }),

  /** Native open dialog. Returns the file's bytes. */
  openFile: (filters) => ipcRenderer.invoke('nug:openFile', { filters }),

  /** Shows a saved file in the system file manager. */
  revealFile: (path) => ipcRenderer.invoke('nug:revealFile', path),
})

/**
 * Updating. Separate from the file bridge because the application uses its
 * presence to tell that it is the desktop build at all.
 */
contextBridge.exposeInMainWorld('nugUpdate', {
  check: () => ipcRenderer.invoke('nug:checkForUpdate'),
  install: () => ipcRenderer.invoke('nug:installUpdate'),
  onReady: (listener) => {
    // The listener never receives the raw IPC event: handing a renderer the
    // event object would hand it a path back into the main process.
    ipcRenderer.on('nug:updateReady', (_event, info) => listener(info))
  },
})
