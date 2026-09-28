import { useEffect, useMemo, useRef, useState } from 'react'
import type { SettingsView, VoiceInfo } from '@shared/api'
import { mergeCharacters, needsReview } from '@shared/roster'
import { allLines } from '@shared/timeline'
import type { AgeGroup, Character, ComicDoc, Gender } from '@shared/types'
import { useNav } from '../App'
import { api, errorMessage } from '../api'
import { playPreview, speakWeb, stopPreview } from '../audio/preview'
import { Icon } from '../components/Icon'
import { Portrait } from '../components/Portrait'
import { Progress, Segmented, useToast } from '../components/ui'
import { useComicDoc } from '../hooks/useComicDoc'
import { updateSettings, useSettings } from '../hooks/useSettings'
import { useVoices } from '../hooks/useVoices'
import {
  castVoices,
  lineRequest,
  prepareVoices,
  recastOne,
  totalCharacters,
  type VoiceProgress,
} from '../pipeline/voices'
import { PagesEditor } from './PagesEditor'

const GENDER_OPTIONS: { value: Gender; label: string; className?: string }[] = [
  { value: 'male', label: '👨 Muž', className: 'male' },
  { value: 'female', label: '👩 Žena', className: 'female' },
  { value: 'unknown', label: '❔' },
]

const AGE_LABEL: Record<AgeGroup, string> = {
  child: 'Dítě',
  adult: 'Dospělý',
  elderly: 'Starší',
  unknown: 'Neznámý věk',
}

function sameVoice(a: Character, b: Character): boolean {
  return (
    a.voice.elevenVoiceId === b.voice.elevenVoiceId &&
    a.voice.systemVoice === b.voice.systemVoice &&
    a.voice.pitch === b.voice.pitch &&
    a.voice.rate === b.voice.rate
  )
}

/** Resolve the review flag after an edit. */
function withConfirmation(c: Character): Character {
  const certain = c.nameConfidence !== 'low' && c.gender !== 'unknown' && c.genderConfidence !== 'low'
  return { ...c, confirmed: c.confirmed || certain }
}

