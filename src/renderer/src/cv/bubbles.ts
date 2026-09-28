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

type Wall = (x: number, y: number) => boolean

function floodFrom(
  img: Raster,
  seed: number,
  win: { x0: number; y0: number; x1: number; y1: number },
  visited: Uint8Array,
  wall: Wall,
): Fill {
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
      if (visited[q] || colorDist(data, q, r, g, b) > 48) continue
      const qx = q % w
      if (wall(qx, (q - qx) / w)) continue
      visited[q] = 1
      stack.push(q)
    }
  }
  return fill
}

/**
 * Snap `approx` (normalized) to the balloon under it. Returns `approx` when
 * nothing convincing is found.
 *
 * Comic lettering often touches the balloon outline, which splits the white
 * interior into several pieces – so we flood-fill from a grid of seeds and
 * take the union of all balloon-like pieces around the approximate box.
 *
 * `panels` (optional): outside the panels, filling is only allowed close to
 * the approximate box. A fill that reaches that limit is connected to the page
 * margin (not a balloon) and is discarded, which also keeps fills cheap.
 */
export function refineBubble(img: Raster, approx: Rect, panels: Rect[] = []): Rect {
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
  // Pieces must lie inside the approximate box grown by 12 % – light art next
  // to the balloon (white shirts, sky) is otherwise swallowed. Tuned on real pages.
  const zone = { x0: ax0 - aw * 0.12, y0: ay0 - ah * 0.12, x1: ax0 + aw * 1.12, y1: ay0 + ah * 1.12 }
  const near = { x0: ax0 - aw * 0.2, y0: ay0 - ah * 0.2, x1: ax0 + aw * 1.2, y1: ay0 + ah * 1.2 }
  const px = panels.map((r) => ({
    x0: (r.x - 0.005) * w,
    y0: (r.y - 0.005) * h,
    x1: (r.x + r.w + 0.005) * w,
    y1: (r.y + r.h + 0.005) * h,
  }))
  let touchedWall = false
  const wall: Wall = (x, y) => {
    if (px.length === 0) return false
    if (x >= near.x0 && x <= near.x1 && y >= near.y0 && y <= near.y1) return false
    if (px.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)) return false
    touchedWall = true
    return true
  }

  const visited = new Uint8Array(w * h)
  const approxArea = aw * ah
  let union: { x0: number; y0: number; x1: number; y1: number } | null = null
  let area = 0
  const fs = [-0.08, 0.1, 0.25, 0.5, 0.75, 0.9, 1.08]
  const gs = [-0.1, 0.15, 0.3, 0.5, 0.7, 0.85, 1.1]
  for (const fy of gs) {
    for (const fx of fs) {
      const x = Math.round(ax0 + aw * fx)
      const y = Math.round(ay0 + ah * fy)
      if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) continue
      const p = y * w + x
      if (visited[p] || lum(img.data, p) < 170) continue
      touchedWall = false
      const f = floodFrom(img, p, win, visited, wall)
      if (f.leaked || touchedWall || f.count < approxArea * 0.02) continue
      const bw = f.x1 - f.x0 + 1
      const bh = f.y1 - f.y0 + 1
      // Balloon pieces are compact, light and inside the zone.
      if (f.count / (bw * bh) < 0.3) continue
      if (f.x0 < zone.x0 || f.y0 < zone.y0 || f.x1 > zone.x1 || f.y1 > zone.y1) continue
      area += f.count
      union = union
        ? {
            x0: Math.min(union.x0, f.x0),
            y0: Math.min(union.y0, f.y0),
            x1: Math.max(union.x1, f.x1),
            y1: Math.max(union.y1, f.y1),
          }
        : { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 }
    }
  }
  if (!union || area < approxArea * 0.15) return approx
  const rect: Rect = {
    x: union.x0 / w,
    y: union.y0 / h,
    w: (union.x1 - union.x0 + 1) / w,
    h: (union.y1 - union.y0 + 1) / h,
  }
  if (iou(rect, approx) < 0.3) return approx
  // Grow slightly to include the balloon outline.
  const gx = rect.w * 0.03
  const gy = rect.h * 0.06
  return { x: rect.x - gx, y: rect.y - gy, w: rect.w + 2 * gx, h: rect.h + 2 * gy }
}
