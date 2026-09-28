/**
 * Local comic-panel detection.
 *
 * 1. Estimate the paper/gutter colour from the page margin.
 * 2. Flood-fill that colour from the page border – everything reached is
 *    "outside" (margins + gutters).
 * 3. Connected components of the remaining pixels are panel candidates.
 * 4. Candidates glued together by a balloon crossing a gutter are split with a
 *    recursive XY-cut that only accepts gutter lines open at both ends (so a
 *    white sky inside a framed panel is never mistaken for a gutter).
 *
 * The AI later confirms or corrects these candidates; they give it precise
 * geometry it is not good at producing itself.
 */
import type { Rect } from '@shared/types'
import { colorDist, type Raster } from './raster'

export interface PanelDetectOptions {
  /** Max colour distance (sum of |ΔR|+|ΔG|+|ΔB|) to count as background. */
  tolerance?: number
  /** Min panel area as a fraction of the page. */
  minArea?: number
}

interface Box {
  x0: number
  y0: number
  x1: number // exclusive
  y1: number // exclusive
}

const boxArea = (b: Box): number => (b.x1 - b.x0) * (b.y1 - b.y0)

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 255
}

export function estimateBackground(img: Raster): [number, number, number] {
  const { width: w, height: h, data } = img
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.015))
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const push = (x: number, y: number): void => {
    const i = (y * w + x) * 4
    rs.push(data[i])
    gs.push(data[i + 1])
    bs.push(data[i + 2])
  }
  const step = Math.max(1, Math.round(Math.max(w, h) / 400))
  for (let x = 0; x < w; x += step)
    for (let d = 0; d < band; d += 2) {
      push(x, d)
      push(x, h - 1 - d)
    }
  for (let y = 0; y < h; y += step)
    for (let d = 0; d < band; d += 2) {
      push(d, y)
      push(w - 1 - d, y)
    }
  return [median(rs), median(gs), median(bs)]
}

export function backgroundMask(img: Raster, bg: [number, number, number], tolerance: number): Uint8Array {
  const n = img.width * img.height
  const mask = new Uint8Array(n)
  for (let p = 0; p < n; p++) mask[p] = colorDist(img.data, p, bg[0], bg[1], bg[2]) <= tolerance ? 1 : 0
  return mask
}

/** Flood fill background pixels reachable from the image border. */
export function outsideMask(bgMask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  const seed = (p: number): void => {
    if (bgMask[p] && !out[p]) {
      out[p] = 1
      queue[tail++] = p
    }
  }
  for (let x = 0; x < w; x++) {
    seed(x)
    seed((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    seed(y * w)
    seed(y * w + w - 1)
  }
  while (head < tail) {
    const p = queue[head++]
    const x = p % w
    if (x > 0) seed(p - 1)
    if (x < w - 1) seed(p + 1)
    if (p >= w) seed(p - w)
    if (p < w * (h - 1)) seed(p + w)
  }
  return out
}

/** Bounding boxes + pixel counts of 4-connected components where `mask[p] === 0`. */
function components(mask: Uint8Array, w: number, h: number): (Box & { count: number })[] {
  const label = new Int32Array(w * h)
  const queue = new Int32Array(w * h)
  const out: (Box & { count: number })[] = []
  let next = 0
  for (let start = 0; start < w * h; start++) {
    if (mask[start] || label[start]) continue
    next++
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = next
    const b = { x0: w, y0: h, x1: 0, y1: 0, count: 0 }
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      const y = (p - x) / w
      b.count++
      if (x < b.x0) b.x0 = x
      if (y < b.y0) b.y0 = y
      if (x + 1 > b.x1) b.x1 = x + 1
      if (y + 1 > b.y1) b.y1 = y + 1
      const visit = (q: number): void => {
        if (!mask[q] && !label[q]) {
          label[q] = next
          queue[tail++] = q
        }
      }
      if (x > 0) visit(p - 1)
      if (x < w - 1) visit(p + 1)
      if (y > 0) visit(p - w)
      if (y < h - 1) visit(p + w)
    }
    out.push(b)
  }
  return out
}

/** Shrink a box to the non-background pixels inside it. */
function tighten(bgMask: Uint8Array, w: number, b: Box): Box | null {
  let x0 = b.x1
  let y0 = b.y1
  let x1 = b.x0
  let y1 = b.y0
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) {
      if (bgMask[y * w + x]) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x + 1 > x1) x1 = x + 1
      if (y + 1 > y1) y1 = y + 1
    }
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}

/**
 * Find the best gutter line across `b` along one axis. A line qualifies when
 * ≥ 80 % of it is background and both of its ends are background (open
 * gutter), and it has content on both sides.
 */
