import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PdfDocument = pdfjs.PDFDocumentProxy

export interface OpenedPdf {
  pdf: PdfDocument
  /** Free the document and its worker resources. */
  close: () => Promise<void>
}

export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  // pdf.js transfers (detaches) the buffer – give it a private copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: './pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: './pdfjs/standard_fonts/',
    wasmUrl: './pdfjs/wasm/',
    iccUrl: './pdfjs/iccs/',
  })
  return { pdf: await task.promise, close: () => task.destroy() }
}

export async function pdfTitle(doc: PdfDocument): Promise<string | null> {
  try {
    const meta = await doc.getMetadata()
    const title = (meta.info as { Title?: string } | undefined)?.Title?.trim()
    return title || null
  } catch {
    return null
  }
}

/**
 * Render a page so its longer side is at most `maxSide` px (never upscaling
 * more than 4× the PDF's nominal size).
 */
export async function renderPage(
  doc: PdfDocument,
  index: number,
  maxSide: number,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(index + 1)
  try {
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(4, maxSide / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return canvas
  } finally {
    page.cleanup()
  }
}
