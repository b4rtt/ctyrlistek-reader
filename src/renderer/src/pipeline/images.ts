/** Image helpers for the analysis pipeline (encoding, overlays, crops). */
import type { EncodedImage } from '@shared/api'
import type { Rect } from '@shared/types'
import { assetUrl } from '../api'

type Drawable = CanvasImageSource & { width: number; height: number }

export async function encodeJpeg(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  quality = 0.9,
): Promise<Uint8Array> {
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
      : await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Nepodařilo se uložit obrázek'))),
            'image/jpeg',
            quality,
          ),
        )
  return new Uint8Array(await blob.arrayBuffer())
}

export async function loadPageBitmap(comicId: string, rel: string): Promise<ImageBitmap> {
  const res = await fetch(assetUrl(comicId, rel))
  if (!res.ok) throw new Error(`Stránku ${rel} se nepodařilo načíst`)
  return createImageBitmap(await res.blob())
}

/**
 * Size that fits the OpenAI "high" detail budget (≤ `maxPatches` patches of
 * 32×32 px) so the service does not rescale – coordinates then map 1:1.
 */
export function fitPatches(
  w: number,
  h: number,
  maxPatches = 2400,
  patch = 32,
): { width: number; height: number } {
  let scale = Math.min(1, 2048 / Math.max(w, h))
  const patches = (s: number): number => Math.ceil((w * s) / patch) * Math.ceil((h * s) / patch)
  while (patches(scale) > maxPatches) scale *= 0.97
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) }
}

function drawScaled(src: Drawable, width: number, height: number): OffscreenCanvas {
  const c = new OffscreenCanvas(width, height)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, width, height)
  return c
}

export async function aiImage(src: Drawable): Promise<EncodedImage> {
  const { width, height } = fitPatches(src.width, src.height)
  return { data: await encodeJpeg(drawScaled(src, width, height), 0.88), width, height }
}

/** Page with candidate panels outlined and labelled P1, P2, … */
export async function overlayImage(
  src: Drawable,
  candidates: { label: string; rect: Rect }[],
): Promise<EncodedImage> {
  const scale = Math.min(1, 900 / Math.max(src.width, src.height))
  const width = Math.round(src.width * scale)
  const height = Math.round(src.height * scale)
  const c = drawScaled(src, width, height)
  const ctx = c.getContext('2d')!
  const colors = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2']
  candidates.forEach((cand, i) => {
    const color = colors[i % colors.length]
    const x = cand.rect.x * width
    const y = cand.rect.y * height
    ctx.lineWidth = 4
    ctx.strokeStyle = color
    ctx.strokeRect(x + 2, y + 2, cand.rect.w * width - 4, cand.rect.h * height - 4)
    ctx.font = 'bold 30px sans-serif'
    const tw = ctx.measureText(cand.label).width
    ctx.fillStyle = color
    ctx.fillRect(x + 4, y + 4, tw + 14, 38)
    ctx.fillStyle = '#fff'
    ctx.fillText(cand.label, x + 11, y + 34)
  })
  return { data: await encodeJpeg(c, 0.8), width, height }
}

/** Square-ish crop of a region (e.g. a face) for the cast review. */
export async function cropImage(src: Drawable, rect: Rect, size = 256): Promise<EncodedImage> {
  const pad = 0.25
  const cx = (rect.x + rect.w / 2) * src.width
  const cy = (rect.y + rect.h / 2) * src.height
  const side = Math.max(rect.w * src.width, rect.h * src.height) * (1 + pad)
  const sx = Math.max(0, cx - side / 2)
  const sy = Math.max(0, cy - side / 2)
  const sw = Math.min(src.width - sx, side)
  const sh = Math.min(src.height - sy, side)
  const scale = size / Math.max(sw, sh)
  const c = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)))
  c.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height)
  return { data: await encodeJpeg(c, 0.85), width: c.width, height: c.height }
}
