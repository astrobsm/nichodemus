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
