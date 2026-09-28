import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AudioOutput, Settings, TvCommand } from '@shared/api'
import { EMOTION_META } from '@shared/performance'
import type { ComicDoc } from '@shared/types'
import { useNav } from '../App'
import { api, assetUrl, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { Portrait } from '../components/Portrait'
import { TvDialog } from '../components/TvDialog'
import { Segmented, useToast } from '../components/ui'
import { getSettingsSnapshot, loadSettings, updateSettings, useSettings } from '../hooks/useSettings'
import { frame } from '../player/camera'
import { PlayerController, type PlayerState } from '../player/controller'
import { castVoices } from '../pipeline/voices'

/** Make sure every speaking character has a voice; fall back to system voices if ElevenLabs is unavailable. */
async function prepareDoc(
  doc: ComicDoc,
  settings: Settings,
): Promise<{ doc: ComicDoc; settings: Settings; notice: string | null }> {
  let notice: string | null = null
  let effective = settings
  let voices: Awaited<ReturnType<typeof api.voices.listEleven>> = []
  if (settings.voiceMode === 'elevenlabs') {
    try {
      voices = await api.voices.listEleven()
      if (voices.length === 0) throw new Error('Účet ElevenLabs nemá žádné hlasy')
    } catch (err) {
      effective = { ...settings, voiceMode: 'system' }
      notice = `ElevenLabs není dostupný (${errorMessage(err)}) – hraji se systémovými hlasy.`
    }
  }
  const cast = castVoices(doc, effective, voices)
  const changed = cast.characters.some(
    (c, i) => c.voice.elevenVoiceId !== doc.characters[i]?.voice.elevenVoiceId,
  )
  const next = changed ? await api.library.save(cast) : cast
  return { doc: next, settings: effective, notice }
}

function Words({
  text,
  words,
  current,
  highlight,
}: {
  text: string
  words: { start: number; end: number }[] | null
  current: number
  highlight: boolean
}): React.JSX.Element {
  if (!highlight || !words || words.length === 0) return <>{text}</>
  const out: React.ReactNode[] = []
  let pos = 0
  words.forEach((w, i) => {
    if (w.start > pos) out.push(text.slice(pos, w.start))
    out.push(
      <span key={i} className={`w ${i < current ? 'said' : i === current ? 'now' : ''}`}>
        {text.slice(w.start, w.end)}
      </span>,
    )
    pos = w.end
  })
  out.push(text.slice(pos))
  return <>{out}</>
}

interface PlayerProps {
  id: string
  /** `tv` = fullscreen window on the TV, driven by the remote (main window). */
  mode?: 'local' | 'tv'
  /** TV mode: beat to start playing from. */
  startBeat?: number
}

export function Player({ id, mode = 'local', startBeat = 0 }: PlayerProps): React.JSX.Element {
  const tv = mode === 'tv'
  const { go } = useNav()
  const toast = useToast()
  const liveSettings = useSettings()
  const [doc, setDoc] = useState<ComicDoc | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<PlayerState | null>(null)
  const [vp, setVp] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [chrome, setChrome] = useState(true)
  const [menu, setMenu] = useState(false)
  const [tvDialog, setTvDialog] = useState(false)
  const [outputs, setOutputs] = useState<AudioOutput[]>([])
  const ctrl = useRef<PlayerController | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stageRef = useRef<HTMLDivElement>(null)

  // ------------------------------------------------------------ bootstrap --
  useEffect(() => {
    let disposed = false
    ;(async () => {
      const [loaded, s] = await Promise.all([api.library.load(id), loadSettings()])
      const prepared = await prepareDoc(loaded, getSettingsSnapshot() ?? s)
      if (disposed) return
      if (prepared.notice) toast(prepared.notice)
      const savePosition = (beat: number): void => {
        void api.library.setLastBeat(id, beat).catch(() => undefined)
      }
      const c = new PlayerController(prepared.doc, prepared.settings, savePosition)
      ctrl.current = c
      setDoc(prepared.doc)
      setSettings(prepared.settings)
      c.subscribe(setState)
      if (tv) c.start(startBeat)
    })().catch((err) => toast(errorMessage(err), 'error'))
    return () => {
      disposed = true
      ctrl.current?.destroy()
      ctrl.current = null
    }
  }, [id, toast, tv, startBeat])

  // ------------------------------------------------------------ TV mode --
  useEffect(() => {
    if (!tv) return
    const off = api.tv.onCommand((cmd: TvCommand) => {
      const c = ctrl.current
      if (!c) return
      switch (cmd.type) {
        case 'toggle':
          return c.toggle()
        case 'pause':
          return c.pause()
        case 'next':
          return c.next()
        case 'prev':
          return c.prev()
        case 'nextPage':
          return c.nextPage()
        case 'prevPage':
          return c.prevPage()
        case 'restart':
          return c.start(0)
        case 'goto':
          return c.goTo(cmd.beat)
        case 'output':
          c.setOutput(cmd.deviceId)
          setOutputs((o) => [...o]) // republish
          return
      }
    })
    // Audio outputs (the AirPlay TV usually appears here, e.g. "Apple TV").
    const loadOutputs = (): void =>
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((ds) =>
          setOutputs(
            ds
              .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.label)
              .map((d) => ({ id: d.deviceId, label: d.label })),
          ),
        )
        .catch(() => undefined)
    loadOutputs()
    navigator.mediaDevices?.addEventListener('devicechange', loadOutputs)
    // Remember where the child stopped when the TV window closes.
    const onUnload = (): void => ctrl.current?.pause()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      off()
      navigator.mediaDevices?.removeEventListener('devicechange', loadOutputs)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [tv])

  // Publish the playback state to the remote.
  const pub = state && doc ? tvStateKey(state) : ''
  useEffect(() => {
    if (!tv || !state || !doc || !ctrl.current) return
    const c = ctrl.current
    const b = c.beats[state.beat]
    const page = doc.pages[state.camera.page]
    api.tv.publish({
      comicId: doc.meta.id,
      title: doc.meta.title,
      display: '',
      beat: state.beat,
      total: c.beats.length,
      pageStarts: c.beats.map((x, i) => (x.pageStart ? i : -1)).filter((i) => i >= 0),
      started: state.started,
      playing: state.playing,
      ended: state.ended,
      loading: state.loading,
      page: page?.index ?? 0,
      pageCount: doc.pages.length,
      panel: b?.panel ?? -1,
      thumb: page ? (page.thumb ?? page.image) : null,
      text: state.line && state.line.kind !== 'sfx' ? state.line.text : null,
      speaker: state.speaker?.name ?? null,
      color: state.speaker?.color ?? null,
      outputs,
      output: c.output,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv, pub, outputs])

  // Live settings changes (subtitles, pace…) apply immediately.
  useEffect(() => {
    if (!liveSettings || !settings) return
    const merged: Settings = { ...liveSettings, voiceMode: settings.voiceMode }
    ctrl.current?.updateSettings(merged)
  }, [liveSettings, settings])

  useEffect(() => {
    if (state?.error) toast(state.error, 'error')
  }, [state?.error, toast])

  // Loud sound effects shake the camera.
  const shake = state?.shake ?? 0
  useEffect(() => {
    if (shake === 0) return
    stageRef.current?.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: 'translate(-7px, 3px)' },
        { transform: 'translate(6px, -3px)' },
        { transform: 'translate(-4px, 2px)' },
        { transform: 'translate(3px, -1px)' },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' },
    )
  }, [shake])

  // ------------------------------------------------------------ viewport --
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setVp({ width: e.contentRect.width, height: e.contentRect.height }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  // --------------------------------------------------------- chrome idle --
  const poke = useCallback(() => {
    setChrome(true)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      if (ctrl.current?.snapshot.playing) {
        setChrome(false)
        setMenu(false)
      }
    }, 2800)
  }, [])
  useEffect(() => {
    if (state?.playing) poke()
    else setChrome(true)
  }, [state?.playing, poke])

  const exit = useCallback(() => {
    ctrl.current?.pause()
    if (document.fullscreenElement) void document.exitFullscreen()
    go({ name: 'library' })
  }, [go])

  // ------------------------------------------------------------ keyboard --
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const c = ctrl.current
      if (!c) return
      poke()
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          c.toggle()
          break
        case 'ArrowRight':
          c.next()
          break
        case 'ArrowLeft':
          c.prev()
          break
        case 'ArrowDown':
        case 'PageDown':
          c.nextPage()
          break
        case 'ArrowUp':
        case 'PageUp':
          c.prevPage()
          break
        case 'f':
          if (document.fullscreenElement) void document.exitFullscreen()
          else void document.documentElement.requestFullscreen()
          break
        case 's':
          if (liveSettings) void updateSettings({ subtitles: !liveSettings.subtitles })
          break
        case 'Escape':
          if (document.fullscreenElement) void document.exitFullscreen()
          else if (!tv) exit()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [poke, exit, liveSettings, tv])

  // Preload the next page image for a seamless page turn.
  const cameraPage = state?.camera.page ?? 0
  useEffect(() => {
    const next = doc?.pages.find((p) => p.index > cameraPage && !p.skip)
    if (next && doc) new Image().src = assetUrl(doc.meta.id, next.image)
  }, [cameraPage, doc])

  const subtitles = liveSettings?.subtitles ?? true
  const zoom = liveSettings?.zoom ?? 'medium'
  const framing = useMemo(() => {
    if (!doc || !state) return null
    const page = doc.pages[state.camera.page]
    if (!page) return null
    // Constant margins: the page must not jump when the controls fade out.
    return frame(
      state.camera.rect,
      page.width,
      page.height,
      {
        width: vp.width,
        height: vp.height,
        top: tv ? 20 : 40,
        bottom: subtitles ? (tv ? 200 : 150) : tv ? 20 : 100,
      },
      zoom,
    )
  }, [doc, state, vp, subtitles, zoom, tv])

  if (!doc || !state || !framing) {
    return (
      <div className="player">
        <div className="overlay-center">
          <div className="panel-box">
            <span className="spinner" style={{ width: 42, height: 42 }} />
            <div className="muted">Připravuji komiks…</div>
          </div>
        </div>
      </div>
    )
  }

  const c = ctrl.current!
  const page = doc.pages[state.camera.page]
  const beat = c.beats[state.beat]
  const panels = page.panels
  const line = state.line
  const speaker = state.speaker
  const color = speaker?.color ?? '#94a3b8'
  const lastBeat = doc.meta.lastBeat ?? 0
  const pageTicks = c.beats.map((b, i) => (b.pageStart ? i : -1)).filter((i) => i >= 0)
  const transition = `transform ${state.camera.duration}ms cubic-bezier(0.65, 0, 0.35, 1)`
  const spotRect = state.camera.spotlight ? state.camera.rect : { x: 0, y: 0, w: 1, h: 1 }

  return (
    <div
      className={`player ${tv ? 'tv chrome-hidden idle' : chrome ? '' : 'chrome-hidden idle'}`}
      onMouseMove={poke}
      onClick={() => setMenu(false)}
      style={{ '--char': color } as React.CSSProperties}
    >
      <div
        className="backdrop"
        style={{ backgroundImage: `url("${assetUrl(doc.meta.id, page.thumb ?? page.image)}")` }}
      />
      <div className="stage" ref={stageRef}>
        <div
          key={page.index}
          className="page-layer enter"
          style={{
            width: framing.baseW,
            height: framing.baseH,
            transform: `translate(${framing.tx}px, ${framing.ty}px) scale(${framing.scale})`,
            transition,
          }}
        >
          <img src={assetUrl(doc.meta.id, page.image)} alt="" draggable={false} />
          <div
            className="spotlight"
            style={{
              left: `${spotRect.x * 100}%`,
              top: `${spotRect.y * 100}%`,
              width: `${spotRect.w * 100}%`,
              height: `${spotRect.h * 100}%`,
              opacity: state.camera.spotlight ? 1 : 0,
              transitionDuration: `${Math.max(state.camera.duration, 350)}ms`,
            }}
          />
          {line?.bubble && (
            <div
              key={line.id}
              className="bubble-glow"
              style={{
                left: `${(line.bubble.x - 0.006) * 100}%`,
                top: `${(line.bubble.y - 0.005) * 100}%`,
                width: `${(line.bubble.w + 0.012) * 100}%`,
                height: `${(line.bubble.h + 0.01) * 100}%`,
              }}
            />
          )}
          {/* Tap targets: bubbles replay a line, panels jump to a panel. */}
          {panels.map((p, pi) => (
            <div
              key={p.id}
              className="hit"
              style={{
                left: `${p.rect.x * 100}%`,
                top: `${p.rect.y * 100}%`,
                width: `${p.rect.w * 100}%`,
                height: `${p.rect.h * 100}%`,
              }}
              onClick={(e) => {
                e.stopPropagation()
                c.goToPanel(page.index, pi)
              }}
            >
              {p.lines.map((l) =>
                l.bubble ? (
                  <div
                    key={l.id}
                    className="hit"
                    style={{
                      left: `${((l.bubble.x - p.rect.x) / p.rect.w) * 100}%`,
                      top: `${((l.bubble.y - p.rect.y) / p.rect.h) * 100}%`,
                      width: `${(l.bubble.w / p.rect.w) * 100}%`,
                      height: `${(l.bubble.h / p.rect.h) * 100}%`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      c.goToLine(l.id)
                    }}
                  />
                ) : null,
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="vignette" />

      {/* Subtitles */}
      {state.started && !state.ended && (
        <div className={`subtitle ${subtitles && line && line.kind !== 'sfx' ? '' : 'off'}`}>
          {line && (
            <>
              <div className="who">
                <Portrait doc={doc} character={speaker ?? undefined} size="small" />
                <span>{speaker?.name ?? ''}</span>
              </div>
              <div className="text grow">
                <Words
                  text={line.text}
                  words={state.words}
                  current={state.word}
                  highlight={liveSettings?.wordHighlight ?? true}
                />
              </div>
              {line.emotion !== 'neutral' && <div className="emo">{EMOTION_META[line.emotion].emoji}</div>}
            </>
          )}
        </div>
      )}

      {state.loading && (
        <div className="loading-pill">
          <span className="spinner" /> Připravuji hlas…
        </div>
      )}

      {/* Controls (the TV is driven by the remote instead) */}
      {!tv && (
        <div className="chrome">
          <div className="top">
            <button className="round sm" onClick={exit} title="Zpět do knihovny (Esc)">
              <Icon name="back" />
            </button>
            <div className="title">{doc.meta.title}</div>
            <button
              className="round sm"
              onClick={() => {
                c.pause()
                setTvDialog(true)
              }}
              title="Přehrát na televizi (AirPlay)"
            >
              <Icon name="tv" />
            </button>
            <button
              className="round sm"
              onClick={() =>
                document.fullscreenElement
                  ? void document.exitFullscreen()
                  : void document.documentElement.requestFullscreen()
              }
              title="Celá obrazovka (F)"
            >
              <Icon name="expand" />
            </button>
          </div>
          {state.started && (
            <div className="bottom" onClick={(e) => e.stopPropagation()}>
              <div className="transport">
                <button className="round sm" onClick={() => c.prevPage()} title="Předchozí strana (↑)">
                  <Icon name="prev" />
                </button>
                <button className="round" onClick={() => c.prev()} title="Předchozí replika (←)">
                  <Icon name="back" size={26} />
                </button>
                <button
                  className="round main"
                  onClick={() => c.toggle()}
                  title="Přehrát / pozastavit (mezerník)"
                >
                  <Icon name={state.playing ? 'pause' : 'play'} size={34} />
                </button>
                <button className="round" onClick={() => c.next()} title="Další replika (→)">
                  <span style={{ transform: 'scaleX(-1)', display: 'grid' }}>
                    <Icon name="back" size={26} />
                  </span>
                </button>
                <button className="round sm" onClick={() => c.nextPage()} title="Další strana (↓)">
                  <Icon name="next" />
                </button>
                <button
                  className={`round sm ${subtitles ? 'on' : ''}`}
                  style={{ position: 'absolute', right: 26 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenu((m) => !m)
                  }}
                  title="Nastavení přehrávání"
                >
                  <Icon name="settings" />
                </button>
              </div>
              <div
                className="timeline"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  c.goTo(Math.round(((e.clientX - r.left) / r.width) * (c.beats.length - 1)))
                }}
              >
                <div className="track">
                  <div
                    className="fill"
                    style={{ width: `${(state.beat / Math.max(1, c.beats.length - 1)) * 100}%` }}
                  />
                </div>
                {pageTicks.map((i) => (
                  <div
                    key={i}
                    className="tick"
                    style={{ left: `${(i / Math.max(1, c.beats.length - 1)) * 100}%` }}
                  />
                ))}
              </div>
              <div className="info">
                <span>
                  Strana {page.index + 1} / {doc.pages.length}
                  {beat && beat.panel >= 0 ? ` · okénko ${beat.panel + 1}` : ''}
                </span>
                <span className="row" style={{ gap: 14 }}>
                  <span>
                    <span className="kbd">mezerník</span> pauza
                  </span>
                  <span>
                    <span className="kbd">← →</span> repliky
                  </span>
                </span>
              </div>
            </div>
          )}
          {menu && liveSettings && (
            <div className="popover" onClick={(e) => e.stopPropagation()}>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={liveSettings.subtitles}
                  onChange={(e) => void updateSettings({ subtitles: e.target.checked })}
                />
                Titulky
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={liveSettings.wordHighlight}
                  onChange={(e) => void updateSettings({ wordHighlight: e.target.checked })}
                />
                Zvýrazňovat slova
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={liveSettings.pageIntro}
                  onChange={(e) => void updateSettings({ pageIntro: e.target.checked })}
                />
                Ukázat celou stránku
              </label>
              <label className="field">
                <span>Přiblížení</span>
                <Segmented
                  value={liveSettings.zoom}
                  onChange={(v) => void updateSettings({ zoom: v })}
                  options={[
                    { value: 'soft', label: 'Jemné' },
                    { value: 'medium', label: 'Střední' },
                    { value: 'strong', label: 'Výrazné' },
                  ]}
                />
              </label>
              <label className="field">
                <span>Tempo</span>
                <input
                  type="range"
                  min={0.6}
                  max={1.8}
                  step={0.1}
                  value={liveSettings.pace}
                  onChange={(e) => void updateSettings({ pace: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {/* Start / end overlays */}
      {!state.started && !tv && (
        <div className="overlay-center">
          <div className="panel-box">
            <div className="title-pill">{doc.meta.title}</div>
            <button className="start-btn" onClick={() => c.start(0)} aria-label="Pustit komiks">
              <Icon name="play" size={58} />
            </button>
            {lastBeat > 0 && lastBeat < c.beats.length - 1 && (
              <button className="btn big" onClick={() => c.start(lastBeat)}>
                <Icon name="replay" /> Pokračovat od strany {(c.beats[lastBeat]?.page ?? 0) + 1}
              </button>
            )}
            {c.beats.length > 0 && (
              <button className="btn ghost" onClick={() => setTvDialog(true)}>
                <Icon name="tv" /> Pustit na televizi
              </button>
            )}
            {c.beats.length === 0 && (
              <div className="banner warn">V komiksu nejsou žádné stránky k přehrání.</div>
            )}
          </div>
        </div>
      )}
      {state.ended && (
        <div className="overlay-center">
          <div className="panel-box">
            <div style={{ fontSize: 64 }}>🍀🎉</div>
            <h2>Konec!</h2>
            <div className={`row ${tv ? 'hidden' : ''}`}>
              <button className="btn big primary" onClick={() => c.start(0)}>
                <Icon name="replay" /> Znovu
              </button>
              <button className="btn big" onClick={exit}>
                Knihovna
              </button>
            </div>
          </div>
        </div>
      )}
      {tvDialog && (
        <TvDialog
          comicId={doc.meta.id}
          beat={state.started ? state.beat : lastBeat}
          onClose={() => setTvDialog(false)}
          onStarted={() => {
            c.pause()
            go({ name: 'remote', id: doc.meta.id })
          }}
          onMirror={() => {
            setTvDialog(false)
            void document.documentElement.requestFullscreen().catch(() => undefined)
            if (!state.started) c.start(lastBeat > 0 && lastBeat < c.beats.length - 1 ? lastBeat : 0)
            else c.resume()
          }}
        />
      )}
    </div>
  )
}

/** Fields of the player state the remote cares about (changes → publish). */
function tvStateKey(s: PlayerState): string {
  return [
    s.beat,
    s.started,
    s.playing,
    s.ended,
    s.loading,
    s.camera.page,
    s.line?.id ?? '',
    s.speaker?.id ?? '',
  ].join('|')
}
