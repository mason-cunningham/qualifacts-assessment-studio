import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { BRAND_COLORS } from '@qq/schema';
import { errorMessage, uploadAsset } from '../lib/supabase';
import { TEAM_OPTIONS, type AssessmentStatus, type Team } from '../lib/types';

// ── Toasts ──────────────────────────────────────────────────────────────────
interface Toast { id: number; text: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    ok: (text: string) => push(text, 'ok'),
    error: (e: unknown) => push(errorMessage(e), 'error'),
  };
}

// ── Modal ───────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ── Form helpers ────────────────────────────────────────────────────────────
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function TextInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string | undefined | null; onChange: (v: string) => void;
}) {
  return <input className="input" {...rest} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

export function TextArea({ value, onChange, rows = 3, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string | undefined | null; onChange: (v: string) => void;
}) {
  return <textarea className="textarea" rows={rows} {...rest} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

export function NumberInput({ value, onChange, className = 'input input-num', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | undefined | null; onChange: (v: number | undefined) => void;
}) {
  return (
    <input
      type="number"
      className={className}
      {...rest}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function TeamSelect({ value, onChange, id, className = 'select', placeholder = 'Select your team…' }: {
  value: Team | null | undefined; onChange: (v: Team | null) => void; id?: string; className?: string; placeholder?: string;
}) {
  return (
    <select id={id} className={className} value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as Team | null)}>
      <option value="">{placeholder}</option>
      {TEAM_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
    </select>
  );
}

export const TIER_COLORS = [BRAND_COLORS.teal, BRAND_COLORS.amber, BRAND_COLORS.magenta, BRAND_COLORS.magentaDark, BRAND_COLORS.navy, BRAND_COLORS.tealDark, BRAND_COLORS.grey];

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="color-swatches" role="radiogroup">
      {TIER_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          role="radio"
          aria-checked={value.toLowerCase() === c.toLowerCase()}
          aria-label={c}
          className={`swatch ${value.toLowerCase() === c.toLowerCase() ? 'on' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: AssessmentStatus }) {
  const label = { draft: 'Draft', published: 'Live', paused: 'Paused', archived: 'Archived' }[status];
  return (
    <span className={`pill pill-${status}`}>
      {status === 'published' && <span className="dot-live" />}
      {label}
    </span>
  );
}

/** URL field with an Upload button that stores the file in the q-quiz-assets bucket. */
export function ImageField({ label, value, onChange, folder, hint }: {
  label: string; value?: string; onChange: (url: string | undefined) => void; folder: string; hint?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Field label={label} hint={hint}>
      <div className="row">
        <input className="input" placeholder="https://…" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => ref.current?.click()}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        {value && <button type="button" className="btn btn-ghost" onClick={() => onChange(undefined)}>Remove</button>}
        <input
          ref={ref}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (f.size > 10 * 1024 * 1024) return toast.error('Images must be under 10 MB.');
            setBusy(true);
            try {
              onChange(await uploadAsset(f, folder));
              toast.ok('Image uploaded');
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {value && <img src={value} alt="" style={{ maxHeight: 80, maxWidth: 240, marginTop: 6, borderRadius: 4, border: '1px solid var(--border)' }} />}
    </Field>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty">{label}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="card error-text">{errorMessage(error)}</div>;
}
