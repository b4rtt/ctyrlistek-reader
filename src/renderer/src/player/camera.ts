import type { ZoomLevel } from '@shared/api'
import { clamp } from '@shared/geometry'
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

/**
 * Zoom presets. `maxZoom` is relative to the whole page fitted on screen;
 * `margin` adds surrounding context (fraction of the focused area per side),
 * so neighbouring art stays visible and nothing feels cramped.
 */
export const ZOOM_PRESETS: Record<ZoomLevel, { maxZoom: number; margin: number }> = {
  soft: { maxZoom: 1.6, margin: 0.1 },
  medium: { maxZoom: 2.1, margin: 0.06 },
  strong: { maxZoom: 2.8, margin: 0.03 },
}

/** Grow `rect` by `margin` of its size on every side, staying on the page. */
export function withMargin(rect: Rect, margin: number): Rect {
  const dx = rect.w * margin
  const dy = rect.h * margin
  const x0 = clamp(rect.x - dx, 0, 1)
  const y0 = clamp(rect.y - dy, 0, 1)
  const x1 = clamp(rect.x + rect.w + dx, 0, 1)
  const y1 = clamp(rect.y + rect.h + dy, 0, 1)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Compute the transform that frames `rect` (normalized page coords) inside the
 * viewport, leaving room for subtitles. The whole rect is always visible.
 */
export function frame(rect: Rect, pageW: number, pageH: number, vp: Viewport, zoom: ZoomLevel = 'medium'): Framing {
  const preset = ZOOM_PRESETS[zoom]
  const target = rect.w >= 0.999 && rect.h >= 0.999 ? rect : withMargin(rect, preset.margin)
  const availW = vp.width * 0.96
  const availH = Math.max(120, (vp.height - vp.top - vp.bottom) * 0.96)
  const fit = Math.min(vp.width / pageW, vp.height / pageH)
  const baseW = pageW * fit
  const baseH = pageH * fit
  const rw = Math.max(1, target.w * baseW)
  const rh = Math.max(1, target.h * baseH)
  const scale = Math.min(availW / rw, availH / rh, preset.maxZoom)
  const cx = (target.x + target.w / 2) * baseW * scale
  const cy = (target.y + target.h / 2) * baseH * scale
  const centerY = vp.top + (vp.height - vp.top - vp.bottom) / 2
  return { baseW, baseH, scale, tx: vp.width / 2 - cx, ty: centerY - cy }
}
