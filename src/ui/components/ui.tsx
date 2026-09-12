/** Shared presentational building blocks. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted'

/** Path to a public asset, correct whether hosted at / or under a sub-path. */
export function asset(path: string): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
  return `${base}/${path.replace(/^\//, '')}`
}

/** The outreach seal. One component so the logo appears identically everywhere. */
export function Logo({
  size = 96,
  circular = true,
  className,
}: {
  size?: number
  circular?: boolean
  className?: string
}) {
  return (
    <img
      src={asset(circular ? 'icons/logo-circle.png' : 'icons/logo.png')}
      width={size}
      height={size}
      alt="Nichodemus Ugbor Memorial Community Health Outreach"
      className={className}
      style={{
        display: 'block',
        borderRadius: circular ? '50%' : 8,
        background: '#fff',
        flex: 'none',
      }}
    />
  )
}

/** Status is never colour alone: every tone carries a glyph and a word. */
export const TONE_GLYPH: Record<Tone, string> = {
  ok: '✓',
  warn: '!',
  danger: '▲',
  info: 'i',
  muted: '–',
}

export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: Tone
  children: ReactNode
}) {
  return (
    <span className={`badge ${tone}`}>
      <span className="glyph" aria-hidden="true">
        {TONE_GLYPH[tone]}
      </span>
      {children}
    </span>
  )
}

