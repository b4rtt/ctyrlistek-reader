/**
 * Balloon refinement: the AI returns only an approximate balloon box, so we
 * snap it to the real balloon by flood-filling its (light, uniform) interior
 * from several seed points and picking the fill that best matches.
 */
import { iou } from '@shared/geometry'
import type { Rect } from '@shared/types'
import { colorDist, lum, type Raster } from './raster'

interface Fill {
  x0: number
  y0: number
  x1: number
  y1: number
  count: number
  leaked: boolean
}

function floodFrom(img: Raster, seed: number, win: { x0: number; y0: number; x1: number; y1: number }, visited: Uint8Array): Fill {
  const { width: w, data } = img
  const i = seed * 4
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]
  const fill: Fill = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, count: 0, leaked: false }
  const stack = [seed]
  visited[seed] = 1
  while (stack.length) {
    const p = stack.pop()!
    const x = p % w
    const y = (p - x) / w
    fill.count++
    if (x < fill.x0) fill.x0 = x
    if (y < fill.y0) fill.y0 = y
    if (x > fill.x1) fill.x1 = x
    if (y > fill.y1) fill.y1 = y
    if (x <= win.x0 || y <= win.y0 || x >= win.x1 - 1 || y >= win.y1 - 1) {
      fill.leaked = true
      continue
    }
    for (const q of [p - 1, p + 1, p - w, p + w]) {
      if (!visited[q] && colorDist(data, q, r, g, b) <= 48) {
        visited[q] = 1
        stack.push(q)
      }
    }
  }
  return fill
}

/**
 * Snap `approx` (normalized) to the balloon under it. Returns `approx` when
 * nothing convincing is found.
 */
export function refineBubble(img: Raster, approx: Rect): Rect {
  const { width: w, height: h } = img
  const ax0 = approx.x * w
  const ay0 = approx.y * h
  const aw = approx.w * w
  const ah = approx.h * h
  if (aw < 4 || ah < 4) return approx

  // Search window: the approximate box grown by 60 %.
  const win = {
    x0: Math.max(0, Math.floor(ax0 - aw * 0.6)),
    y0: Math.max(0, Math.floor(ay0 - ah * 0.6)),
    x1: Math.min(w, Math.ceil(ax0 + aw * 1.6)),
    y1: Math.min(h, Math.ceil(ay0 + ah * 1.6)),
  }
  const visited = new Uint8Array(w * h)
  const approxArea = aw * ah
  let best: { rect: Rect; score: number } | null = null

  for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
      const x = Math.round(ax0 + aw * fx)
      const y = Math.round(ay0 + ah * fy)
      if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) continue
      const p = y * w + x
      if (visited[p] || lum(img.data, p) < 150) continue
      const f = floodFrom(img, p, win, visited)
      if (f.leaked || f.count < approxArea * 0.12) continue
      const rect: Rect = { x: f.x0 / w, y: f.y0 / h, w: (f.x1 - f.x0 + 1) / w, h: (f.y1 - f.y0 + 1) / h }
      // Balloons are mostly interior: reject thin/sparse shapes.
      const density = f.count / ((f.x1 - f.x0 + 1) * (f.y1 - f.y0 + 1))
      if (density < 0.35) continue
      const score = iou(rect, approx)
      if (score > 0.3 && (!best || score > best.score)) best = { rect, score }
    }
  }
  if (!best) return approx
  // Grow slightly to include the balloon outline.
  const gx = best.rect.w * 0.04
  const gy = best.rect.h * 0.06
  return { x: best.rect.x - gx, y: best.rect.y - gy, w: best.rect.w + 2 * gx, h: best.rect.h + 2 * gy }
}
