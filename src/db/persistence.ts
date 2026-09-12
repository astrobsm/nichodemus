/**
 * Device persistence for the SQLite database image.
 *
 * Two backends, chosen at runtime:
 *   1. OPFS (Origin Private File System) - a real file on the device,
 *      written atomically via a temp file + rename. Preferred.
 *   2. IndexedDB - a single blob record. Universal fallback.
 *
 * Neither touches the network. The database file never leaves the device.
 */

const DB_FILENAME = 'nug-outreach.sqlite'
const TMP_FILENAME = 'nug-outreach.sqlite.tmp'
const IDB_NAME = 'nug-outreach-store'
const IDB_STORE = 'files'

export type StorageBackend = 'opfs' | 'indexeddb' | 'memory'

export interface PersistenceInfo {
  backend: StorageBackend
  sizeBytes: number
  quotaBytes: number | null
  usageBytes: number | null
}

let backend: StorageBackend | null = null

async function opfsAvailable(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false
    const storage = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>
    }
    if (!storage?.getDirectory) return false
    const root = await storage.getDirectory()
    // createWritable is required for atomic writes; not all browsers expose it.
    const probe = await root.getFileHandle('.nug-probe', { create: true })
    const anyProbe = probe as FileSystemFileHandle & {
      createWritable?: unknown
      createSyncAccessHandle?: unknown
    }
    const ok = Boolean(anyProbe.createWritable || anyProbe.createSyncAccessHandle)
    await root.removeEntry('.nug-probe').catch(() => undefined)
    return ok
  } catch {
    return false
  }
}

export async function detectBackend(): Promise<StorageBackend> {
  if (backend) return backend
  if (await opfsAvailable()) backend = 'opfs'
  else if (typeof indexedDB !== 'undefined') backend = 'indexeddb'
  else backend = 'memory'
  return backend
}

export function currentBackend(): StorageBackend {
  return backend ?? 'memory'
}

// ------------------------------------------------------------------ OPFS

async function opfsWrite(bytes: Uint8Array): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const tmp = await root.getFileHandle(TMP_FILENAME, { create: true })
  const anyTmp = tmp as FileSystemFileHandle & {
    createWritable?: () => Promise<FileSystemWritableFileStream>
    createSyncAccessHandle?: () => Promise<{
      write: (b: Uint8Array, o?: { at: number }) => number
      truncate: (n: number) => void
      flush: () => void
      close: () => void
    }>
  }

  if (anyTmp.createWritable) {
    const writable = await anyTmp.createWritable()
    // Copy into a fresh ArrayBuffer: the WASM heap view can be detached
    // by a later allocation while the write is still in flight.
    await writable.write(bytes.slice().buffer)
    await writable.close()
  } else if (anyTmp.createSyncAccessHandle) {
    const handle = await anyTmp.createSyncAccessHandle()
    try {
      handle.truncate(0)
      handle.write(bytes, { at: 0 })
      handle.flush()
    } finally {
      handle.close()
    }
  } else {
    throw new Error('OPFS write unavailable')
  }

  // Atomic-ish swap: remove the old file then rename the temp into place.
  // A crash between the two leaves the temp file, which openBytes recovers.
  await root.removeEntry(DB_FILENAME).catch(() => undefined)
  const anyTmp2 = tmp as unknown as { move?: (name: string) => Promise<void> }
  if (anyTmp2.move) {
    await anyTmp2.move(DB_FILENAME)
  } else {
    // No move() support: re-write under the final name and drop the temp.
    const target = await root.getFileHandle(DB_FILENAME, { create: true })
    const w = await (
      target as FileSystemFileHandle & {
        createWritable: () => Promise<FileSystemWritableFileStream>
      }
    ).createWritable()
    await w.write(bytes.slice().buffer)
    await w.close()
    await root.removeEntry(TMP_FILENAME).catch(() => undefined)
  }
}

async function opfsRead(): Promise<Uint8Array | null> {
  const root = await navigator.storage.getDirectory()
  for (const name of [DB_FILENAME, TMP_FILENAME]) {
    try {
      const handle = await root.getFileHandle(name)
      const file = await handle.getFile()
      if (file.size > 0) return new Uint8Array(await file.arrayBuffer())
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

// ------------------------------------------------------------- IndexedDB

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbWrite(bytes: Uint8Array): Promise<void> {
  const db = await openIdb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(bytes.slice(), DB_FILENAME)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function idbRead(): Promise<Uint8Array | null> {
  const db = await openIdb()
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(DB_FILENAME)
      req.onsuccess = () => {
        const v = req.result
        if (!v) resolve(null)
        else if (v instanceof Uint8Array) resolve(v)
        else if (v instanceof ArrayBuffer) resolve(new Uint8Array(v))
        else resolve(null)
      }
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------- public

export async function readBytes(): Promise<Uint8Array | null> {
  const b = await detectBackend()
  if (b === 'opfs') return opfsRead()
  if (b === 'indexeddb') return idbRead()
  return null
}

export async function writeBytes(bytes: Uint8Array): Promise<void> {
  const b = await detectBackend()
  if (b === 'opfs') return opfsWrite(bytes)
  if (b === 'indexeddb') return idbWrite(bytes)
  // memory backend: nothing to do, data lives only for this session
}

export async function destroyStored(): Promise<void> {
  const b = await detectBackend()
  if (b === 'opfs') {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(DB_FILENAME).catch(() => undefined)
    await root.removeEntry(TMP_FILENAME).catch(() => undefined)
  } else if (b === 'indexeddb') {
    const db = await openIdb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).delete(DB_FILENAME)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  }
}

export async function storageInfo(sizeBytes: number): Promise<PersistenceInfo> {
  const b = await detectBackend()
  let quotaBytes: number | null = null
  let usageBytes: number | null = null
  try {
    if (navigator?.storage?.estimate) {
      const est = await navigator.storage.estimate()
      quotaBytes = est.quota ?? null
      usageBytes = est.usage ?? null
    }
  } catch {
    /* estimate unavailable */
  }
  return { backend: b, sizeBytes, quotaBytes, usageBytes }
}

/**
 * Ask the browser to make storage persistent so the OS will not evict the
 * clinical database under storage pressure. Safe to call repeatedly.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator?.storage?.persisted && (await navigator.storage.persisted())) return true
    if (navigator?.storage?.persist) return await navigator.storage.persist()
  } catch {
    /* not supported */
  }
  return false
}
