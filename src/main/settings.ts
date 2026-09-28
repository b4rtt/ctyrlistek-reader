/**
 * Persistent settings (plain JSON) and API keys (encrypted with the OS keychain
 * via Electron `safeStorage` whenever it is available).
 *
 * Keys can also come from the environment (`OPENAI_API_KEY`,
 * `ELEVENLABS_API_KEY`) – handy for development; a stored key wins.
 */
import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SecretKind, Settings, SettingsView } from '@shared/api'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { secretsFile, settingsFile } from './paths'

let cache: Settings | null = null

function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null
  } catch {
    return null
  }
}

export function getSettings(): Settings {
  if (!cache) cache = { ...DEFAULT_SETTINGS, ...(readJson<Partial<Settings>>(settingsFile()) ?? {}) }
  return cache
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings() }
  for (const [k, v] of Object.entries(patch) as [keyof Settings, unknown][]) {
    if (k in DEFAULT_SETTINGS && v !== undefined && typeof v === typeof DEFAULT_SETTINGS[k]) {
      ;(next as unknown as Record<string, unknown>)[k] = v
    }
  }
  next.analysisConcurrency = Math.round(Math.min(6, Math.max(1, next.analysisConcurrency)))
  next.elevenConcurrency = Math.round(Math.min(5, Math.max(1, next.elevenConcurrency)))
  next.pace = Math.min(2, Math.max(0.5, next.pace))
  next.sfxVolume = Math.min(1, Math.max(0, next.sfxVolume))
  cache = next
  writeJsonAtomic(settingsFile(), next)
  return next
}

// ----------------------------------------------------------------- secrets --

interface SecretsFile {
  encrypted: boolean
  values: Partial<Record<SecretKind, string>>
}

const ENV: Record<SecretKind, string> = {
  openai: 'OPENAI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function storedSecret(kind: SecretKind): string | null {
  const file = readJson<SecretsFile>(secretsFile())
  const raw = file?.values[kind]
  if (!raw) return null
  if (!file.encrypted) return raw
  try {
    return safeStorage.decryptString(Buffer.from(raw, 'base64'))
  } catch {
    return null
  }
}

export function getSecret(kind: SecretKind): string | null {
  return storedSecret(kind) ?? (process.env[ENV[kind]]?.trim() || null)
}

export function setSecret(kind: SecretKind, value: string | null): void {
  const encrypted = canEncrypt()
  const current = readJson<SecretsFile>(secretsFile())
  // Re-read existing values in plain form so we can re-save them consistently.
  const plain: Partial<Record<SecretKind, string>> = {}
  for (const k of Object.keys(ENV) as SecretKind[]) {
    const v = current ? storedSecret(k) : null
    if (v) plain[k] = v
  }
  if (value && value.trim()) plain[kind] = value.trim()
  else delete plain[kind]

  const values: Partial<Record<SecretKind, string>> = {}
  for (const [k, v] of Object.entries(plain) as [SecretKind, string][]) {
    values[k] = encrypted ? safeStorage.encryptString(v).toString('base64') : v
  }
  writeJsonAtomic(secretsFile(), { encrypted, values } satisfies SecretsFile)
}

export function isMockAi(): boolean {
  return process.env.CTYRLISTEK_MOCK_AI === '1'
}

export function settingsView(): SettingsView {
  const source = (kind: SecretKind): SettingsView['openaiKey'] =>
    storedSecret(kind) ? 'stored' : process.env[ENV[kind]]?.trim() ? 'env' : null
  return {
    ...getSettings(),
    openaiKey: source('openai'),
    elevenKey: source('elevenlabs'),
    secureStorage: canEncrypt(),
    mockAi: isMockAi(),
  }
}
