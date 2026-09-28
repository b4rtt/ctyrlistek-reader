/**
 * Playback timeline: the comic flattened into "beats". A beat is the smallest
 * unit the player dwells on – one spoken line, or a silent panel/page.
 */
import type { ComicDoc, Line, PageData, Panel } from './types'

export interface Beat {
  page: number
  /** Panel index within the page, -1 for a page without panels. */
  panel: number
  /** Line index within the panel, -1 for a silent panel. */
  line: number
  /** First beat of its page (page-turn transition happens before it). */
  pageStart: boolean
  /** First beat of its panel (camera move happens before it). */
  panelStart: boolean
}

export function isPlayablePage(p: PageData): boolean {
  return !p.skip && p.status === 'done'
}

export function buildTimeline(doc: ComicDoc): Beat[] {
  const beats: Beat[] = []
  for (const page of doc.pages) {
    if (!isPlayablePage(page)) continue
    if (page.panels.length === 0) {
      beats.push({ page: page.index, panel: -1, line: -1, pageStart: true, panelStart: true })
      continue
    }
    page.panels.forEach((panel, pi) => {
      if (panel.lines.length === 0) {
        beats.push({ page: page.index, panel: pi, line: -1, pageStart: pi === 0, panelStart: true })
        return
      }
      panel.lines.forEach((_, li) => {
        beats.push({ page: page.index, panel: pi, line: li, pageStart: pi === 0 && li === 0, panelStart: li === 0 })
      })
    })
  }
  return beats
}

export function beatPanel(doc: ComicDoc, b: Beat): Panel | null {
  return b.panel >= 0 ? (doc.pages[b.page]?.panels[b.panel] ?? null) : null
}

export function beatLine(doc: ComicDoc, b: Beat): Line | null {
  const panel = beatPanel(doc, b)
  return panel && b.line >= 0 ? (panel.lines[b.line] ?? null) : null
}

/** First beat index for a given page (or -1). */
export function pageStartIndex(beats: Beat[], page: number): number {
  return beats.findIndex((b) => b.page === page)
}

/** Next/previous beat that starts a panel. */
export function panelStartIndex(beats: Beat[], from: number, dir: 1 | -1): number {
  let i = from + dir
  while (i >= 0 && i < beats.length && !beats[i].panelStart) i += dir
  return Math.max(0, Math.min(beats.length - 1, i))
}

/** All lines in reading order – used for batch audio generation. */
export function allLines(doc: ComicDoc): { page: number; panel: number; index: number; line: Line }[] {
  const out: { page: number; panel: number; index: number; line: Line }[] = []
  for (const page of doc.pages) {
    if (!isPlayablePage(page)) continue
    page.panels.forEach((panel, pi) => panel.lines.forEach((line, index) => out.push({ page: page.index, panel: pi, index, line })))
  }
  return out
}
