import { describe, expect, it } from 'vitest'
import { refineBubble } from '../../src/renderer/src/cv/bubbles'
import { iou } from '../../src/shared/geometry'
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
    const approx = { x: 200 / W, y: 160 / H, w: 250 / W, h: 110 / H }
    const refined = refineBubble(page(), approx)
    expect(iou(refined, truth)).toBeGreaterThan(0.8)
    expect(iou(refined, truth)).toBeGreaterThan(iou(approx, truth))
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
