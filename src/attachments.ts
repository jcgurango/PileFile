/** Helpers for attachment kinds, sizes, and lazy thumbnail generation. */

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file'

export function kindOf(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

const THUMB_MAX = 512

/** WebP where the browser can encode it, otherwise PNG so transparency survives. */
const THUMB_TYPE: string = (() => {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    return c.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/png'
  } catch {
    return 'image/png'
  }
})()

export interface ThumbResult {
  blob: Blob
  width: number
  height: number
}

function drawScaled(source: CanvasImageSource, sw: number, sh: number): Promise<ThumbResult | null> {
  const scale = Math.min(1, THUMB_MAX / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(source, 0, 0, w, h)
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob ? { blob, width: w, height: h } : null), THUMB_TYPE, 0.85),
  )
}

async function imageThumb(blob: Blob): Promise<ThumbResult | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return await drawScaled(img, img.naturalWidth, img.naturalHeight)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function once(el: HTMLMediaElement, ok: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    el.addEventListener(ok, () => (clearTimeout(t), resolve()), { once: true })
    el.addEventListener('error', () => (clearTimeout(t), reject(new Error('media error'))), { once: true })
  })
}

async function videoThumb(blob: Blob): Promise<ThumbResult | null> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  try {
    video.src = url
    await once(video, 'loadeddata')
    const target = Math.min(0.1, (Number.isFinite(video.duration) ? video.duration : 1) / 2)
    if (video.currentTime !== target) {
      video.currentTime = target
      await once(video, 'seeked')
    }
    return await drawScaled(video, video.videoWidth, video.videoHeight)
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/** Builds a thumbnail for an image or video blob; null when the browser cannot decode it. */
export function makeThumbnail(blob: Blob, kind: AttachmentKind): Promise<ThumbResult | null> {
  if (kind === 'image') return imageThumb(blob)
  if (kind === 'video') return videoThumb(blob)
  return Promise.resolve(null)
}
