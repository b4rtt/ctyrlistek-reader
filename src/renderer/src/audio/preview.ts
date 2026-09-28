/** One-shot audio preview (voice samples in the review/editor screens). */
import type { AudioRef } from '@shared/types'
import { PREVIEW_ID, assetUrl } from '../api'

let current: HTMLAudioElement | null = null

export function audioUrl(comicId: string | null, ref: AudioRef): string {
  return assetUrl(comicId ?? PREVIEW_ID, ref.file)
}

export function stopPreview(): void {
  current?.pause()
  current = null
  window.speechSynthesis?.cancel()
}

export function playPreview(comicId: string | null, ref: AudioRef): Promise<void> {
  stopPreview()
  const audio = new Audio(audioUrl(comicId, ref))
  current = audio
  return new Promise((resolve) => {
    audio.onended = () => resolve()
    audio.onerror = () => resolve()
    void audio.play().catch(() => resolve())
  })
}

/** Web Speech fallback for platforms without file-based system TTS. */
export function speakWeb(text: string, opts: { pitch?: number; rate?: number; volume?: number } = {}): Promise<void> {
  stopPreview()
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    if (!synth) return resolve()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'cs-CZ'
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('cs'))
    if (voice) u.voice = voice
    u.pitch = opts.pitch ?? 1
    u.rate = opts.rate ?? 1
    u.volume = opts.volume ?? 1
    u.onend = () => resolve()
    u.onerror = () => resolve()
    synth.speak(u)
  })
}
