import type { Rect } from './types'

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export function area(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h)
}

export function intersection(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function iou(a: Rect, b: Rect): number {
  const i = intersection(a, b)
  if (!i) return 0
  const inter = area(i)
  return inter / (area(a) + area(b) - inter)
}

/** Fraction of `inner` covered by `outer`. */
export function coverage(inner: Rect, outer: Rect): number {
  const i = intersection(inner, outer)
  const a = area(inner)
  return i && a > 0 ? area(i) / a : 0
}

export function union(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export function expand(r: Rect, dx: number, dy = dx): Rect {
  return { x: r.x - dx, y: r.y - dy, w: r.w + 2 * dx, h: r.h + 2 * dy }
}

/** Clamp a normalized rect into the unit square. Returns null when degenerate. */
export function clampUnit(r: Rect): Rect | null {
  const x0 = clamp(r.x, 0, 1)
  const y0 = clamp(r.y, 0, 1)
  const x1 = clamp(r.x + r.w, 0, 1)
  const y1 = clamp(r.y + r.h, 0, 1)
  if (x1 - x0 < 0.002 || y1 - y0 < 0.002) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Convert a pixel box `[x0, y0, x1, y1]` in an image of size `w×h` into a normalized rect. */
export function boxToRect(
  box: { x0: number; y0: number; x1: number; y1: number },
  w: number,
  h: number,
): Rect | null {
  const x0 = Math.min(box.x0, box.x1)
  const x1 = Math.max(box.x0, box.x1)
  const y0 = Math.min(box.y0, box.y1)
  const y1 = Math.max(box.y0, box.y1)
  return clampUnit({ x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h })
}

export function rectToBox(r: Rect, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.round(r.x * w),
    y0: Math.round(r.y * h),
    x1: Math.round((r.x + r.w) * w),
    y1: Math.round((r.y + r.h) * h),
  }
}

export const FULL_PAGE: Rect = { x: 0, y: 0, w: 1, h: 1 }
