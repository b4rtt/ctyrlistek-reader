import { describe, expect, it } from 'vitest'
import { applyPageResult } from '../../src/shared/roster'
import { allLines, buildTimeline, panelStartIndex } from '../../src/shared/timeline'
import { aiLine, makeDoc, result } from '../helpers/doc'

const R = { x: 0, y: 0, w: 0.5, h: 0.5 }

function doc() {
  const d = makeDoc(3)
  applyPageResult(d, 0, result([{ label: null, rect: R, lines: [aiLine('bobik', 'A'), aiLine('pinda', 'B')] }, { label: null, rect: R, lines: [] }], []), { candidates: [] })
  applyPageResult(d, 1, { ...result([], []), pageKind: 'cover' }, { candidates: [] })
  d.pages[2] = { ...d.pages[2], status: 'error' }
  return d
}

describe('buildTimeline', () => {
  it('flattens lines, silent panels and panel-less pages', () => {
    const beats = buildTimeline(doc())
    expect(beats.map((b) => [b.page, b.panel, b.line])).toEqual([
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, -1],
      [1, -1, -1],
    ])
    expect(beats[0].pageStart && beats[0].panelStart).toBe(true)
    expect(beats[1].panelStart).toBe(false)
    expect(beats[3].pageStart).toBe(true)
  })

  it('skips pages marked as skipped or failed', () => {
    const d = doc()
    d.pages[0] = { ...d.pages[0], skip: true }
    expect(buildTimeline(d).every((b) => b.page === 1)).toBe(true)
  })

  it('navigates between panel starts', () => {
    const beats = buildTimeline(doc())
    expect(panelStartIndex(beats, 0, 1)).toBe(2)
    expect(panelStartIndex(beats, 2, -1)).toBe(0)
  })

  it('lists all lines in order', () => {
    expect(allLines(doc()).map((l) => l.line.text)).toEqual(['A', 'B'])
  })
})
