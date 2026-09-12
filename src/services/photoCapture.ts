/**
 * Taking a clinical photograph on the device.
 *
 * Deliberately built on a plain file input with `capture`, not a camera
 * plugin. That one choice makes the same code work in the browser, inside the
 * Android WebView and in the desktop application, and — more importantly —
 * means the image is handed to us directly instead of being written to the
 * device's photo gallery first, where it would be picked up by whatever cloud
 * photo backup the owner of the phone happens to use.
 *
 * A modern phone camera produces a 3-5 MB JPEG. Storing that verbatim would
 * put a few hundred megabytes into a database that has to be backed up over a
 * phone connection at the end of a field day, so every image is redrawn to at
 * most MAX_EDGE pixels on its longest side and re-encoded. A wound at 1440px
 * is still far more detail than the assessment needs.
 */

/** Longest edge, in pixels, after downscaling. */
export const MAX_EDGE = 1440

/** JPEG quality. 0.72 is the point where wound margins stay crisp. */
export const QUALITY = 0.72

/** Refuse anything that would bloat the database even after downscaling. */
export const MAX_STORED_BYTES = 1_500_000

export interface CapturedImage {
  /** Base64 JPEG, with no data: prefix. */
  data: string
  width: number
  height: number
  sizeBytes: number
}

export class PhotoCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoCaptureError'
  }
}

/**
 * Opens the camera (or the file picker on a desktop) and returns the chosen
 * image. Resolves to null when the person backs out.
 */
export function pickImage(useCamera = true): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (useCamera) input.setAttribute('capture', 'environment')
    input.style.position = 'fixed'
    input.style.left = '-10000px'
    document.body.appendChild(input)

    let settled = false
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }

    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    // Cancelling a file dialog fires nothing at all on most platforms, so the
    // promise is released when the window regains focus instead. Without this
    // a cancelled capture would leave the screen spinning for ever.
    input.addEventListener('cancel', () => finish(null))
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish(input.files?.[0] ?? null), 1200),
      { once: true },
    )

    input.click()
  })
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new PhotoCaptureError('That file could not be read as an image.'))
    }
    img.src = url
  })
}

function canvasToBase64(canvas: HTMLCanvasElement): string {
  const url = canvas.toDataURL('image/jpeg', QUALITY)
  const comma = url.indexOf(',')
  if (comma < 0) throw new PhotoCaptureError('The image could not be encoded.')
  return url.slice(comma + 1)
}

/** Bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.floor((data.length * 3) / 4) - padding
}

/** Downscales and re-encodes, so what reaches the database is predictable. */
export async function prepareImage(file: File): Promise<CapturedImage> {
  if (!file.type.startsWith('image/')) {
    throw new PhotoCaptureError('That file is not an image.')
  }

  const img = await loadImage(file)
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PhotoCaptureError('This device cannot process images.')
  ctx.drawImage(img, 0, 0, width, height)

  const data = canvasToBase64(canvas)
  const sizeBytes = base64Bytes(data)

  if (sizeBytes > MAX_STORED_BYTES) {
    throw new PhotoCaptureError(
      'That image is too large even after being reduced. Take it again from a little further back.',
    )
  }

  return { data, width, height, sizeBytes }
}

/** A src usable directly in an <img>. */
export function asDataUrl(base64: string, mime = 'image/jpeg'): string {
  return `data:${mime};base64,${base64}`
}
