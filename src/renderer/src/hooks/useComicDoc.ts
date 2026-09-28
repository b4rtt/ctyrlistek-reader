import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComicDoc } from '@shared/types'
import { api, errorMessage } from '../api'

/**
 * Load a comic document and keep it in React state with debounced autosave.
 * `update` accepts a producer that returns the next document.
 */
export function useComicDoc(id: string): {
  doc: ComicDoc | null
  error: string | null
  update: (fn: (d: ComicDoc) => ComicDoc) => void
  reload: () => Promise<void>
  flush: () => Promise<void>
} {
  const [doc, setDoc] = useState<ComicDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef<ComicDoc | null>(null)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    if (!dirty.current || !latest.current) return
    dirty.current = false
    try {
      await api.library.save(latest.current)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  const reload = useCallback(async () => {
    try {
      const d = await api.library.load(id)
      latest.current = d
      setDoc(d)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [id])

  useEffect(() => {
    void reload()
    return () => {
      void flush()
    }
  }, [reload, flush])

  const update = useCallback(
    (fn: (d: ComicDoc) => ComicDoc) => {
      if (!latest.current) return
      const next = fn(latest.current)
      if (next === latest.current) return
      latest.current = next
      dirty.current = true
      setDoc(next)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 600)
    },
    [flush],
  )

  return { doc, error, update, reload, flush }
}
