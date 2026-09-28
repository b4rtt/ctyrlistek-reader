import { describe, expect, it } from 'vitest'
import { detectPanels, readingOrder } from '../../src/renderer/src/cv/panels'
import { iou } from '../../src/shared/geometry'
import { ellipse, fillRect, makeRaster, panel } from '../helpers/draw'

const W = 600
const H = 800
const norm = (x: number, y: number, w: number, h: number) => ({ x: x / W, y: y / H, w: w / W, h: h / H })

describe('detectPanels', () => {
  it('finds a 2×2 grid in reading order', () => {
    const img = makeRaster(W, H)
    panel(img, 30, 30, 260, 350)
    panel(img, 310, 30, 260, 350)
    panel(img, 30, 400, 260, 370)
    panel(img, 310, 400, 260, 370)
    const found = detectPanels(img)
    expect(found).toHaveLength(4)
    const expected = [norm(30, 30, 260, 350), norm(310, 30, 260, 350), norm(30, 400, 260, 370), norm(310, 400, 260, 370)]
    found.forEach((r, i) => expect(iou(r, expected[i])).toBeGreaterThan(0.95))
  })

  it('splits panels glued together by a balloon crossing the gutter', () => {
    const img = makeRaster(W, H)
    panel(img, 30, 30, 260, 350)
    panel(img, 310, 30, 260, 350)
    panel(img, 30, 400, 540, 370)
    // Balloon bridging the vertical gutter between the two top panels.
    ellipse(img, 300, 120, 60, 35, [255, 255, 255], [0, 0, 0])
    const found = detectPanels(img)
    expect(found).toHaveLength(3)
    expect(iou(found[0], norm(30, 30, 260, 350))).toBeGreaterThan(0.85)
    expect(iou(found[1], norm(310, 30, 260, 350))).toBeGreaterThan(0.85)
    expect(iou(found[2], norm(30, 400, 540, 370))).toBeGreaterThan(0.95)
  })

  it('does not split a framed panel at a white sky band', () => {
    const img = makeRaster(W, H)
    panel(img, 30, 30, 540, 740)
    fillRect(img, 33, 300, 534, 60, [255, 255, 255])
    const found = detectPanels(img)
    expect(found).toHaveLength(1)
  })

  it('ignores small marks such as page numbers', () => {
    const img = makeRaster(W, H)
    panel(img, 30, 30, 540, 700)
    fillRect(img, 290, 760, 20, 12, [0, 0, 0])
    expect(detectPanels(img)).toHaveLength(1)
  })

  it('works on tinted paper', () => {
    const img = makeRaster(W, H, [240, 230, 200])
    panel(img, 30, 30, 260, 740)
    panel(img, 310, 30, 260, 740)
    expect(detectPanels(img)).toHaveLength(2)
  })
})

describe('readingOrder', () => {
  it('orders rows top to bottom, left to right', () => {
    const rects = [
      { x: 0.5, y: 0.52, w: 0.4, h: 0.4 },
      { x: 0.05, y: 0.05, w: 0.4, h: 0.4 },
      { x: 0.05, y: 0.5, w: 0.4, h: 0.4 },
      { x: 0.5, y: 0.07, w: 0.4, h: 0.4 },
    ]
    expect(readingOrder(rects).map((r) => [r.x, r.y])).toEqual([
      [0.05, 0.05],
      [0.5, 0.07],
      [0.05, 0.5],
      [0.5, 0.52],
    ])
  })
})
