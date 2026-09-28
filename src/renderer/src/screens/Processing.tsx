import { useEffect, useState } from 'react'
import type { ComicDoc } from '@shared/types'
import { OPENAI_MODELS } from '@shared/defaults'
import { useNav } from '../App'
import { assetUrl, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { Progress, useToast } from '../components/ui'
import { useSettings } from '../hooks/useSettings'
import { getJob, resumeImport, type JobState } from '../pipeline/importJob'

const PHASES: { key: JobState['phase']; label: string }[] = [
  { key: 'rendering', label: 'Načtení stránek' },
  { key: 'analyzing', label: 'AI čte komiks' },
  { key: 'consolidating', label: 'Sjednocení postav' },
  { key: 'done', label: 'Hotovo' },
]

export function Processing({ id }: { id: string }): React.JSX.Element {
  const { go, openSettings } = useNav()
  const toast = useToast()
  const [state, setState] = useState<JobState | null>(() => getJob(id)?.state ?? null)
  const [doc, setDoc] = useState<ComicDoc | null>(null)

  // Attach to a running job, or resume an unfinished import.
  useEffect(() => {
    let unsub: (() => void) | undefined
    let cancelled = false
    const attach = async (): Promise<void> => {
      // A finished job from this session just shows its result; otherwise resume.
      const job = getJob(id) ?? (await resumeImport(id))
      if (cancelled) return
      unsub = job.subscribe((s) => {
        setState(s)
        setDoc({ ...job.document })
      })
    }
    attach().catch((e) => toast(errorMessage(e), 'error'))
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [id, toast])

  // Jump to the review once the job is done.
  useEffect(() => {
    if (state?.phase === 'done') {
      const t = setTimeout(() => go({ name: 'review', id }), 900)
      return () => clearTimeout(t)
    }
  }, [state?.phase, go, id])

  const retry = async (): Promise<void> => {
    try {
      const job = await resumeImport(id)
      job.subscribe((s) => {
        setState(s)
        setDoc({ ...job.document })
      })
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const phaseIndex = PHASES.findIndex((p) => p.key === state?.phase)
  const total = state?.total ?? 0
  const progress =
    state?.phase === 'rendering'
      ? state.rendered / Math.max(1, total)
      : ((state?.analyzed ?? 0) + (state?.failed ?? 0)) / Math.max(1, total)
  const pages = doc?.pages ?? []
  const settings = useSettings()
  const price = OPENAI_MODELS.find((m) => m.id === settings?.openaiModel)?.price
  const costUsd =
    state && price
      ? (state.usage.inputTokens * price[0] + state.usage.outputTokens * price[1]) / 1_000_000
      : 0

  return (
    <>
      <div className="topbar">
        <button className="btn ghost" onClick={() => go({ name: 'library' })}>
          <Icon name="back" /> Knihovna
        </button>
        <h1>{doc?.meta.title ?? 'Zpracování komiksu'}</h1>
        <div className="spacer" />
      </div>
      <div className="screen">
        <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div className="steps">
            {PHASES.map((p, i) => (
              <div key={p.key} className={`step ${i === phaseIndex ? 'on' : i < phaseIndex ? 'done' : ''}`}>
                {i < phaseIndex || state?.phase === 'done' ? (
                  <Icon name="check" size={16} />
                ) : i === phaseIndex ? (
                  <span className="spinner" />
                ) : null}
                {p.label}
              </div>
            ))}
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row">
              <h3 className="grow" style={{ margin: 0 }}>
                {state?.phase === 'rendering' && `Načítám stránky… ${state.rendered} / ${total || '?'}`}
                {state?.phase === 'analyzing' && `AI čte stránky… ${state.analyzed} / ${total}`}
                {state?.phase === 'consolidating' && 'Sjednocuji postavy napříč stránkami…'}
                {state?.phase === 'done' && 'Hotovo! Za chvíli zkontrolujeme postavy.'}
                {state?.phase === 'error' && 'Zpracování se zastavilo'}
                {state?.phase === 'cancelled' && 'Zpracování bylo zrušeno'}
                {!state && 'Připravuji…'}
              </h3>
              {costUsd > 0 && (
                <span className="small faint" title="Odhad ceny podle ceníku zvoleného modelu">
                  ~${costUsd.toFixed(2)}
                </span>
              )}
            </div>
            <Progress value={progress} indeterminate={!state || state.phase === 'consolidating'} />
            {state?.error && (
              <div className="banner danger">
                <Icon name="warn" />
                <span className="grow">{state.error}</span>
                <button className="btn small" onClick={() => openSettings()}>
                  Nastavení
                </button>
              </div>
            )}
            <div className="row">
              {state && ['error', 'cancelled'].includes(state.phase) && (
                <button className="btn primary" onClick={() => void retry()}>
                  <Icon name="refresh" /> Pokračovat
                </button>
              )}
              {state && ['rendering', 'analyzing'].includes(state.phase) && (
                <button className="btn" onClick={() => getJob(id)?.cancel()}>
                  Pozastavit
                </button>
              )}
              {state && state.failed > 0 && state.phase !== 'analyzing' && (
                <span className="small muted">
                  {state.failed} stran se nepodařilo přečíst – můžete je zkusit znovu později v editoru.
                </span>
              )}
              <div className="grow" />
              {state &&
                ['error', 'cancelled', 'done'].includes(state.phase) &&
                pages.some((p) => p.status === 'done') && (
                  <button className="btn" onClick={() => go({ name: 'review', id })}>
                    Pokračovat na kontrolu postav
                  </button>
                )}
            </div>
          </div>

          <div className="process-grid">
            {pages.map((p) => {
              const active = state?.active.includes(p.index)
              return (
                <div
                  key={p.index}
                  className={`page-thumb ${p.status} ${active ? 'active' : ''}`}
                  style={{ backgroundImage: `url("${assetUrl(id, p.image)}")` }}
                  title={p.error ?? undefined}
                >
                  <span className="num">{p.index + 1}</span>
                  {p.status === 'done' && (
                    <span className="mark">
                      <Icon name="check" size={14} stroke={3} />
                    </span>
                  )}
                  {p.status === 'error' && (
                    <span className="mark">
                      <Icon name="warn" size={14} />
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
