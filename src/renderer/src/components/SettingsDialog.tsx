import { useState } from 'react'
import type { SecretKind, SettingsView } from '@shared/api'
import { ELEVEN_MODELS, OPENAI_MODELS } from '@shared/defaults'
import { api, errorMessage } from '../api'
import { setSecret, updateSettings, useSettings } from '../hooks/useSettings'
import { useVoices } from '../hooks/useVoices'
import { Icon } from './Icon'
import { Modal, Segmented, useToast } from './ui'

function KeyField({ kind, view }: { kind: SecretKind; view: SettingsView }): React.JSX.Element {
  const toast = useToast()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const source = kind === 'openai' ? view.openaiKey : view.elevenKey
  const label = kind === 'openai' ? 'OpenAI API klíč' : 'ElevenLabs API klíč'
  const link =
    kind === 'openai' ? 'https://platform.openai.com/api-keys' : 'https://elevenlabs.io/app/settings/api-keys'

  const save = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      await setSecret(kind, value)
      setValue('')
      const r = await api.settings.test(kind)
      setResult(r)
      toast(r.ok ? 'Klíč uložen a ověřen' : r.message, r.ok ? 'success' : 'error')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    setResult(await api.settings.test(kind).catch((e) => ({ ok: false, message: errorMessage(e) })))
    setBusy(false)
  }

  return (
    <div className="field">
      <span>{label}</span>
      <div className="row">
        <input
          className="input"
          type="password"
          placeholder={
            source === 'stored'
              ? '•••••••• (uloženo)'
              : source === 'env'
                ? 'načteno z proměnné prostředí'
                : 'Vložte klíč'
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value && void save()}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn primary" disabled={!value || busy} onClick={() => void save()}>
          Uložit
        </button>
        <button className="btn" disabled={!source || busy} onClick={() => void test()}>
          {busy ? <span className="spinner" /> : 'Ověřit'}
        </button>
        {source === 'stored' && (
          <button className="btn ghost icon" title="Smazat klíč" onClick={() => void setSecret(kind, null)}>
            <Icon name="trash" />
          </button>
        )}
      </div>
      <div className="row small">
        {result ? (
          <span style={{ color: result.ok ? 'var(--accent)' : 'var(--danger)' }}>{result.message}</span>
        ) : (
          <span className="faint">
            Klíč získáte na{' '}
            <a href={link} target="_blank" rel="noreferrer">
              {new URL(link).host}
            </a>
            .{' '}
            {view.secureStorage
              ? 'Ukládá se šifrovaně do klíčenky systému.'
              : 'Pozor: systémové šifrování není dostupné.'}
          </span>
        )}
      </div>
    </div>
  )
}

