import { useEffect, useRef, useState } from 'react'
import type { DisplayInfo } from '@shared/api'
import { api, errorMessage } from '../api'
import { Icon } from './Icon'
import { Modal, useToast } from './ui'

interface Props {
  comicId: string
  beat: number
  onClose: () => void
  /** The TV window opened – switch this window to the remote control. */
  onStarted: () => void
  /** The TV mirrors the whole screen – just play fullscreen here. */
  onMirror: () => void
}

const isMac = api.platform === 'darwin'

/**
 * "Play on TV": pick the AirPlay/HDMI display, or walk the parent through
 * connecting one. Starts automatically as soon as a TV shows up.
 */
export function TvDialog({ comicId, beat, onClose, onStarted, onMirror }: Props): React.JSX.Element {
  const toast = useToast()
  const [displays, setDisplays] = useState<DisplayInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const known = useRef<Set<number> | null>(null)

  const start = async (d: DisplayInfo): Promise<void> => {
    setBusy(true)
    try {
      await api.tv.open(comicId, d.id, beat)
      onStarted()
    } catch (err) {
      toast(errorMessage(err), 'error')
      setBusy(false)
    }
  }
  const startRef = useRef(start)
  startRef.current = start

  useEffect(() => {
    void api.tv.displays().then((ds) => {
      known.current = new Set(ds.map((d) => d.id))
      setDisplays(ds)
    })
    return api.tv.onDisplays((ds) => {
      setDisplays(ds)
      // A TV was just connected while the guide was open → go.
      const added = ds.filter((d) => !d.internal && !known.current?.has(d.id))
      known.current = new Set(ds.map((d) => d.id))
      if (added.length === 1) void startRef.current(added[0])
    })
  }, [])

  const tvs = (displays ?? []).filter((d) => !d.internal)

  return (
    <Modal title="Přehrát na televizi" onClose={onClose} width={620}>
      {displays === null ? (
        <div className="empty">
          <span className="spinner" style={{ display: 'inline-block' }} />
        </div>
      ) : tvs.length > 0 ? (
        <section>
          <p className="muted" style={{ margin: 0 }}>
            Komiks poběží na televizi přes celou obrazovku a tento počítač se změní na dálkový ovladač.
          </p>
          <div className="tv-list">
            {tvs.map((d) => (
              <button key={d.id} className="tv-choice" onClick={() => void start(d)} disabled={busy}>
                <Icon name="tv" size={28} />
                <span className="grow">
                  <b>{d.label}</b>
                  <small className="muted">
                    {d.width} × {d.height}
                  </small>
                </span>
                {busy ? <span className="spinner" /> : <Icon name="play" />}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section>
          <div className="banner">
            <span className="spinner" />
            <span className="grow">Čekám, až se připojí televize…</span>
          </div>
          {isMac ? (
            <ol className="tv-steps">
              <li>
                Zapněte televizi (Apple TV nebo televizi s <b>AirPlay</b>) – musí být na stejné Wi-Fi jako
                Mac.
              </li>
              <li>
                Na Macu klikněte vpravo nahoře na <b>Ovládací centrum</b> → <b>Zrcadlení obrazovky</b> a
                vyberte televizi.
              </li>
              <li>
                Zvolte <b>„Použít jako samostatný monitor“</b> (ne zrcadlení) – komiks pak poběží jen na
                televizi a Mac bude ovladač.
              </li>
              <li>Hotovo – jakmile se televize objeví, komiks se na ní pustí sám.</li>
            </ol>
          ) : (
            <ol className="tv-steps">
              <li>Připojte televizi kabelem HDMI, nebo bezdrátově (Windows: klávesy Win + K).</li>
              <li>
                Zvolte režim <b>Rozšířit</b> (Win + P), aby byla televize samostatný monitor.
              </li>
              <li>Hotovo – jakmile se televize objeví, komiks se na ní pustí sám.</li>
            </ol>
          )}
          <div className="row wrap">
            <button className="btn" onClick={() => void api.tv.openDisplaySettings()}>
              <Icon name="settings" /> Otevřít nastavení monitorů
            </button>
          </div>
          <div className="card small" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span>
              <b>Televize zrcadlí celou obrazovku Macu?</b> I to funguje – stačí přehrávat na celou obrazovku
              zde.
            </span>
            <div>
              <button className="btn small" onClick={onMirror}>
                <Icon name="expand" size={16} /> Přehrávat na celou obrazovku
              </button>
            </div>
          </div>
          <p className="small faint" style={{ margin: 0 }}>
            Zvuk: po připojení AirPlay macOS obvykle sám přepne zvuk do televize. Jinak ho vyberete na
            ovladači nebo v Ovládacím centru → Zvuk.
          </p>
        </section>
      )}
    </Modal>
  )
}