function CharacterCard({
  doc,
  ch,
  settings,
  voices,
  onChange,
  onRecast,
  onMerge,
}: {
  doc: ComicDoc
  ch: Character
  settings: SettingsView
  voices: VoiceInfo[]
  onChange: (next: Character) => void
  onRecast: (next: Character) => void
  onMerge: (into: string) => void
}): React.JSX.Element {
  const toast = useToast()
  const [name, setName] = useState(ch.name)
  const [previewing, setPreviewing] = useState(false)
  useEffect(() => setName(ch.name), [ch.name])

  const needs = needsReview(ch)
  const firstLine = useMemo(() => allLines(doc).find((l) => l.line.speakerId === ch.id)?.line, [doc, ch.id])

  const commitName = (): void => {
    const v = name.trim()
    if (!v || v === ch.name) return setName(ch.name)
    onChange(withConfirmation({ ...ch, name: v, nameConfidence: 'high' }))
  }

  const preview = async (): Promise<void> => {
    if (previewing) {
      stopPreview()
      setPreviewing(false)
      return
    }
    setPreviewing(true)
    try {
      const sample = firstLine ?? {
        kind: 'speech' as const,
        text: ch.isNarrator ? 'Bylo nebylo, za devatero horami…' : `Ahoj, já jsem ${ch.name}!`,
        emotion: 'happy' as const,
        intensity: 2 as const,
        delivery: 'normal' as const,
      }
      const ref = await api.voices.synthesize(lineRequest(doc.meta.id, sample, ch, settings))
      if (ref) await playPreview(doc.meta.id, ref)
      else await speakWeb(sample.text, { pitch: 1 + ch.voice.pitch / 12, rate: ch.voice.rate })
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setPreviewing(false)
    }
  }

  const sortedVoices = useMemo(() => {
    const score = (v: VoiceInfo): number =>
      (ch.gender !== 'unknown' && v.gender === ch.gender ? 0 : v.gender === 'unknown' ? 1 : 2) * 10 +
      (v.languages.includes('cs') ? 0 : 1)
    return [...voices].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
  }, [voices, ch.gender])

  const style = { '--char': ch.color } as React.CSSProperties
  return (
    <div className={`char-card ${needs ? 'needs' : ''}`} style={style}>
      <div className="head">
        <Portrait doc={doc} character={ch} />
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <input
            className={`input ${needs && ch.nameConfidence === 'low' ? 'attention' : ''}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            disabled={ch.isNarrator}
            aria-label="Jméno postavy"
            style={{ fontWeight: 800, fontSize: 16 }}
          />
          <div className="row wrap small">
            {ch.isMain && !ch.isNarrator && <span className="badge ok">Hlavní hrdina</span>}
            {ch.isNarrator && <span className="badge info">Vypravěč</span>}
            {needs && ch.nameConfidence === 'low' && <span className="badge warn">Ověřte jméno</span>}
            {needs && (ch.gender === 'unknown' || ch.genderConfidence === 'low') && (
              <span className="badge warn">Ověřte pohlaví</span>
            )}
            <span className="muted">{ch.lineCount} replik</span>
          </div>
        </div>
      </div>

      {ch.description && <div className="small muted">{ch.description}</div>}
      {firstLine && <div className="quote">„{firstLine.text}“</div>}

      <div className="row wrap">
        <Segmented
          value={ch.gender}
          attention={needs && (ch.gender === 'unknown' || ch.genderConfidence === 'low')}
          onChange={(g) =>
            onRecast(
              withConfirmation({ ...ch, gender: g, genderConfidence: g === 'unknown' ? 'low' : 'high' }),
            )
          }
          options={GENDER_OPTIONS}
        />
        <select
          className="input"
          style={{ width: 'auto', flex: 1 }}
          value={ch.age}
          onChange={(e) => onRecast({ ...ch, age: e.target.value as AgeGroup })}
          aria-label="Věk"
        >
          {(Object.keys(AGE_LABEL) as AgeGroup[]).map((a) => (
            <option key={a} value={a}>
              {AGE_LABEL[a]}
            </option>
          ))}
        </select>
      </div>

      {settings.voiceMode === 'elevenlabs' ? (
        <div className="row">
          <select
            className="input grow"
            value={ch.voice.elevenVoiceId ?? ''}
            onChange={(e) => {
              const v = voices.find((x) => x.id === e.target.value)
              if (v)
                onChange({
                  ...ch,
                  voice: { ...ch.voice, elevenVoiceId: v.id, elevenVoiceName: v.name, manual: true },
                })
            }}
            aria-label="Hlas"
          >
            {!ch.voice.elevenVoiceId && <option value="">— vyberte hlas —</option>}
            {sortedVoices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.languages.includes('cs') ? '🇨🇿 ' : ''}
                {v.name} · {v.gender === 'male' ? 'muž' : v.gender === 'female' ? 'žena' : '?'}
                {v.traits.length ? ` · ${v.traits.slice(0, 3).join(', ')}` : ''}
              </option>
            ))}
          </select>
          <button
            className="btn icon"
            onClick={() => void preview()}
            title="Přehrát ukázku hlasu"
            disabled={!ch.voice.elevenVoiceId}
          >
            {previewing ? <span className="spinner" /> : <Icon name="volume" />}
          </button>
        </div>
      ) : (
        <div className="row">
          <label className="field grow">
            <span>Výška hlasu</span>
            <input
              type="range"
              min={-8}
              max={6}
              step={0.5}
              value={ch.voice.pitch}
              onChange={(e) =>
                onChange({ ...ch, voice: { ...ch.voice, pitch: Number(e.target.value), manual: true } })
              }
            />
          </label>
          <label className="field grow">
            <span>Tempo</span>
            <input
              type="range"
              min={0.8}
              max={1.25}
              step={0.05}
              value={ch.voice.rate}
              onChange={(e) =>
                onChange({ ...ch, voice: { ...ch.voice, rate: Number(e.target.value), manual: true } })
              }
            />
          </label>
          <button className="btn icon" onClick={() => void preview()} title="Přehrát ukázku hlasu">
            {previewing ? <span className="spinner" /> : <Icon name="volume" />}
          </button>
        </div>
      )}

      <div className="row">
        {needs && (
          <button className="btn small" onClick={() => onChange({ ...ch, confirmed: true })}>
            <Icon name="check" size={16} /> Je to správně
          </button>
        )}
        <div className="grow" />
        {!ch.isNarrator && (
          <select
            className="input"
            style={{ width: 'auto', minHeight: 32, fontSize: 13 }}
            value=""
            onChange={(e) => e.target.value && onMerge(e.target.value)}
            aria-label="Sloučit s jinou postavou"
          >
            <option value="">Je to stejná postava jako…</option>
            {doc.characters
              .filter((c) => c.id !== ch.id && !c.isNarrator)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        )}
      </div>
    </div>
  )
}

export function Review({ id, initialTab }: { id: string; initialTab?: 'cast' | 'pages' }): React.JSX.Element {
  const { go, openSettings } = useNav()
  const toast = useToast()
  const settings = useSettings()
  const { doc, update, flush, reload } = useComicDoc(id)
  const elevenEnabled = settings?.voiceMode === 'elevenlabs' && !!settings.elevenKey
  const voices = useVoices(elevenEnabled)
  const [tab, setTab] = useState<'cast' | 'pages'>(initialTab ?? 'cast')
  const [progress, setProgress] = useState<VoiceProgress | null>(null)
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)
  const abort = useRef<AbortController | null>(null)

  // Automatic casting whenever the doc, the voice list or the mode changes.
  useEffect(() => {
    if (!doc || !settings || voices.loading) return
    update((d) => {
      const next = castVoices(d, settings, voices.eleven)
      return next.characters.every((c, i) => sameVoice(c, d.characters[i])) ? d : next
    })
  }, [doc, settings, voices.loading, voices.eleven, update])

  useEffect(() => {
    if (elevenEnabled) void api.voices.quota().then((q) => q && setQuota(q))
  }, [elevenEnabled])

  useEffect(() => () => abort.current?.abort(), [])

  if (!doc || !settings) {
    return (
      <div className="screen">
        <div className="empty">
          <span className="spinner" style={{ display: 'inline-block' }} />
        </div>
      </div>
    )
  }

  const cast = doc.characters.filter((c) => c.lineCount > 0 || c.isNarrator)
  const sortedCast = [...cast].sort(
    (a, b) =>
      Number(needsReview(b)) - Number(needsReview(a)) ||
      Number(b.isMain) - Number(a.isMain) ||
      b.lineCount - a.lineCount,
  )
  const reviewCount = cast.filter(needsReview).length
  // Sound effects are silent when ElevenLabs effects are switched off.
  const lines = allLines(doc).filter(
    (l) => l.line.kind !== 'sfx' || settings.voiceMode === 'system' || settings.sfxEnabled,
  )
  const voiced = lines.filter((l) => l.line.audio && l.line.audio.provider === settings.voiceMode).length
  const chars = totalCharacters(doc)
  const failedPages = doc.pages.filter((p) => p.status !== 'done').length

  const setCharacter = (next: Character): void =>
    update((d) => ({ ...d, characters: d.characters.map((c) => (c.id === next.id ? next : c)) }))

  const recast = (next: Character): void =>
    update((d) =>
      recastOne(
        { ...d, characters: d.characters.map((c) => (c.id === next.id ? next : c)) },
        next.id,
        settings,
        voices.eleven,
      ),
    )

  const merge = (from: string, into: string): void => {
    const a = doc.characters.find((c) => c.id === from)
    const b = doc.characters.find((c) => c.id === into)
    if (
      !a ||
      !b ||
      !confirm(`Sloučit „${a.name}“ do „${b.name}“? Všechny repliky pak bude mluvit ${b.name}.`)
    )
      return
    update((d) => mergeCharacters(structuredClone(d), into, [from]))
  }

  const prepare = async (): Promise<boolean> => {
    if (settings.voiceMode === 'elevenlabs' && !settings.elevenKey && !settings.mockAi) {
      toast('Doplňte ElevenLabs klíč, nebo přepněte na systémové hlasy.', 'error')
      openSettings('voices')
      return false
    }
    await flush()
    abort.current = new AbortController()
    const { doc: next, error } = await prepareVoices(doc, settings, setProgress, abort.current.signal)
    update(() => next)
    await flush()
    setProgress(null)
    if (error) {
      toast(error, 'error')
      return false
    }
    const failed = allLines(next).filter((l) => !l.line.audio && l.line.kind !== 'sfx').length
    if (failed > 0) toast(`${failed} replik se nepodařilo namluvit – zkusí se znovu při přehrávání.`, 'error')
    return true
  }

  const play = async (): Promise<void> => {
    update((d) => ({ ...d, meta: { ...d.meta, stage: 'ready' } }))
    if (voiced < lines.length && (await prepare()) === false && settings.voiceMode === 'elevenlabs') return
    await flush()
    go({ name: 'player', id })
  }

  return (
    <>
      <div className="topbar">
        <button className="btn ghost" onClick={() => void flush().then(() => go({ name: 'library' }))}>
          <Icon name="back" /> Knihovna
        </button>
        <input
          className="input"
          style={{ maxWidth: 320, fontWeight: 800 }}
          value={doc.meta.title}
          onChange={(e) => {
            const title = e.target.value
            update((d) => ({ ...d, meta: { ...d.meta, title } }))
          }}
          aria-label="Název komiksu"
        />
        <div className="tabs">
          <button className={tab === 'cast' ? 'on' : ''} onClick={() => setTab('cast')}>
            <Icon name="users" size={16} /> Postavy a hlasy
            {reviewCount > 0 && (
              <span className="badge warn" style={{ marginLeft: 6 }}>
                {reviewCount}
              </span>
            )}
          </button>
          <button className={tab === 'pages' ? 'on' : ''} onClick={() => setTab('pages')}>
            <Icon name="pages" size={16} /> Stránky a texty
            {failedPages > 0 && (
              <span className="badge danger" style={{ marginLeft: 6 }}>
                {failedPages}
              </span>
            )}
          </button>
        </div>
        <div className="spacer" />
        <Segmented
          value={settings.voiceMode}
          onChange={(v) => void updateSettings({ voiceMode: v })}
          options={[
            { value: 'elevenlabs', label: '✨ ElevenLabs' },
            { value: 'system', label: '💻 Systémové' },
          ]}
        />
        <button className="btn ghost icon" onClick={() => openSettings()} title="Nastavení">
          <Icon name="settings" />
        </button>
      </div>

      <div className="screen">
        <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {tab === 'cast' ? (
            <>
              {reviewCount > 0 ? (
                <div className="banner warn">
                  <Icon name="warn" />
                  <span className="grow">
                    U {reviewCount === 1 ? 'jedné postavy' : `${reviewCount} postav`} si AI není jistá jménem
                    nebo pohlavím. Doplňte je prosím – podle toho se vybere hlas.
                  </span>
                </div>
              ) : (
                <div className="banner">
                  <Icon name="check" />
                  <span className="grow">
                    Postavy jsou připravené. Hlasy se přiřadily automaticky – můžete je libovolně změnit a
                    poslechnout si ukázku.
                  </span>
                </div>
              )}
              {settings.voiceMode === 'elevenlabs' && voices.error && (
                <div className="banner danger">
                  <Icon name="warn" />
                  <span className="grow">{voices.error}</span>
                  <button className="btn small" onClick={() => openSettings()}>
                    Nastavení
                  </button>
                </div>
              )}
              <div className="cast-grid">
                {sortedCast.map((c) => (
                  <CharacterCard
                    key={c.id}
                    doc={doc}
                    ch={c}
                    settings={settings}
                    voices={voices.eleven}
                    onChange={setCharacter}
                    onRecast={recast}
                    onMerge={(into) => merge(c.id, into)}
                  />
                ))}
              </div>
            </>
          ) : (
            <PagesEditor doc={doc} update={update} settings={settings} reload={reload} flush={flush} />
          )}

          <div className="sticky-bar">
            <div className="card">
              <Icon name="mic" size={26} />
              <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {progress ? (
                  <>
                    <div className="row small">
                      <b>
                        Namlouvám repliky… {progress.done} / {progress.total}
                      </b>
                      <span
                        className="muted"
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 420,
                        }}
                      >
                        {progress.current}
                      </span>
                    </div>
                    <Progress value={progress.done / Math.max(1, progress.total)} />
                  </>
                ) : (
                  <>
                    <b>
                      {voiced >= lines.length
                        ? 'Všechny repliky jsou namluvené'
                        : `Namluveno ${voiced} z ${lines.length} replik`}
                    </b>
                    <span className="small muted">
                      {settings.voiceMode === 'elevenlabs'
                        ? `Odhad spotřeby ElevenLabs: ~${chars.toLocaleString('cs')} znaků${
                            quota ? ` · zbývá ${(quota.limit - quota.used).toLocaleString('cs')}` : ''
                          }. Už namluvené repliky se nepočítají znovu.`
                        : 'Systémové hlasy jsou zdarma a fungují offline.'}
                    </span>
                  </>
                )}
              </div>
              {progress ? (
                <button className="btn" onClick={() => abort.current?.abort()}>
                  Zastavit
                </button>
              ) : (
                voiced < lines.length && (
                  <button className="btn" onClick={() => void prepare()}>
                    <Icon name="wand" /> Připravit hlasy
                  </button>
                )
              )}
              <button
                className="btn primary big"
                onClick={() => void play()}
                disabled={!!progress || lines.length === 0}
              >
                <Icon name="play" /> Přehrát komiks
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
