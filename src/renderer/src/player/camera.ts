import type { Rect } from '@shared/types'

export interface Viewport {
  width: number
  height: number
  /** Space kept free at the bottom (subtitles / controls). */
  bottom: number
  top: number
}

export interface Framing {
  /** Size of the page layer at scale 1 (page fitted into the viewport). */
  baseW: number
  baseH: number
  scale: number
  tx: number
  ty: number
}

/** Largest zoom relative to the fitted page – beyond this pages get blurry. */
const MAX_ZOOM = 3.4

/**
 * Compute the transform that frames `rect` (normalized page coords) inside the
 * viewport, leaving room for subtitles.
 */
export function frame(rect: Rect, pageW: number, pageH: number, vp: Viewport): Framing {
  const availW = vp.width * 0.94
  const availH = Math.max(120, (vp.height - vp.top - vp.bottom) * 0.94)
  const fit = Math.min(vp.width / pageW, vp.height / pageH)
  const baseW = pageW * fit
  const baseH = pageH * fit
  const rw = Math.max(1, rect.w * baseW)
  const rh = Math.max(1, rect.h * baseH)
  const scale = Math.min(availW / rw, availH / rh, MAX_ZOOM)
  const cx = (rect.x + rect.w / 2) * baseW * scale
  const cy = (rect.y + rect.h / 2) * baseH * scale
  const centerY = vp.top + (vp.height - vp.top - vp.bottom) / 2
  return { baseW, baseH, scale, tx: vp.width / 2 - cx, ty: centerY - cy }
}
