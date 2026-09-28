import { describe, expect, it } from 'vitest'
import {
  applyConsolidation,
  applyPageResult,
  choosePanelRect,
  mergeCharacters,
  needsReview,
  normalizeName,
} from '../../src/shared/roster'
import { aiChar, aiLine, makeDoc, result } from '../helpers/doc'

const R = { x: 0.05, y: 0.05, w: 0.4, h: 0.3 }

describe('applyPageResult', () => {
  it('maps roster ids and creates new characters', () => {
    const doc = makeDoc()
    applyPageResult(
      doc,
      0,
      result(
        [
          {
            label: 'P1',
            rect: R,
            lines: [
              aiLine('bobik', 'Ahoj!'),
              aiLine('new_pan', 'Dobrý den.'),
              aiLine('narrator', 'Mezitím…', { kind: 'narration' }),
            ],
          },
        ],
        [
          aiChar('bobik', 'Bobík'),
          aiChar('new_pan', 'Pan Kudrna', { nameConfidence: 'low', gender: 'unknown' }),
        ],
      ),
      { candidates: [{ label: 'P1', rect: R }] },
    )
    const lines = doc.pages[0].panels[0].lines
    expect(lines.map((l) => l.speakerId)).toEqual(['bobik', 'pan-kudrna', 'narrator'])
    expect(doc.pages[0].status).toBe('done')
    const pan = doc.characters.find((c) => c.id === 'pan-kudrna')!
    expect(pan.lineCount).toBe(1)
    expect(needsReview(pan)).toBe(true)
    expect(doc.characters.find((c) => c.id === 'bobik')!.lineCount).toBe(1)
  })

  it('reuses a character with the same specific name on another page', () => {
    const doc = makeDoc()
    const opts = { candidates: [] }
    applyPageResult(
      doc,
      0,
      result(
        [{ label: null, rect: R, lines: [aiLine('new_a', 'Hola!')] }],
        [aiChar('new_a', 'Hajný Bouchal')],
      ),
      opts,
    )
    applyPageResult(
      doc,
      1,
      result(
        [{ label: null, rect: R, lines: [aiLine('new_b', 'Stůjte!')] }],
        [aiChar('new_b', 'hajny bouchal')],
      ),
      opts,
    )
    const hajni = doc.characters.filter((c) => normalizeName(c.name) === 'hajny bouchal')
    expect(hajni).toHaveLength(1)
    expect(hajni[0].lineCount).toBe(2)
  })

  it('keeps generic labels apart', () => {
    const doc = makeDoc()
    const opts = { candidates: [] }
    applyPageResult(
      doc,
      0,
      result(
        [{ label: null, rect: R, lines: [aiLine('new_a', 'A')] }],
        [aiChar('new_a', 'Muž', { nameConfidence: 'low' })],
      ),
      opts,
    )
    applyPageResult(
      doc,
      1,
      result(
        [{ label: null, rect: R, lines: [aiLine('new_b', 'B')] }],
        [aiChar('new_b', 'Muž', { nameConfidence: 'low' })],
      ),
      opts,
    )
    expect(doc.characters.filter((c) => c.name === 'Muž')).toHaveLength(2)
  })

  it('never renames the main heroes', () => {
    const doc = makeDoc()
    applyPageResult(
      doc,
      0,
      result([{ label: null, rect: R, lines: [aiLine('pinda', 'Jé!')] }], [aiChar('pinda', 'Pinďo')]),
      { candidates: [] },
    )
    expect(doc.characters.find((c) => c.id === 'pinda')!.name).toBe('Pinďa')
  })

  it('assigns unknown speaker keys to a fallback character', () => {
    const doc = makeDoc()
    applyPageResult(doc, 0, result([{ label: null, rect: R, lines: [aiLine('nobody', '???')] }], []), {
      candidates: [],
    })
    expect(doc.pages[0].panels[0].lines[0].speakerId).toBe('neznamy')
  })

  it('uses the refine callback for bubbles', () => {
    const doc = makeDoc()
    const refined = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }
    applyPageResult(doc, 0, result([{ label: null, rect: R, lines: [aiLine('bobik', 'Hm')] }], []), {
      candidates: [],
      refineBubble: () => refined,
    })
    expect(doc.pages[0].panels[0].lines[0].bubble).toEqual(refined)
  })
})

describe('choosePanelRect', () => {
  const cands = [
    { label: 'P1', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    { label: 'P2', rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
  ]
  it('uses the labelled candidate when it overlaps', () => {
    expect(choosePanelRect({ x: 0.02, y: 0.01, w: 0.46, h: 0.47 }, 'P1', cands)).toBe(cands[0].rect)
  })
  it('snaps a mislabelled box to the overlapping candidate', () => {
    expect(choosePanelRect({ x: 0.51, y: 0.02, w: 0.47, h: 0.46 }, 'P1', cands)).toBe(cands[1].rect)
  })
  it('keeps the AI box when nothing matches', () => {
    const r = { x: 0, y: 0.6, w: 1, h: 0.4 }
    expect(choosePanelRect(r, null, cands)).toBe(r)
  })
})

describe('mergeCharacters / applyConsolidation', () => {
  it('moves lines and removes the merged character', () => {
    const doc = makeDoc()
    applyPageResult(
      doc,
      0,
      result(
        [{ label: null, rect: R, lines: [aiLine('new_x', 'Já!'), aiLine('new_y', 'Já taky!')] }],
        [aiChar('new_x', 'Kocour Mikeš'), aiChar('new_y', 'Mikeš')],
      ),
      { candidates: [] },
    )
    applyConsolidation(doc, {
      merges: [{ into: 'kocour-mikes', from: ['mikes'] }],
      updates: [
        {
          id: 'kocour-mikes',
          name: 'Mikeš',
          nameConfidence: 'high',
          gender: 'male',
          genderConfidence: 'high',
          age: 'adult',
        },
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
    })
    const mikes = doc.characters.find((c) => c.id === 'kocour-mikes')!
    expect(mikes.name).toBe('Mikeš')
    expect(mikes.lineCount).toBe(2)
    expect(doc.characters.some((c) => c.id === 'mikes')).toBe(false)
  })

  it('refuses to merge the narrator', () => {
    const doc = makeDoc()
    const before = doc.characters.length
    mergeCharacters(doc, 'bobik', ['narrator'])
    expect(doc.characters).toHaveLength(before)
  })
})
