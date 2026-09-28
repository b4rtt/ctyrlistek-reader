import { useCallback, useEffect, useState } from 'react'
import type { TvCommand, TvState } from '@shared/api'
import { useNav } from '../App'
import { api, assetUrl } from '../api'
import { Icon } from '../components/Icon'
import { Segmented } from '../components/ui'
import { updateSettings, useSettings } from '../hooks/useSettings'

/**
 * Remote control shown in the main window while the comic plays on the TV
 * (AirPlay / external display).
 */
export function Remote({ id }: { id: string }): React.JSX.Element {
  const { go } = useNav()
  const settings = useSettings()
  const [state, setState] = useState<TvState | null>(null)
  const [connected, setConnected] = useState(true)

  useEffect(() => {
    void api.tv.isOpen().then(setConnected)
    return api.tv.onState((s) => {
      setState(s)
      setConnected(!!s)
    })
  }, [])

  const send = useCallback((cmd: TvCommand) => api.tv.command(cmd), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const map: Record<string, TvCommand> = {
        ' ': { type: 'toggle' },
        k: { type: 'toggle' },
        ArrowRight: { type: 'next' },
        ArrowLeft: { type: 'prev' },
        ArrowDown: { type: 'nextPage' },
        ArrowUp: { type: 'prevPage' },
      }
      const cmd = map[e.key]
      if (cmd) {
        e.preventDefault()
        send(cmd)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [send])

  const stop = async (then: 'library' | 'local'): Promise<void> => {
    send({ type: 'pause' })
    await api.tv.close()
    go(then === 'library' ? { name: 'library' } : { name: 'player', id })
  }

  const progress = state ? state.beat / Math.max(1, state.total - 1) : 0

  return (
    <>
      <div className="topbar">
        <button className="btn ghost" onClick={() => void stop('library')}>
          <Icon name="back" /> Knihovna
        </button>
        <h1>{state?.title ?? 'Dálkový ovladač'}</h1>
        <div className="spacer" />
        {connected && (
          <span className="badge ok">
            <Icon name="tv" size={14} /> {state?.display || 'Televize'}
          </span>
        )}
      </div>
      <div className="screen">
        <div className="container remote">
          {!connected ? (
            <div
              className="card center"
              style={{ padding: 40, display: 'grid', gap: 16, justifyItems: 'center' }}
            >
              <Icon name="tv" size={48} />
              <h2>Televize se odpojila</h2>
              <p className="muted" style={{ margin: 0 }}>
                AirPlay bylo ukončeno nebo se okno na televizi zavřelo. Místo, kde jste skončili, je uložené.
              </p>
              <div className="row">
                <button className="btn primary big" onClick={() => go({ name: 'player', id })}>
                  <Icon name="play" /> Pokračovat na počítači
                </button>
                <button className="btn big" onClick={() => go({ name: 'library' })}>
                  Knihovna
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="remote-now card"
                style={{ '--char': state?.color ?? '#94a3b8' } as React.CSSProperties}
              >
                <div
                  className="remote-thumb"
                  style={
                    state?.thumb ? { backgroundImage: `url("${assetUrl(id, state.thumb)}")` } : undefined
                  }
                />
                <div
                  className="grow"
                  style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}
                >
                  <span className="small muted">
                    {state
                      ? `Strana ${state.page + 1} / ${state.pageCount}${state.panel >= 0 ? ` · okénko ${state.panel + 1}` : ''}`
                      : 'Připojuji se k televizi…'}
                    {state?.loading && ' · připravuji hlas…'}
                    {state?.ended && ' · konec'}
                  </span>
                  {state?.speaker && <span className="remote-speaker">{state.speaker}</span>}
                  <div className="remote-text">{state?.text ?? (state?.playing ? '…' : '')}</div>
                </div>
              </div>

              <div className="transport remote-transport">
                <button className="round" onClick={() => send({ type: 'prevPage' })} title="Předchozí strana">
                  <Icon name="prev" />
                </button>
                <button className="round" onClick={() => send({ type: 'prev' })} title="Předchozí replika">
                  <Icon name="back" size={26} />
                </button>
                <button
                  className="round main"
                  onClick={() => send(state?.ended ? { type: 'restart' } : { type: 'toggle' })}
                  title="Přehrát / pozastavit"
                  disabled={!state}
                >
                  <Icon name={state?.ended ? 'replay' : state?.playing ? 'pause' : 'play'} size={34} />
                </button>
                <button className="round" onClick={() => send({ type: 'next' })} title="Další replika">
                  <span style={{ transform: 'scaleX(-1)', display: 'grid' }}>
                    <Icon name="back" size={26} />
                  </span>
                </button>
                <button className="round" onClick={() => send({ type: 'nextPage' })} title="Další strana">
                  <Icon name="next" />
                </button>
              </div>

              {state && (
                <div
                  className="timeline"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    send({
                      type: 'goto',
                      beat: Math.round(((e.clientX - r.left) / r.width) * (state.total - 1)),
                    })
                  }}
                >
                  <div className="track">
                    <div className="fill" style={{ width: `${progress * 100}%` }} />
                  </div>
                  {state.pageStarts.map((i) => (
                    <div
                      key={i}
                      className="tick"
                      style={{ left: `${(i / Math.max(1, state.total - 1)) * 100}%` }}
                    />
                  ))}
                </div>
              )}

              {settings && (
                <div className="card remote-settings">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={settings.subtitles}
                      onChange={(e) => void updateSettings({ subtitles: e.target.checked })}
                    />
                    Titulky na televizi
                  </label>
                  <label className="field">
                    <span>Přiblížení</span>
                    <Segmented
                      value={settings.zoom}
                      onChange={(v) => void updateSettings({ zoom: v })}
                      options={[
                        { value: 'soft', label: 'Jemné' },
                        { value: 'medium', label: 'Střední' },
                        { value: 'strong', label: 'Výrazné' },
                      ]}
                    />
                  </label>
                  {state && state.outputs.length > 0 && (
                    <label className="field">
                      <span>Zvuk přehrávat na</span>
                      <select
                        className="input"
                        value={state.output}
                        onChange={(e) => send({ type: 'output', deviceId: e.target.value })}
                      >
                        <option value="">Výchozí výstup systému</option>
                        {state.outputs.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn" onClick={() => void stop('local')}>
                  <Icon name="expand" /> Pokračovat na počítači
                </button>
                <button className="btn danger" onClick={() => void stop('library')}>
                  <Icon name="close" /> Ukončit přehrávání na televizi
                </button>
              </div>
              <p className="center small faint" style={{ margin: 0 }}>
                <span className="kbd">mezerník</span> pauza · <span className="kbd">← →</span> repliky ·{' '}
                <span className="kbd">↑ ↓</span> strany
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}
