import { useCallback, useEffect, useState } from 'react'
import type { SystemVoiceInfo, VoiceInfo } from '@shared/api'
import { api, errorMessage } from '../api'

interface VoicesState {
  eleven: VoiceInfo[]
  system: SystemVoiceInfo[]
  loading: boolean
  error: string | null
  reload: () => void
}

let cache: { eleven: VoiceInfo[]; system: SystemVoiceInfo[] } | null = null

/** ElevenLabs + system voice lists (cached for the session). */
export function useVoices(enabled: boolean): VoicesState {
  const [state, setState] = useState(() => ({
    ...(cache ?? { eleven: [], system: [] }),
    loading: !cache,
    error: null as string | null,
  }))

  const load = useCallback(
    async (force: boolean) => {
      setState((s) => ({ ...s, loading: true, error: null }))
      const system = await api.voices.listSystem().catch(() => [] as SystemVoiceInfo[])
      let eleven: VoiceInfo[] = []
      let error: string | null = null
      if (enabled) {
        try {
          eleven = await api.voices.listEleven(force)
        } catch (err) {
          error = errorMessage(err)
        }
      }
      cache = { eleven, system }
      setState({ eleven, system, loading: false, error })
    },
    [enabled],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  return { ...state, reload: () => void load(true) }
}
