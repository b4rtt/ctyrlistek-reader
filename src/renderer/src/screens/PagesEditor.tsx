import { useEffect, useState } from 'react'
import type { SettingsView } from '@shared/api'
import { NARRATOR_ID } from '@shared/defaults'
import { DELIVERY_META, EMOTION_META, KIND_META } from '@shared/performance'
import { recountLines } from '@shared/roster'
import type { ComicDoc, Delivery, Emotion, Intensity, Line, LineKind, PageData } from '@shared/types'
import { DELIVERIES, EMOTIONS } from '@shared/types'
import { assetUrl, errorMessage } from '../api'
import { playPreview, speakWeb } from '../audio/preview'
import { Icon } from '../components/Icon'
import { Portrait } from '../components/Portrait'
import { useToast } from '../components/ui'
import { useNav } from '../App'
import { getJob, resumeImport } from '../pipeline/importJob'
import { speakerOf, synthesizeLine } from '../pipeline/voices'

interface Props {
  doc: ComicDoc
  settings: SettingsView
  update: (fn: (d: ComicDoc) => ComicDoc) => void
  reload: () => Promise<void>
  flush: () => Promise<void>
}

function mapPage(d: ComicDoc, index: number, fn: (p: PageData) => PageData): ComicDoc {
  const next = { ...d, pages: d.pages.map((p) => (p.index === index ? fn(p) : p)) }
  recountLines(next)
  return next
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr
  const copy = [...arr]
  const [x] = copy.splice(from, 1)
  copy.splice(to, 0, x)
  return copy
}