export function SettingsDialog({
  onClose,
}: {
  focus: string
  onClose: () => void
}): React.JSX.Element | null {
  const s = useSettings()
  const voices = useVoices(!!s?.elevenKey)
  if (!s) return null
  const set = (patch: Parameters<typeof updateSettings>[0]): void => void updateSettings(patch)

  return (
    <Modal title="Nastavení" onClose={onClose}>
      {s.mockAi && (
        <div className="banner warn">
          <Icon name="info" /> Běží testovací režim (CTYRLISTEK_MOCK_AI=1) – analýza je simulovaná.
        </div>
      )}

      <section>
        <h3>
          <Icon name="sparkle" /> Analýza komiksu (OpenAI)
        </h3>
        <KeyField kind="openai" view={s} />
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <label className="field grow">
            <span>Model</span>
            <select
              className="input"
              value={s.openaiModel}
              onChange={(e) => set({ openaiModel: e.target.value })}
            >
              {OPENAI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {!OPENAI_MODELS.some((m) => m.id === s.openaiModel) && (
                <option value={s.openaiModel}>{s.openaiModel}</option>
              )}
            </select>
            <small className="faint">
              {OPENAI_MODELS.find((m) => m.id === s.openaiModel)?.hint ?? 'Vlastní model'}
            </small>
          </label>
          <label className="field">
            <span>Důkladnost</span>
            <Segmented
              value={s.openaiEffort}
              onChange={(v) => set({ openaiEffort: v })}
              options={[
                { value: 'low', label: 'Rychlá' },
                { value: 'medium', label: 'Vyvážená' },
                { value: 'high', label: 'Maximální' },
              ]}
            />
          </label>
        </div>
        <label className="field">
          <span>Paralelně analyzovaných stránek: {s.analysisConcurrency}</span>
          <input
            type="range"
            min={1}
            max={6}
            value={s.analysisConcurrency}
            onChange={(e) => set({ analysisConcurrency: Number(e.target.value) })}
          />
        </label>
      </section>

      <section>
        <h3>
          <Icon name="mic" /> Hlasy
        </h3>
        <Segmented
          value={s.voiceMode}
          onChange={(v) => set({ voiceMode: v })}
          options={[
            { value: 'elevenlabs', label: '✨ ElevenLabs (herecké hlasy)' },
            { value: 'system', label: '💻 Systémové hlasy (zdarma, offline)' },
          ]}
        />
        {s.voiceMode === 'elevenlabs' ? (
          <>
            <KeyField kind="elevenlabs" view={s} />
            {voices.error && <div className="banner danger small">{voices.error}</div>}
            <div className="row wrap" style={{ alignItems: 'flex-end' }}>
              <label className="field grow">
                <span>Model hlasu</span>
                <select
                  className="input"
                  value={s.elevenModel}
                  onChange={(e) => set({ elevenModel: e.target.value })}
                >
                  {ELEVEN_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <small className="faint">{ELEVEN_MODELS.find((m) => m.id === s.elevenModel)?.hint}</small>
              </label>
              <label className="field">
                <span>Projev</span>
                <Segmented
                  value={String(s.elevenStability)}
                  onChange={(v) => set({ elevenStability: Number(v) })}
                  options={[
                    { value: '0', label: 'Divadelní' },
                    { value: '0.5', label: 'Přirozený' },
                    { value: '1', label: 'Stabilní' },
                  ]}
                />
              </label>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={s.sfxEnabled}
                onChange={(e) => set({ sfxEnabled: e.target.checked })}
              />
              Zvukové efekty (BUM!, PRÁSK!) generované ElevenLabs
            </label>
            <p className="small faint" style={{ margin: 0 }}>
              Tip: Nejlépe znějí hlasy s ověřenou češtinou. Přidejte si je do účtu z ElevenLabs Voice Library
              a aplikace je při obsazování upřednostní. Dostupných hlasů: {voices.eleven.length}
              {voices.eleven.length > 0 &&
                ` (s češtinou: ${voices.eleven.filter((v) => v.languages.includes('cs')).length})`}
              .
            </p>
          </>
        ) : (
          <label className="field">
            <span>Systémový hlas</span>
            <select
              className="input"
              value={s.systemVoice}
              onChange={(e) => set({ systemVoice: e.target.value })}
            >
              {voices.system.length === 0 && <option value={s.systemVoice}>{s.systemVoice}</option>}
              {voices.system.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <span
              className="small faint"
              style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}
            >
              Kvalitnější českou „Zuzanu (Vylepšená)“ stáhnete v Nastavení systému → Zpřístupnění → Mluvený
              obsah → Systémový hlas → Spravovat hlasy.
            </span>
          </label>
        )}
      </section>

      <section>
        <h3>
          <Icon name="play" /> Přehrávání
        </h3>
        <label className="switch">
          <input
            type="checkbox"
            checked={s.subtitles}
            onChange={(e) => set({ subtitles: e.target.checked })}
          />
          Titulky s textem repliky
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={s.wordHighlight}
            onChange={(e) => set({ wordHighlight: e.target.checked })}
          />
          Zvýrazňovat právě čtené slovo (pomáhá při učení čtení)
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={s.pageIntro}
            onChange={(e) => set({ pageIntro: e.target.checked })}
          />
          Na začátku každé stránky ukázat celou stránku
        </label>
        <label className="field">
          <span>Tempo mezi replikami: {s.pace < 0.9 ? 'rychlé' : s.pace > 1.2 ? 'pomalé' : 'normální'}</span>
          <input
            type="range"
            min={0.6}
            max={1.8}
            step={0.1}
            value={s.pace}
            onChange={(e) => set({ pace: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Hlasitost zvukových efektů: {Math.round(s.sfxVolume * 100)} %</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.sfxVolume}
            onChange={(e) => set({ sfxVolume: Number(e.target.value) })}
          />
        </label>
      </section>

      <section>
        <h3>
          <Icon name="folder" /> Data
        </h3>
        <div className="row">
          <button className="btn" onClick={() => void api.library.reveal(null)}>
            <Icon name="folder" /> Otevřít složku s knihovnou
          </button>
        </div>
      </section>
    </Modal>
  )
}
