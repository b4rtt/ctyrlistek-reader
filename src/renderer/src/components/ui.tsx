import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

// ------------------------------------------------------------------ modal --

export function Modal({
  title,
  onClose,
  children,
  width,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  width?: number
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
      >
        <header>
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Zavřít">
            <Icon name="close" />
          </button>
        </header>
        <div className="body">{children}</div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ toast --

type ToastKind = 'info' | 'error' | 'success'
interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq.current
    setItems((xs) => [...xs.slice(-3), { id, kind, text }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === 'error' ? 'warn' : t.kind === 'success' ? 'check' : 'info'} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = (): ((text: string, kind?: ToastKind) => void) => useContext(ToastCtx)

// --------------------------------------------------------------- progress --

export function Progress({
  value,
  indeterminate,
}: {
  value: number
  indeterminate?: boolean
}): React.JSX.Element {
  return (
    <div className={`progress ${indeterminate ? 'indeterminate' : ''}`}>
      <i style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  attention,
}: {
  value: T
  options: { value: T; label: ReactNode; className?: string }[]
  onChange: (v: T) => void
  attention?: boolean
}): React.JSX.Element {
  return (
    <div className={`seg ${attention ? 'attention' : ''}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`${o.value === value ? 'on' : ''} ${o.className ?? ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
