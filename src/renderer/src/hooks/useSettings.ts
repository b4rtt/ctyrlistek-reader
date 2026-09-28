import { useEffect, useSyncExternalStore } from 'react'
import type { SecretKind, Settings, SettingsView } from '@shared/api'
import { api } from '../api'

/** Global settings store shared by all screens. */
let current: SettingsView | null = null
const listeners = new Set<() => void>()
let loading: Promise<SettingsView> | null = null

function emit(next: SettingsView): SettingsView {
  current = next
  for (const l of listeners) l()
  return next
}

export function loadSettings(): Promise<SettingsView> {
  loading ??= api.settings.get().then(emit)
  return loading
}

export async function updateSettings(patch: Partial<Settings>): Promise<SettingsView> {
  return emit(await api.settings.update(patch))
}

export async function setSecret(kind: SecretKind, value: string | null): Promise<SettingsView> {
  return emit(await api.settings.setSecret(kind, value))
}

export function getSettingsSnapshot(): SettingsView | null {
  return current
}

export function useSettings(): SettingsView | null {
  const value = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
  useEffect(() => {
    void loadSettings()
  }, [])
  return value
}
