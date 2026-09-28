/** A plain RGBA raster – works with canvas ImageData and in unit tests. */
export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function lum(data: Uint8ClampedArray, p: number): number {
  const i = p * 4
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
}

export function colorDist(data: Uint8ClampedArray, p: number, r: number, g: number, b: number): number {
  const i = p * 4
  return Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b)
}

/** Draw any canvas image source into a raster no larger than `maxSide`. */
export function rasterize(source: CanvasImageSource & { width: number; height: number }, maxSide: number): Raster {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  const img = ctx.getImageData(0, 0, width, height)
  return { width, height, data: img.data }
}