export function AlertBox({
  tone,
  title,
  children,
}: {
  tone: Tone
  title: string
  children?: ReactNode
}) {
  return (
    <div className={`alert ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="glyph" aria-hidden="true">
        {TONE_GLYPH[tone]}
      </span>
      <div className="body">
        <div className="title">{title}</div>
        {children ? <div className="text">{children}</div> : null}
      </div>
    </div>
  )
}

export function Stat({
  label,
  value,
  foot,
  tone,
  big,
}: {
  label: string
  value: ReactNode
  foot?: ReactNode
  tone?: 'ok' | 'warn' | 'danger'
  big?: boolean
}) {
  return (
    <div className={`stat ${tone ?? ''} ${big ? 'big' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  )
}

export function Card({
  title,
  children,
  tight,
  flush,
  action,
}: {
  title?: string
  children: ReactNode
  tight?: boolean
  flush?: boolean
  action?: ReactNode
}) {
  return (
    <section className={`card ${tight ? 'tight' : ''} ${flush ? 'flush' : ''}`}>
      {title || action ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {title ? <h2 className="card-title" style={{ flex: 1 }}>{title}</h2> : <span style={{ flex: 1 }} />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function EmptyState({
  glyph = '·',
  title,
  children,
}: {
  glyph?: string
  title: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="glyph" aria-hidden="true">
        {glyph}
      </span>
      <div style={{ fontWeight: 700, color: 'var(--ink-2)' }}>{title}</div>
      {children ? <div style={{ fontSize: 13.5, marginTop: 6 }}>{children}</div> : null}
    </div>
  )
}

// ----------------------------------------------------------------- form

export function Field({
  label,
  required,
  error,
  help,
  children,
}: {
  label: string
  required?: boolean
  error?: string | null
  help?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className={`field ${error ? 'invalid' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required ? <span className="req"> *</span> : null}
      </label>
      {children(id)}
      {help && !error ? <div className="hint">{help}</div> : null}
      {error ? (
        <div className="field-error" role="alert">
          <span aria-hidden="true">▲</span>
          {error}
        </div>
      ) : null}
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  required,
  error,
  help,
  type = 'text',
  placeholder,
  inputMode,
  maxLength,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  error?: string | null
  help?: string
  type?: string
  placeholder?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'search'
  maxLength?: number
  autoFocus?: boolean
}) {
  return (
    <Field label={label} required={required} error={error} help={help}>
      {(id) => (
        <input
          id={id}
          type={type}
          value={value}
          inputMode={inputMode}
          maxLength={maxLength}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}

export function TextArea({
  label,
  value,
  onChange,
  help,
  error,
  rows,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  help?: string
  error?: string | null
  rows?: number
}) {
  return (
    <Field label={label} error={error} help={help}>
      {(id) => (
        <textarea id={id} value={value} rows={rows} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  error,
  help,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  required?: boolean
  error?: string | null
  help?: string
  placeholder?: string
}) {
  return (
    <Field label={label} required={required} error={error} help={help}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

/** Large tap-target radio group. */
export function ChoiceGroup({
  label,
  value,
  onChange,
  options,
  required,
  error,
  help,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  required?: boolean
  error?: string | null
  help?: string
}) {
  return (
    <div className={`field ${error ? 'invalid' : ''}`}>
      <div className="field-label">
        {label}
        {required ? <span className="req"> *</span> : null}
      </div>
      <div className="choices" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="choice"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {help && !error ? <div className="hint">{help}</div> : null}
      {error ? (
        <div className="field-error" role="alert">
          <span aria-hidden="true">▲</span>
          {error}
        </div>
      ) : null}
    </div>
  )
}

export function Toggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string
  help?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="switch-row">
      <div style={{ flex: 1 }}>
        <div className="switch-label">{label}</div>
        {help ? <div className="switch-help">{help}</div> : null}
      </div>
      <button
        type="button"
        className="choice"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
      >
        {checked ? 'Yes' : 'No'}
      </button>
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  required,
  error,
  help,
  unit,
  step,
  placeholder,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  error?: string | null
  help?: string
  unit?: string
  step?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <Field
      label={unit ? `${label} (${unit})` : label}
      required={required}
      error={error}
      help={help}
    >
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step ?? 'any'}
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}

// ---------------------------------------------------------------- modal

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        style={wide ? { maxWidth: 760 } : undefined}
      >
        <h2>{title}</h2>
        {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div style={{ fontSize: 15, marginBottom: 18 }}>{message}</div>
      {destructive ? (
        <AlertBox tone="danger" title="This action cannot be easily reversed.">
          Please be sure before continuing.
        </AlertBox>
      ) : null}
      <div className="btn-row">
        <button type="button" className="btn secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${destructive ? 'danger' : ''}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; badge?: number }[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.badge !== undefined && t.badge > 0 ? ` (${t.badge})` : ''}
        </button>
      ))}
    </div>
  )
}

export function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  )
}

export function ListRow({
  primary,
  secondary,
  leading,
  trailing,
  onClick,
}: {
  primary: ReactNode
  secondary?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className="list-item" onClick={onClick} type={onClick ? 'button' : undefined}>
      {leading}
      <span className="grow">
        <span className="primary">{primary}</span>
        {secondary ? <span className="secondary" style={{ display: 'block' }}>{secondary}</span> : null}
      </span>
      {trailing}
      {onClick ? (
        <span className="chevron" aria-hidden="true">
          ›
        </span>
      ) : null}
    </Tag>
  )
}

export function NotImplemented({ what }: { what: string }) {
  return <div className="not-implemented">NOT IMPLEMENTED — {what}</div>
}

// --------------------------------------------------------------- toasts

interface Toast {
  id: number
  tone: Tone
  message: string
}

const ToastContext = createContext<{
  push: (tone: Tone, message: string) => void
}>({ push: () => undefined })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const push = useCallback((tone: Tone, message: string) => {
    const id = ++counter.current
    // Keep at most two on screen: a taller stack buries the clinical alert
    // the user actually needs to read.
    setToasts((t) => [...t, { id, tone, message }].slice(-2))
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        // Anchored to the top: modals are bottom sheets, so a bottom-anchored
        // toast would sit on top of whatever the clinician is reading.
        style={{
          position: 'fixed',
          left: 12,
          right: 12,
          top: 'calc(10px + env(safe-area-inset-top, 0px))',
          zIndex: 200,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`alert ${t.tone}`}
            style={{ boxShadow: 'var(--shadow-lg)', marginBottom: 8 }}
          >
            <span className="glyph" aria-hidden="true">
              {TONE_GLYPH[t.tone]}
            </span>
            <div className="body">
              <div className="text">{t.message}</div>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext).push
}

/** Renders an error in plain language rather than a database message. */
export function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    const raw = err.message
    if (/^SQLITE|constraint failed|no such (table|column)/i.test(raw)) {
      return `${fallback} Your information has not been lost. Please try again.`
    }
    return raw
  }
  return `${fallback} Your information has not been lost. Please try again.`
}
