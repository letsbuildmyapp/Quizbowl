import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

export function Button({ variant = 'default', size, block, className = '', loading, children, ...rest }) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={loading || rest.disabled} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ to, variant = 'default', size, block, className = '', children, ...rest }) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <Link to={to} className={cls} {...rest}>
      {children}
    </Link>
  );
}

export function Card({ tone, tight, className = '', as: As = 'section', children, ...rest }) {
  const cls = ['card', tone && `card-${tone}`, tight && 'card-tight', className].filter(Boolean).join(' ');
  return (
    <As className={cls} {...rest}>
      {children}
    </As>
  );
}

export function Chip({ tone, children, className = '', ...rest }) {
  return (
    <span className={['chip', tone && `chip-${tone}`, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </span>
  );
}

export function Stat({ value, label, color, hint }) {
  return (
    <div className="stat">
      <span className="stat-value" style={color ? { color } : undefined}>
        {value}
      </span>
      <span className="stat-label">{label}</span>
      {hint ? <span className="caption">{hint}</span> : null}
    </div>
  );
}

export function ProgressBar({ value = 0, max = 100, color, label, height }) {
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label} style={height ? { height } : undefined}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="row-between" style={{ alignItems: 'flex-end', gap: 16 }}>
      <div className="stack" style={{ gap: 6 }}>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="muted prose">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ emoji = '✨', title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-emoji" aria-hidden>
        {emoji}
      </span>
      <h3>{title}</h3>
      {children ? <p className="muted prose">{children}</p> : null}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…', full }) {
  return (
    <div className={full ? 'loading-screen' : 'row'} role="status" aria-live="polite" style={full ? undefined : { padding: 24, justifyContent: 'center' }}>
      <div className="stack" style={{ alignItems: 'center', gap: 12 }}>
        <span className="spinner" aria-hidden />
        <span className="muted">{label}</span>
      </div>
    </div>
  );
}

export function ErrorNote({ error, children }) {
  if (!error && !children) return null;
  return (
    <div className="alert alert-error" role="alert">
      {children || friendlyError(error)}
    </div>
  );
}

export function friendlyError(error) {
  const msg = error?.message || String(error || '');
  if (/permission|insufficient|false for '|Null value error|evaluation error/i.test(msg)) return "You don't have access to that.";
  if (/network|offline|unavailable/i.test(msg)) return 'Connection problem. Check your internet and try again.';
  if (/auth\/(wrong-password|invalid-credential|user-not-found)/.test(msg)) return 'That email and password don’t match.';
  if (/auth\/email-already-in-use/.test(msg)) return 'That email already has an account. Try signing in.';
  if (/auth\/weak-password/.test(msg)) return 'Pick a password with at least 8 characters.';
  if (/auth\/popup-closed/.test(msg)) return 'Sign-in window was closed.';
  return msg.replace(/^Firebase(Error)?:?\s*/i, '') || 'Something went wrong.';
}

export function Field({ label, hint, error, children, id }) {
  const autoId = useId();
  const fieldId = id || autoId;
  const child = typeof children === 'function' ? children(fieldId) : children;
  return (
    <div className="field">
      {label ? <label htmlFor={fieldId}>{label}</label> : null}
      {child}
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return (
          <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const el = ref.current;
    // Prefer the first form field; fall back to the first button or link.
    const focusable = el?.querySelector('input, select, textarea') || el?.querySelector('.modal-footer button, button:not([aria-label="Close"]), [href]');
    (focusable || el)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll('input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="stack-lg">
          <div className="row-between">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          {children}
          {footer ? <div className="row" style={{ justifyContent: 'flex-end' }}>{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** Custom confirm dialog (never window.confirm). */
export function ConfirmModal({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onCancel, busy }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'coral' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeof body === 'string' ? <p className="prose">{body}</p> : body}
    </Modal>
  );
}

export function Avatar({ emoji, size, label }) {
  return (
    <span className={`avatar ${size ? `avatar-${size}` : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {emoji || '🙂'}
    </span>
  );
}

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, { emoji = '✅', ms = 3200 } = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, emoji }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-region" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span aria-hidden>{t.emoji}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/** Horizontal labeled bar row, used for category strengths. */
export function StrengthRow({ label, emoji, value, max = 100, color, suffix = '%', detail }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row-between">
        <span style={{ fontWeight: 800 }}>
          {emoji ? <span aria-hidden>{emoji} </span> : null}
          {label}
        </span>
        <span className="tabular" style={{ fontWeight: 800 }}>
          {value == null ? 'n/a' : `${value}${suffix}`}
          {detail ? <span className="caption"> · {detail}</span> : null}
        </span>
      </div>
      <ProgressBar value={value ?? 0} max={max} color={color} label={label} />
    </div>
  );
}
