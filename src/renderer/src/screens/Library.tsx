import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComicSummary } from '@shared/types'
import { useNav } from '../App'
import { api, assetUrl, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { Logo } from '../components/Logo'
import { Progress, useToast } from '../components/ui'
import { useSettings } from '../hooks/useSettings'
import { getJob, startImport, subscribeJobs } from '../pipeline/importJob'

function stageBadge(s: ComicSummary): React.JSX.Element {
  const job = getJob(s.meta.id)
  if (job?.running) return <span className="badge info">Analyzuji…</span>
  if (s.meta.stage === 'rendering' || s.meta.stage === 'analyzing')
    return <span className="badge warn">Nedokončeno</span>
  if (s.needsReview > 0) return <span className="badge warn">Doplnit {s.needsReview}×</span>
  if (s.pagesFailed > 0) return <span className="badge danger">{s.pagesFailed} str. s chybou</span>
  if (s.lineCount > 0 && s.voicedLines >= s.lineCount) return <span className="badge ok">Připraveno</span>
  return <span className="badge ok">Zanalyzováno</span>
}

function ComicCard({ s, onChanged }: { s: ComicSummary; onChanged: () => void }): React.JSX.Element {
  const { go } = useNav()
  const toast = useToast()
  const job = getJob(s.meta.id)
  const running = job?.running
  const unfinished = s.meta.stage === 'rendering' || s.meta.stage === 'analyzing'

  const open = (): void => {
    if (running || unfinished) go({ name: 'processing', id: s.meta.id })
    else go({ name: 'player', id: s.meta.id })
  }

  const remove = async (): Promise<void> => {
    if (!confirm(`Opravdu smazat „${s.meta.title}“? Složka se přesune do koše.`)) return
    try {
      job?.cancel()
      await api.library.remove(s.meta.id)
      onChanged()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const progress = job
    ? (job.state.analyzed + job.state.failed) / Math.max(1, job.state.total)
    : s.pagesDone / Math.max(1, s.meta.pageCount)

  return (
    <div className="comic-card">
      <div
        className="cover"
        style={s.meta.cover ? { backgroundImage: `url("${assetUrl(s.meta.id, s.meta.cover)}")` } : undefined}
        onClick={open}
        role="button"
        aria-label={`Přehrát ${s.meta.title}`}
      >
        <div className="state">{stageBadge(s)}</div>
        {!running && !unfinished && (
          <div className="play-fab">
            <Icon name="play" size={30} />
          </div>
        )}
      </div>
      <div className="meta">
        <h3 title={s.meta.title}>{s.meta.title}</h3>
        {running || unfinished ? (
          <Progress value={progress} />
        ) : (
          <span className="small muted">
            {s.meta.pageCount} stran · {s.lineCount} replik
          </span>
        )}
        <div className="row">
          {running || unfinished ? (
            <button className="btn small grow" onClick={() => go({ name: 'processing', id: s.meta.id })}>
              Průběh
            </button>
          ) : (
            <>
              <button
                className="btn small primary grow"
                onClick={() => go({ name: 'player', id: s.meta.id })}
              >
                <Icon name="play" size={14} /> Přehrát
              </button>
              <button
                className="btn small"
                onClick={() => go({ name: 'review', id: s.meta.id })}
                title="Postavy, hlasy a texty"
              >
                <Icon name="edit" size={16} />
              </button>
            </>
          )}
          <button className="btn small ghost danger" onClick={() => void remove()} title="Smazat">
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function Library(): React.JSX.Element {
  const { go, openSettings } = useNav()
  const toast = useToast()
  const settings = useSettings()
  const [comics, setComics] = useState<ComicSummary[] | null>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    api.library
      .list()
      .then(setComics)
      .catch((e) => toast(errorMessage(e), 'error'))
  }, [toast])

  useEffect(() => {
    refresh()
    let timer: ReturnType<typeof setTimeout> | undefined
    // Throttled refresh while background jobs report progress.
    const unsub = subscribeJobs(() => {
      clearTimeout(timer)
      timer = setTimeout(refresh, 600)
    })
    return () => {
      unsub()
      clearTimeout(timer)
    }
  }, [refresh])

  const importFiles = async (files: FileList | File[]): Promise<void> => {
    const pdfs = [...files].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    if (pdfs.length === 0) {
      toast('Vyberte prosím PDF soubor s komiksem.', 'error')
      return
    }
    if (!settings?.openaiKey && !settings?.mockAi) {
      toast('Pro analýzu komiksu je potřeba OpenAI API klíč.', 'error')
      openSettings('openai')
      return
    }
    setBusy(true)
    try {
      let first: string | null = null
      for (const f of pdfs) {
        const job = await startImport(f)
        first ??= job.state.comicId
      }
      if (first) go({ name: 'processing', id: first })
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const missingKeys =
    settings &&
    !settings.mockAi &&
    (!settings.openaiKey || (settings.voiceMode === 'elevenlabs' && !settings.elevenKey))

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <Logo size={34} />
          <div>
            Čtyřlístek Reader
            <small>namluvené komiksy pro malé čtenáře</small>
          </div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => openSettings()}>
          <Icon name="settings" /> Nastavení
        </button>
      </div>
      <div className="screen">
        <div className="container">
          {missingKeys && (
            <div className="banner warn" style={{ marginBottom: 20 }}>
              <Icon name="info" />
              <span className="grow">
                {!settings.openaiKey
                  ? 'Pro rozpoznání okének, textů a postav doplňte OpenAI API klíč.'
                  : 'Pro herecké hlasy doplňte ElevenLabs klíč – nebo přepněte na systémové hlasy.'}
              </span>
              <button className="btn small" onClick={() => openSettings()}>
                Otevřít nastavení
              </button>
            </div>
          )}

          <div className="hero">
            <div
              className={`dropzone ${over ? 'over' : ''}`}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setOver(false)
                void importFiles(e.dataTransfer.files)
              }}
              role="button"
              tabIndex={0}
            >
              <div className="icon-bubble">
                {busy ? <span className="spinner" /> : <Icon name="upload" size={30} />}
              </div>
              <h2>Nahrát komiks v PDF</h2>
              <div className="muted">Přetáhněte sem soubor, nebo klikněte a vyberte ho.</div>
              <input
                ref={input}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) void importFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="card how">
              <h3>Jak to funguje</h3>
              <ol>
                <li>
                  <b>1</b>
                  <span>
                    AI projde každou stránku: najde okénka, přečte bubliny a pozná, kdo mluví a jak (vesele,
                    naštvaně, šeptem…).
                  </span>
                </li>
                <li>
                  <b>2</b>
                  <span>Zkontrolujete postavy – kde si AI není jistá jménem nebo pohlavím, doplníte ho.</span>
                </li>
                <li>
                  <b>3</b>
                  <span>Každá postava dostane vlastní hlas a komiks se přehraje jako film.</span>
                </li>
              </ol>
            </div>
          </div>

          <div className="row" style={{ marginBottom: 14 }}>
            <h2 className="grow">Moje komiksy</h2>
          </div>
          {comics === null ? (
            <div className="empty">
              <span className="spinner" style={{ display: 'inline-block' }} />
            </div>
          ) : comics.length === 0 ? (
            <div className="empty card">Zatím tu nic není. Nahrajte první komiks a začněte číst!</div>
          ) : (
            <div className="grid-comics">
              {comics.map((c) => (
                <ComicCard key={c.meta.id} s={c} onChanged={refresh} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
