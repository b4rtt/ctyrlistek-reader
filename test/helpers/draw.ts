import type { Raster } from '../../src/renderer/src/cv/raster'

export type RGB = [number, number, number]

export function makeRaster(width: number, height: number, color: RGB = [255, 255, 255]): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = color[0]
    data[p * 4 + 1] = color[1]
    data[p * 4 + 2] = color[2]
    data[p * 4 + 3] = 255
  }
  return { width, height, data }
}

export function setPx(img: Raster, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  const i = (y * img.width + x) * 4
  img.data[i] = c[0]
  img.data[i + 1] = c[1]
  img.data[i + 2] = c[2]
}

export function fillRect(img: Raster, x: number, y: number, w: number, h: number, c: RGB): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(img, xx, yy, c)
}

export function strokeRect(img: Raster, x: number, y: number, w: number, h: number, c: RGB, t = 3): void {
  fillRect(img, x, y, w, t, c)
  fillRect(img, x, y + h - t, w, t, c)
  fillRect(img, x, y, t, h, c)
  fillRect(img, x + w - t, y, t, h, c)
}

/** Framed panel with a grey interior (simulated artwork). */
export function panel(img: Raster, x: number, y: number, w: number, h: number): void {
  fillRect(img, x, y, w, h, [150, 170, 190])
  strokeRect(img, x, y, w, h, [0, 0, 0], 3)
}

export function ellipse(img: Raster, cx: number, cy: number, rx: number, ry: number, fill: RGB, stroke: RGB, t = 2): void {
  for (let y = Math.floor(cy - ry - t); y <= cy + ry + t; y++)
    for (let x = Math.floor(cx - rx - t); x <= cx + rx + t; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
      const dOuter = ((x - cx) / (rx + t)) ** 2 + ((y - cy) / (ry + t)) ** 2
      if (d <= 1) setPx(img, x, y, fill)
      else if (dOuter <= 1) setPx(img, x, y, stroke)
    }
}
