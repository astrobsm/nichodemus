/**
 * Saving files to, and reading files from, device-accessible storage.
 *
 * Four routes, chosen at runtime:
 *   1. Desktop (Electron) - a native save dialog through the preload bridge.
 *      An Electron window has no File System Access API and ignores
 *      <a download> on a blob URL.
 *   2. Native (Capacitor APK) - writes through the Filesystem plugin into
 *      Documents/NUG Outreach. A WebView ignores blob downloads too, so
 *      without this a backup would appear to succeed and produce no file.
 *   3. File System Access API (desktop Chrome/Edge) - the user picks a real
 *      folder: USB stick, SD card, anywhere.
 *   4. Anchor download (Android Chrome, everything else) - goes to Downloads.
 *
 * Nothing is uploaded anywhere in any of the four.
 */
import { Capacitor } from '@capacitor/core'

export type SaveOutcome =
  | {
      ok: true
      method: 'picker' | 'download' | 'native' | 'desktop'
      name: string
      location?: string
    }
  | { ok: false; cancelled: boolean; error?: string }

/** The bridge the Electron shell installs. Absent in a browser. */
interface DesktopBridge {
  isDesktop: true
  saveFile: (
    data: Uint8Array,
    filename: string,
    filters?: { name: string; extensions: string[] }[],
  ) => Promise<{ ok: true; path: string; name: string } | { ok: false; cancelled: boolean }>
  openFile: (
    filters?: { name: string; extensions: string[] }[],
  ) => Promise<{ ok: true; name: string; data: Uint8Array } | { ok: false; cancelled: boolean }>
  revealFile: (path: string) => Promise<void>
}

function desktop(): DesktopBridge | null {
  return (globalThis as { nugDesktop?: DesktopBridge }).nugDesktop ?? null
}

export function isDesktopApp(): boolean {
  return desktop() !== null
}

/** Turns a MIME type into the extension filter a native dialog expects. */
function dialogFilters(filename: string, description: string) {
  const ext = filename.slice(filename.lastIndexOf('.') + 1)
  return [
    { name: description, extensions: [ext] },
    { name: 'All files', extensions: ['*'] },
  ]
}

interface PickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle>
  showOpenFilePicker?: (options: {
    multiple?: boolean
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle[]>
}

/** Folder created inside the device's Documents area for everything we write. */
export const NATIVE_FOLDER = 'NUG Outreach'

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export function supportsFilePicker(): boolean {
  const w = window as PickerWindow
  return typeof w.showSaveFilePicker === 'function'
}

/** Describes where files go, for display in the interface. */
export function saveLocationLabel(): string {
  if (isDesktopApp()) return 'a folder you choose'
  if (isNativeApp()) return `Documents/${NATIVE_FOLDER} on this device`
  if (supportsFilePicker()) return 'a folder you choose'
  return 'the Downloads folder on this device'
}

function toBase64(bytes: Uint8Array): string {
  // Chunked so a multi-megabyte backup does not blow the argument limit.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

async function saveFileNative(
  bytes: Uint8Array,
  filename: string,
  offerToShare: boolean,
): Promise<SaveOutcome> {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const isText = /\.(csv|txt|json)$/i.test(filename)

    const result = await Filesystem.writeFile({
      path: `${NATIVE_FOLDER}/${filename}`,
      directory: Directory.Documents,
      recursive: true,
      ...(isText
        ? { data: new TextDecoder().decode(bytes), encoding: Encoding.UTF8 }
        : { data: toBase64(bytes) }),
    })

    if (offerToShare) {
      // Lets the administrator move a backup straight onto another device.
      // Cancelling the sheet is not a failure - the file is already written.
      try {
        const { Share } = await import('@capacitor/share')
        await Share.share({ title: filename, url: result.uri })
      } catch {
        /* share unavailable or dismissed */
      }
    }

    return {
      ok: true,
      method: 'native',
      name: filename,
      location: `Documents/${NATIVE_FOLDER}`,
    }
  } catch (err) {
    return { ok: false, cancelled: false, error: (err as Error).message }
  }
}

export async function saveFile(
  data: Uint8Array | string,
  filename: string,
  mimeType: string,
  description = 'File',
  options: { share?: boolean } = {},
): Promise<SaveOutcome> {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : (data.slice() as Uint8Array)

  const bridge = desktop()
  if (bridge) {
    try {
      const result = await bridge.saveFile(bytes, filename, dialogFilters(filename, description))
      if (!result.ok) return { ok: false, cancelled: result.cancelled }
      return {
        ok: true,
        method: 'desktop',
        name: result.name,
        location: result.path.replace(/[\\/][^\\/]+$/, ''),
      }
    } catch (err) {
      return { ok: false, cancelled: false, error: (err as Error).message }
    }
  }

  if (isNativeApp()) {
    return saveFileNative(bytes, filename, Boolean(options.share))
  }

  const blob = new Blob([bytes as BlobPart], { type: mimeType })
  const w = window as PickerWindow

  if (w.showSaveFilePicker) {
    try {
      const ext = filename.slice(filename.lastIndexOf('.'))
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description, accept: { [mimeType]: [ext] } }],
      })
      const writable = await (
        handle as FileSystemFileHandle & {
          createWritable: () => Promise<FileSystemWritableFileStream>
        }
      ).createWritable()
      await writable.write(blob)
      await writable.close()
      return { ok: true, method: 'picker', name: handle.name }
    } catch (err) {
      const e = err as DOMException
      if (e?.name === 'AbortError') return { ok: false, cancelled: true }
      // Fall through to the download route if the picker is unavailable.
    }
  }

  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return { ok: true, method: 'download', name: filename, location: 'Downloads' }
  } catch (err) {
    return { ok: false, cancelled: false, error: (err as Error).message }
  }
}

export async function pickFile(
  accept: Record<string, string[]>,
  description = 'File',
): Promise<File | null> {
  const bridge = desktop()
  if (bridge) {
    const extensions = Object.values(accept)
      .flat()
      .map((e) => e.replace(/^\./, ''))
    const result = await bridge.openFile([
      { name: description, extensions },
      { name: 'All files', extensions: ['*'] },
    ])
    if (!result.ok) return null
    // Wrap the bytes so the rest of the application sees an ordinary File.
    return new File([new Uint8Array(result.data)], result.name)
  }

  const w = window as PickerWindow

  // Capacitor's WebView implements the file chooser, so the plain input
  // element below works inside the APK as well as in a browser.
  if (!isNativeApp() && w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        multiple: false,
        types: [{ description, accept }],
      })
      return await handle.getFile()
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = Object.values(accept).flat().join(',')
    input.onchange = () => resolve(input.files?.[0] ?? null)
    // A cancelled dialog fires no change event in some browsers; the
    // focus handler releases the promise so the caller is not stuck.
    window.addEventListener(
      'focus',
      () => setTimeout(() => resolve(input.files?.[0] ?? null), 500),
      { once: true },
    )
    input.click()
  })
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