export function PagesEditor({ doc, settings, update, reload, flush }: Props): React.JSX.Element {
  const toast = useToast()
  const { go } = useNav()
  const [pageIndex, setPageIndex] = useState(() =>
    Math.max(
      0,
      doc.pages.findIndex((p) => p.status !== 'done'),
    ),
  )
  const [panelIndex, setPanelIndex] = useState(0)
  const [lineId, setLineId] = useState<string | null>(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const page = doc.pages[pageIndex] ?? doc.pages[0]

  useEffect(() => {
    setPanelIndex(0)
    setLineId(null)
  }, [pageIndex])

  if (!page) return <div className="empty card">Komiks nemá žádné stránky.</div>
  const panel = page.panels[panelIndex]

  const editLine = (id: string, patch: Partial<Line>): void =>
    update((d) =>
      mapPage(d, page.index, (p) => ({
        ...p,
        panels: p.panels.map((pn) => ({
          ...pn,
          // Any change invalidates the generated audio.
          lines: pn.lines.map((l) => (l.id === id ? { ...l, ...patch, audio: null } : l)),
        })),
      })),
    )

  const editPanelLines = (fn: (lines: Line[]) => Line[]): void =>
    update((d) =>
      mapPage(d, page.index, (p) => ({
        ...p,
        panels: p.panels.map((pn, i) => (i === panelIndex ? { ...pn, lines: fn(pn.lines) } : pn)),
      })),
    )

  const addLine = (): void => {
    const line: Line = {
      id: `u-${Date.now().toString(36)}`,
      kind: 'speech',
      speakerId: doc.characters.find((c) => !c.isNarrator)?.id ?? NARRATOR_ID,
      text: '',
      originalText: '',
      emotion: 'neutral',
      intensity: 1,
      delivery: 'normal',
      direction: '',
      bubble: null,
      sfxPrompt: null,
      audio: null,
    }
    editPanelLines((ls) => [...ls, line])
    setLineId(line.id)
  }

  const reanalyze = async (): Promise<void> => {
    if (!confirm('Znovu nechat AI přečíst tuto stránku? Vaše úpravy na ní se přepíšou.')) return
    setReanalyzing(true)
    try {
      await flush()
      const job = await resumeImport(doc.meta.id, [page.index])
      await new Promise<void>((resolve) => {
        const unsub = job.subscribe((s) => {
          if (['done', 'error', 'cancelled'].includes(s.phase)) {
            queueMicrotask(() => unsub())
            if (s.error) toast(s.error, 'error')
            resolve()
          }
        })
      })
      await reload()
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setReanalyzing(false)
    }
  }

  /** Re-read every page (e.g. after an app update improved the analysis). */
  const reanalyzeAll = async (): Promise<void> => {
    if (
      !confirm(
        'Nechat AI znovu přečíst celý komiks? Ruční úpravy textů a pořadí se přepíšou; postavy a hlasy zůstanou.',
      )
    )
      return
    try {
      await flush()
      await resumeImport(
        doc.meta.id,
        doc.pages.map((p) => p.index),
      )
      go({ name: 'processing', id: doc.meta.id })
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const preview = async (line: Line): Promise<void> => {
    setPlaying(line.id)
    try {
      const ref = await synthesizeLine(doc, line, settings)
      if (ref) await playPreview(doc.meta.id, ref)
      else await speakWeb(line.text)
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setPlaying(null)
    }
  }

  const busy = reanalyzing || !!getJob(doc.meta.id)?.running

  return (
    <div className="editor">
      <div className="pages">
        {doc.pages.map((p) => (
          <div
            key={p.index}
            className={`page-thumb ${p.status} ${p.index === page.index ? 'sel' : ''} ${p.skip ? 'skipped' : ''}`}
            style={{ backgroundImage: `url("${assetUrl(doc.meta.id, p.thumb ?? p.image)}")` }}
            onClick={() => setPageIndex(p.index)}
            title={p.error ?? `Strana ${p.index + 1}`}
          >
            <span className="num">{p.index + 1}</span>
            {p.status === 'error' && (
              <span className="mark">
                <Icon name="warn" size={14} />
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="canvas">
        <div className="page-view">
          <img src={assetUrl(doc.meta.id, page.image)} alt={`Strana ${page.index + 1}`} draggable={false} />
          {page.panels.map((pn, i) => (
            <div
              key={pn.id}
              className={`box panel ${i === panelIndex ? 'sel' : ''}`}
              style={{
                left: `${pn.rect.x * 100}%`,
                top: `${pn.rect.y * 100}%`,
                width: `${pn.rect.w * 100}%`,
                height: `${pn.rect.h * 100}%`,
              }}
              onClick={() => {
                setPanelIndex(i)
                setLineId(null)
              }}
            >
              <span className="tag">{i + 1}</span>
            </div>
          ))}
          {panel?.lines.map((l) =>
            l.bubble ? (
              <div
                key={l.id}
                className={`box bubble ${l.id === lineId ? 'sel' : ''}`}
                style={
                  {
                    left: `${l.bubble.x * 100}%`,
                    top: `${l.bubble.y * 100}%`,
                    width: `${l.bubble.w * 100}%`,
                    height: `${l.bubble.h * 100}%`,
                    '--char': speakerOf(doc, l)?.color,
                  } as React.CSSProperties
                }
              />
            ) : null,
          )}
        </div>
      </div>

      <div className="lines">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
          <div className="row">
            <b className="grow">Strana {page.index + 1}</b>
            {page.status === 'error' && <span className="badge danger">Chyba</span>}
            {page.kind !== 'comic' && page.status === 'done' && (
              <span className="badge">
                {page.kind === 'cover' ? 'Obálka' : page.kind === 'text' ? 'Text' : 'Jiné'}
              </span>
            )}
          </div>
          {page.error && (
            <div className="small" style={{ color: 'var(--danger)' }}>
              {page.error}
            </div>
          )}
          <div className="row wrap">
            <label className="switch small">
              <input
                type="checkbox"
                checked={!page.skip}
                onChange={(e) =>
                  update((d) => mapPage(d, page.index, (p) => ({ ...p, skip: !e.target.checked })))
                }
              />
              Přehrávat tuto stranu
            </label>
            <div className="grow" />
            <button className="btn small" onClick={() => void reanalyze()} disabled={busy}>
              {reanalyzing ? <span className="spinner" /> : <Icon name="refresh" size={16} />} Přečíst znovu
            </button>
            <button
              className="btn small ghost"
              onClick={() => void reanalyzeAll()}
              disabled={busy}
              title="Znovu přečíst všechny strany"
            >
              Celý komiks
            </button>
          </div>
        </div>

        {page.panels.length > 0 && (
          <div className="row wrap">
            <b className="grow">
              Okénko {panelIndex + 1} / {page.panels.length}
            </b>
            <button
              className="btn small icon"
              title="Posunout okénko dřív"
              disabled={panelIndex === 0}
              onClick={() => {
                update((d) =>
                  mapPage(d, page.index, (p) => ({
                    ...p,
                    panels: move(p.panels, panelIndex, panelIndex - 1),
                  })),
                )
                setPanelIndex(panelIndex - 1)
              }}
            >
              <Icon name="up" size={16} />
            </button>
            <button
              className="btn small icon"
              title="Posunout okénko později"
              disabled={panelIndex >= page.panels.length - 1}
              onClick={() => {
                update((d) =>
                  mapPage(d, page.index, (p) => ({
                    ...p,
                    panels: move(p.panels, panelIndex, panelIndex + 1),
                  })),
                )
                setPanelIndex(panelIndex + 1)
              }}
            >
              <Icon name="down" size={16} />
            </button>
          </div>
        )}

        {panel?.lines.map((l, li) => {
          const speaker = speakerOf(doc, l)
          return (
            <div
              key={l.id}
              className={`line-card ${l.id === lineId ? 'sel' : ''}`}
              style={{ '--char': speaker?.color } as React.CSSProperties}
              onClick={() => setLineId(l.id)}
            >
              <div className="row">
                <Portrait doc={doc} character={speaker} size="tiny" />
                <select
                  className="input"
                  style={{ minHeight: 32, flex: 1 }}
                  value={l.kind === 'sfx' ? '' : (l.speakerId ?? '')}
                  disabled={l.kind === 'sfx'}
                  onChange={(e) => editLine(l.id, { speakerId: e.target.value })}
                  aria-label="Kdo mluví"
                >
                  {l.kind === 'sfx' && <option value="">Zvukový efekt</option>}
                  {doc.characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn small icon"
                  title="Přehrát"
                  onClick={() => void preview(l)}
                  disabled={!l.text.trim()}
                >
                  {playing === l.id ? <span className="spinner" /> : <Icon name="volume" size={16} />}
                </button>
              </div>
              <textarea
                className="input"
                value={l.text}
                rows={2}
                onChange={(e) => editLine(l.id, { text: e.target.value })}
                aria-label="Text repliky"
              />
              {l.originalText && l.originalText !== l.text && (
                <div className="original">{l.originalText}</div>
              )}
              <div className="grid2">
                <select
                  className="input"
                  value={l.kind}
                  onChange={(e) => {
                    const kind = e.target.value as LineKind
                    editLine(l.id, {
                      kind,
                      speakerId:
                        kind === 'narration'
                          ? NARRATOR_ID
                          : kind === 'sfx'
                            ? null
                            : (l.speakerId ?? NARRATOR_ID),
                      sfxPrompt: kind === 'sfx' ? (l.sfxPrompt ?? l.text) : null,
                    })
                  }}
                  aria-label="Druh"
                >
                  {(Object.keys(KIND_META) as LineKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_META[k].label}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={l.emotion}
                  onChange={(e) => editLine(l.id, { emotion: e.target.value as Emotion })}
                  aria-label="Emoce"
                >
                  {EMOTIONS.map((e) => (
                    <option key={e} value={e}>
                      {EMOTION_META[e].emoji} {EMOTION_META[e].label}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={l.delivery}
                  onChange={(e) => editLine(l.id, { delivery: e.target.value as Delivery })}
                  aria-label="Hlasitost"
                >
                  {DELIVERIES.map((d) => (
                    <option key={d} value={d}>
                      {DELIVERY_META[d].emoji} {DELIVERY_META[d].label}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={l.intensity}
                  onChange={(e) => editLine(l.id, { intensity: Number(e.target.value) as Intensity })}
                  aria-label="Síla emoce"
                >
                  <option value={1}>Jemně</option>
                  <option value={2}>Výrazně</option>
                  <option value={3}>Naplno</option>
                </select>
              </div>
              <div className="row">
                <button
                  className="btn small ghost icon"
                  title="Dřív"
                  disabled={li === 0}
                  onClick={() => editPanelLines((ls) => move(ls, li, li - 1))}
                >
                  <Icon name="up" size={16} />
                </button>
                <button
                  className="btn small ghost icon"
                  title="Později"
                  disabled={li === panel.lines.length - 1}
                  onClick={() => editPanelLines((ls) => move(ls, li, li + 1))}
                >
                  <Icon name="down" size={16} />
                </button>
                <div className="grow" />
                <button
                  className="btn small ghost danger"
                  onClick={() => editPanelLines((ls) => ls.filter((x) => x.id !== l.id))}
                >
                  <Icon name="trash" size={16} /> Smazat
                </button>
              </div>
            </div>
          )
        })}

        {panel && (
          <button className="btn" onClick={addLine}>
            <Icon name="plus" /> Přidat repliku
          </button>
        )}
        {page.status === 'done' && page.panels.length === 0 && (
          <div className="empty card small">Na této straně AI nenašla nic k přečtení.</div>
        )}
        {page.status !== 'done' && (
          <div className="empty card small">Stránka ještě nebyla přečtena. Klikněte na „Přečíst znovu“.</div>
        )}
      </div>
    </div>
  )
}