function findCut(bgMask: Uint8Array, w: number, b: Box, horizontal: boolean): number | null {
  const len = horizontal ? b.x1 - b.x0 : b.y1 - b.y0
  const span = horizontal ? b.y1 - b.y0 : b.x1 - b.x0
  const margin = Math.max(4, Math.round(span * 0.06))
  const endLen = Math.max(2, Math.round(len * 0.02))
  const qualifies: boolean[] = new Array(span).fill(false)
  for (let i = margin; i < span - margin; i++) {
    let bgCount = 0
    let endsOk = true
    for (let j = 0; j < len; j++) {
      const x = horizontal ? b.x0 + j : b.x0 + i
      const y = horizontal ? b.y0 + i : b.y0 + j
      const isBg = bgMask[y * w + x] === 1
      if (isBg) bgCount++
      else if (j < endLen || j >= len - endLen) endsOk = false
    }
    qualifies[i] = endsOk && bgCount >= len * 0.8
  }
  // Longest run of qualifying lines closest to the middle.
  let best: { mid: number; run: number } | null = null
  let i = 0
  while (i < span) {
    if (!qualifies[i]) {
      i++
      continue
    }
    let j = i
    while (j < span && qualifies[j]) j++
    const run = j - i
    const mid = Math.floor((i + j) / 2)
    if (run >= 2 && (!best || run > best.run)) best = { mid, run }
    i = j
  }
  return best ? best.mid : null
}

function xyCut(bgMask: Uint8Array, w: number, b: Box, minSide: number, depth = 0): Box[] {
  const tight = tighten(bgMask, w, b)
  if (!tight) return []
  if (depth > 5 || tight.x1 - tight.x0 < minSide * 2 || tight.y1 - tight.y0 < minSide * 2) return [tight]
  for (const horizontal of [true, false]) {
    const cut = findCut(bgMask, w, tight, horizontal)
    if (cut === null) continue
    const [a, c]: Box[] = horizontal
      ? [
          { ...tight, y1: tight.y0 + cut },
          { ...tight, y0: tight.y0 + cut },
        ]
      : [
          { ...tight, x1: tight.x0 + cut },
          { ...tight, x0: tight.x0 + cut },
        ]
    const parts = [...xyCut(bgMask, w, a, minSide, depth + 1), ...xyCut(bgMask, w, c, minSide, depth + 1)]
    const big = parts.filter((p) => p.x1 - p.x0 >= minSide && p.y1 - p.y0 >= minSide)
    if (big.length >= 2) return big
  }
  return [tight]
}

/** Sort boxes in reading order: rows top→bottom, left→right within a row. */
export function readingOrder<T extends { x: number; y: number; w: number; h: number }>(rects: T[]): T[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y)
  const rows: T[][] = []
  for (const r of sorted) {
    const row = rows.find((rw) =>
      rw.some((o) => {
        const overlap = Math.min(o.y + o.h, r.y + r.h) - Math.max(o.y, r.y)
        return overlap > Math.min(o.h, r.h) * 0.5
      }),
    )
    if (row) row.push(r)
    else rows.push([r])
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x))
}

export function detectPanels(img: Raster, opts: PanelDetectOptions = {}): Rect[] {
  const { width: w, height: h } = img
  const tolerance = opts.tolerance ?? 60
  const minArea = opts.minArea ?? 0.012
  const bg = estimateBackground(img)
  const bgMask = backgroundMask(img, bg, tolerance)
  const outside = outsideMask(bgMask, w, h)
  const pageArea = w * h
  const minSide = Math.round(Math.min(w, h) * 0.06)

  let boxes: Box[] = components(outside, w, h)
    .filter((c) => boxArea(c) >= pageArea * minArea && c.count >= boxArea(c) * 0.25)
    .map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }))

  // Split candidates merged by balloons that cross gutters.
  boxes = boxes.flatMap((b) => xyCut(bgMask, w, b, minSide))

  // Drop boxes nested inside others (insets, stray marks).
  boxes = boxes.filter(
    (b, i) =>
      boxArea(b) >= pageArea * minArea &&
      !boxes.some((o, j) => {
        if (i === j || boxArea(o) <= boxArea(b)) return false
        const ix = Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0))
        const iy = Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0))
        return ix * iy >= boxArea(b) * 0.9
      }),
  )

  const pad = 1
  const rects = boxes.map((b) => ({
    x: Math.max(0, b.x0 - pad) / w,
    y: Math.max(0, b.y0 - pad) / h,
    w: (Math.min(w, b.x1 + pad) - Math.max(0, b.x0 - pad)) / w,
    h: (Math.min(h, b.y1 + pad) - Math.max(0, b.y0 - pad)) / h,
  }))
  return readingOrder(rects)
}
