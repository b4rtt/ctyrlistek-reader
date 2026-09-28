import { describe, expect, it } from 'vitest'
import { refineBubble } from '../../src/renderer/src/cv/bubbles'
import { coverage, iou } from '../../src/shared/geometry'
import { ellipse, fillRect, makeRaster, panel } from '../helpers/draw'

const W = 600
const H = 800

function page() {
  const img = makeRaster(W, H)
  panel(img, 30, 30, 540, 740)
  ellipse(img, 300, 200, 120, 60, [255, 255, 255], [0, 0, 0], 3)
  // "Lettering" inside the balloon.
  for (let i = 0; i < 6; i++) fillRect(img, 220 + i * 28, 185, 16, 10, [20, 20, 20])
  for (let i = 0; i < 5; i++) fillRect(img, 234 + i * 28, 205, 16, 10, [20, 20, 20])
  return img
}

const truth = { x: 180 / W, y: 140 / H, w: 240 / W, h: 120 / H }

describe('refineBubble', () => {
  it('snaps an offset approximate box to the real balloon', () => {
    const approx = { x: 192 / W, y: 146 / H, w: 240 / W, h: 118 / H } // AI boxes are off by a few %
    const refined = refineBubble(page(), approx)
    expect(iou(refined, truth)).toBeGreaterThan(0.8)
    // What matters for the camera: the whole balloon is inside the box.
    expect(coverage(truth, refined)).toBeGreaterThan(0.98)
    expect(coverage(truth, approx)).toBeLessThan(0.95)
  })

  it('keeps the approximate box when there is no balloon', () => {
    const img = makeRaster(W, H)
    panel(img, 30, 30, 540, 740)
    const approx = { x: 0.3, y: 0.3, w: 0.2, h: 0.1 }
    expect(refineBubble(img, approx)).toEqual(approx)
  })

  it('handles yellow caption boxes', () => {
    const img = makeRaster(W, H)
    panel(img, 30, 30, 540, 740)
    fillRect(img, 40, 40, 300, 70, [0, 0, 0])
    fillRect(img, 43, 43, 294, 64, [250, 230, 120])
    fillRect(img, 60, 65, 200, 10, [10, 10, 10])
    const approx = { x: 50 / W, y: 45 / H, w: 260 / W, h: 70 / H }
    const refined = refineBubble(img, approx)
    expect(iou(refined, { x: 43 / W, y: 43 / H, w: 294 / W, h: 64 / H })).toBeGreaterThan(0.8)
  })
})

describe('refineBubble on tight lettering', () => {
  it('joins balloon pieces split by letters touching the outline', () => {
    const img = makeRaster(W, H)
    panel(img, 30, 30, 540, 740)
    ellipse(img, 300, 200, 140, 45, [255, 255, 255], [0, 0, 0], 3)
    // Two tall letters touching the top and bottom outline split the interior.
    fillRect(img, 240, 150, 8, 100, [15, 15, 15])
    fillRect(img, 340, 150, 8, 100, [15, 15, 15])
    const truth = { x: 160 / W, y: 155 / H, w: 280 / W, h: 90 / H }
    const approx = { x: 175 / W, y: 160 / H, w: 250 / W, h: 95 / H }
    const refined = refineBubble(img, approx, [{ x: 30 / W, y: 30 / H, w: 540 / W, h: 740 / H }])
    expect(iou(refined, truth)).toBeGreaterThan(0.8)
  })

  it('ignores the page margin next to the balloon', () => {
    const img = makeRaster(W, H)
    panel(img, 100, 100, 450, 600)
    const approx = { x: 20 / W, y: 20 / H, w: 60 / W, h: 40 / H } // pure page margin
    expect(refineBubble(img, approx, [{ x: 100 / W, y: 100 / H, w: 450 / W, h: 600 / H }])).toEqual(approx)
  })
})
