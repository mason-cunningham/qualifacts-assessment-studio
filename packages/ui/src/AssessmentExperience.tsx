import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import type { AnswerValue, Answers, AssessmentDefinition, LeadField, LeadValues, Question } from '@qq/schema';
import { canAdvance, computeResults, visibleQuestions, type AssessmentResults } from '@qq/engine';
import { InlineMarkdown, Markdown } from './Markdown';
import { ResultsView } from './ResultsView';
import defaultLogo from '../assets/qualifacts-logo.png';

export type Screen = 'intro' | 'questions' | 'lead' | 'results';

export interface SubmitArgs {
  answers: Answers;
  results: AssessmentResults;
  lead: LeadValues;
  consent: boolean | null;
  honeypot: string;
  startedAt: string | null;
}

export interface AssessmentExperienceProps {
  definition: AssessmentDefinition;
  mode?: 'live' | 'preview';
  /** sessionStorage key to survive refreshes (live only) */
  persistKey?: string;
  narrow?: boolean;
  onStart?: () => void;
  onAnswer?: (questionId: string) => void;
  onLeadFormView?: () => void;
  onSubmit?: (args: SubmitArgs) => Promise<void>;
  onCtaClick?: (label: string, url: string) => void;
  onProductClick?: (productId: string) => void;
  /** Studio preview control: jump to a screen (optionally with answers). Change `nonce` to re-trigger. */
  jumpTo?: { screen: Screen; nonce: number; answers?: Answers; questionId?: string };
  footer?: ReactNode;
}

interface State {
  screen: Screen;
  currentId: string | null;
  answers: Answers;
  lead: LeadValues;
  consent: boolean;
  startedAt: string | null;
  submitted: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const initialState: State = { screen: 'intro', currentId: null, answers: {}, lead: {}, consent: false, startedAt: null, submitted: false };

function loadState(key?: string): State | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? { ...initialState, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

function saveState(key: string | undefined, s: State) {
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* private mode / storage blocked: resume just won't work */
  }
}

export function validateLead(fields: LeadField[], values: LeadValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? '').trim();
    if (f.required && !v) errors[f.key] = 'Required';
    else if (v && f.type === 'email' && !EMAIL_RE.test(v)) errors[f.key] = 'Enter a valid email';
  }
  return errors;
}

export function AssessmentExperience(props: AssessmentExperienceProps) {
  const { definition: def, mode = 'live', persistKey, narrow } = props;
  const [state, setState] = useState<State>(() => (mode === 'live' && loadState(persistKey)) || initialState);
  const [fading, setFading] = useState(false);
  const [leadErrors, setLeadErrors] = useState<Record<string, string>>({});
  const [consentError, setConsentError] = useState(false);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);

  const visible = useMemo(() => visibleQuestions(def, state.answers), [def, state.answers]);
  const results = useMemo(
    () => (state.screen === 'results' ? computeResults(def, state.answers) : null),
    [def, state.answers, state.screen],
  );
  const lc = def.leadCapture;
  const leadFirst = lc.position === 'beforeQuestions' && lc.fields.length > 0;
  const leadLast = lc.position === 'beforeResults' && lc.fields.length > 0;

  useEffect(() => {
    if (mode === 'live') saveState(persistKey, state);
  }, [state, mode, persistKey]);

  // Studio preview: jump to a screen on demand
  useEffect(() => {
    if (!props.jumpTo) return;
    const { screen, answers, questionId } = props.jumpTo;
    setState((s) => {
      const nextAnswers = answers ?? s.answers;
      const vis = visibleQuestions(def, nextAnswers);
      return {
        ...s,
        screen,
        answers: nextAnswers,
        currentId: questionId ?? (screen === 'questions' ? vis[0]?.id ?? null : s.currentId),
        startedAt: s.startedAt ?? new Date().toISOString(),
      };
    });
    submittingRef.current = false;
    setSaveWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.jumpTo?.nonce]);

  // Keep the current question valid when the definition or branching changes
  useEffect(() => {
    if (state.screen !== 'questions') return;
    if (!state.currentId || !visible.some((q) => q.id === state.currentId)) {
      setState((s) => ({ ...s, currentId: visible[0]?.id ?? null }));
    }
  }, [visible, state.screen, state.currentId]);

  const scrollTop = () => {
    if (mode === 'live') window.scrollTo({ top: 0, behavior: 'smooth' });
    else rootRef.current?.closest('[data-qq-scroll]')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const go = (patch: Partial<State>, animate = true) => {
    if (!animate) {
      setState((s) => ({ ...s, ...patch }));
      return;
    }
    setFading(true);
    setTimeout(() => {
      setState((s) => ({ ...s, ...patch }));
      setFading(false);
    }, 180);
  };

  const setAnswer = (qid: string, value: AnswerValue | undefined) => {
    setState((s) => ({ ...s, answers: { ...s.answers, [qid]: value } }));
    props.onAnswer?.(qid);
  };

  const setLead = (key: string, value: string) => {
    setState((s) => ({ ...s, lead: { ...s.lead, [key]: value } }));
    if (leadErrors[key]) setLeadErrors((e) => ({ ...e, [key]: '' }));
  };

  const checkLead = () => {
    const errs = validateLead(lc.fields, state.lead);
    setLeadErrors(errs);
    const consentOk = !lc.consentText || state.consent;
    setConsentError(!consentOk);
    return Object.values(errs).every((e) => !e) && consentOk;
  };

  const start = () => {
    if (leadFirst && !checkLead()) return;
    props.onStart?.();
    const first = visibleQuestions(def, state.answers)[0];
    go({ screen: 'questions', currentId: first?.id ?? null, startedAt: state.startedAt ?? new Date().toISOString() });
    scrollTop();
  };

  const submit = (answers: Answers) => {
    // Guard against double-clicks during the fade transition creating duplicate leads
    if (submittingRef.current) return;
    submittingRef.current = true;
    const r = computeResults(def, answers);
    setSaveWarning(null);
    go({ screen: 'results', submitted: true });
    scrollTop();
    if (!props.onSubmit) return;
    props
      .onSubmit({
        answers,
        results: r,
        lead: state.lead,
        consent: lc.consentText ? state.consent : null,
        honeypot,
        startedAt: state.startedAt,
      })
      .catch((err) => {
        console.warn('Submit failed', err);
        setSaveWarning("Your results couldn't be saved to our system, but the results below are still accurate.");
      });
  };

  const idx = visible.findIndex((q) => q.id === state.currentId);
  const current: Question | undefined = visible[idx];
  const isLast = idx === visible.length - 1;

  const next = () => {
    if (!current || !canAdvance(current, state.answers[current.id])) return;
    // Recompute visibility with the latest answers: branching may have changed what's next
    const vis = visibleQuestions(def, state.answers);
    const pos = vis.findIndex((q) => q.id === current.id);
    const nextQ = vis[pos + 1];
    if (nextQ) {
      go({ currentId: nextQ.id });
      return;
    }
    if (leadLast) {
      props.onLeadFormView?.();
      go({ screen: 'lead' });
      scrollTop();
      return;
    }
    submit(state.answers);
  };

  const back = () => {
    if (idx > 0) go({ currentId: visible[idx - 1].id });
    else go({ screen: 'intro' });
  };

  const retake = () => {
    submittingRef.current = false;
    setState({ ...initialState });
    setLeadErrors({});
    setSaveWarning(null);
    scrollTop();
  };

  const onLeadSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!checkLead()) return;
    submit(state.answers);
  };

  // ── Progress ──
  const sectionsWithVisible = def.sections.filter((s) => visible.some((q) => q.sectionId === s.id));
  const currentSection = current ? def.sections.find((s) => s.id === current.sectionId) : undefined;
  const sectionNo = currentSection ? sectionsWithVisible.findIndex((s) => s.id === currentSection.id) + 1 : 0;
  const answeredCount = visible.filter((q) => canAdvance(q, state.answers[q.id]) && state.answers[q.id]).length;
  const progress = visible.length ? (answeredCount / visible.length) * 100 : 0;

  const logo = def.theme.logoUrl || defaultLogo;
  const finalLabel = leadLast ? 'Continue' : def.results.thankYouOnly || def.scoring.method === 'none' ? 'Submit' : 'See My Results';

  return (
    <div ref={rootRef} className={`qq-root ${narrow ? 'qq-narrow' : ''}`} data-accent={def.theme.accent}>
      <header className="qq-topbar">
        <span className="qq-logo"><img src={logo} alt="Qualifacts" /></span>
        {def.theme.coBrandLogoUrl && <span className="qq-cobrand"><img src={def.theme.coBrandLogoUrl} alt="" /></span>}
      </header>

      {state.screen === 'questions' && current && (
        <div className="qq-progress" aria-hidden="true">
          <div className="qq-progress-meta">
            <span>
              {sectionsWithVisible.length > 1
                ? `Section ${sectionNo} of ${sectionsWithVisible.length}: ${currentSection?.name ?? ''}`
                : currentSection?.name}
            </span>
            <span>{idx + 1} of {visible.length}</span>
          </div>
          <div className="qq-progress-track"><div className="qq-progress-fill" style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      <main className="qq-main">
        <div className={`qq-screen ${state.screen === 'results' ? 'qq-screen-wide' : ''} ${fading ? 'qq-fading' : 'qq-fade-in'}`}>
          {state.screen === 'intro' && (
            <IntroScreen
              def={def}
              leadFirst={leadFirst}
              lead={state.lead}
              leadErrors={leadErrors}
              setLead={setLead}
              consent={state.consent}
              consentError={consentError}
              setConsent={(v) => setState((s) => ({ ...s, consent: v }))}
              honeypot={honeypot}
              setHoneypot={setHoneypot}
              onStart={start}
            />
          )}

          {state.screen === 'questions' && current && (
            <div className="qq-card">
              <div className="qq-section-label">{currentSection?.name}</div>
              <h1 className="qq-question" id={`qq-q-${current.id}`}>
                <InlineMarkdown text={current.text} />
                {!current.required && <span className="qq-optional"> (optional)</span>}
              </h1>
              {current.helpText && <p className="qq-help">{current.helpText}</p>}
              {current.imageUrl && <img className="qq-question-img" src={current.imageUrl} alt="" />}
              <QuestionInput q={current} value={state.answers[current.id]} onChange={(v) => setAnswer(current.id, v)} />
              <div className="qq-nav">
                <button type="button" className="qq-btn qq-btn-ghost" onClick={back}>Back</button>
                <button
                  type="button"
                  className="qq-btn qq-btn-primary"
                  disabled={!canAdvance(current, state.answers[current.id])}
                  onClick={next}
                >
                  {isLast ? finalLabel : 'Continue'} →
                </button>
              </div>
            </div>
          )}

          {state.screen === 'questions' && !current && (
            <div className="qq-card qq-card-center">
              <p className="qq-lede">This assessment has no questions yet.</p>
            </div>
          )}

          {state.screen === 'lead' && (
            <form className="qq-card qq-elevated" onSubmit={onLeadSubmit} noValidate>
              <h1 className="qq-h1" style={{ fontSize: 28 }}>{lc.heading}</h1>
              <Markdown className="qq-lede" text={lc.body} />
              <LeadFields fields={lc.fields} values={state.lead} errors={leadErrors} onChange={setLead} />
              <Consent text={lc.consentText} privacyUrl={lc.privacyUrl} checked={state.consent} error={consentError}
                       onChange={(v) => setState((s) => ({ ...s, consent: v }))} />
              <Honeypot value={honeypot} onChange={setHoneypot} />
              <div className="qq-nav">
                <button type="button" className="qq-btn qq-btn-ghost" onClick={() => go({ screen: 'questions', currentId: visible[visible.length - 1]?.id ?? null })}>
                  Back
                </button>
                <button type="submit" className="qq-btn qq-btn-primary">{lc.submitLabel} →</button>
              </div>
            </form>
          )}

          {state.screen === 'results' && results && (
            <ResultsView
              definition={def}
              results={results}
              lead={state.lead}
              onRetake={retake}
              saveWarning={saveWarning}
              onCtaClick={props.onCtaClick}
              onProductClick={props.onProductClick}
            />
          )}
        </div>
      </main>
      {props.footer}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function IntroScreen(p: {
  def: AssessmentDefinition;
  leadFirst: boolean;
  lead: LeadValues;
  leadErrors: Record<string, string>;
  setLead: (k: string, v: string) => void;
  consent: boolean;
  consentError: boolean;
  setConsent: (v: boolean) => void;
  honeypot: string;
  setHoneypot: (v: string) => void;
  onStart: () => void;
}) {
  const { def } = p;
  const intro = def.intro;
  const lc = def.leadCapture;
  return (
    <div className="qq-card qq-card-center qq-elevated">
      {intro.imageUrl && <img className="qq-hero" src={intro.imageUrl} alt="" />}
      {intro.eyebrow && <div className="qq-badge">{intro.eyebrow}</div>}
      <h1 className="qq-h1">{intro.headline || def.meta.title}</h1>
      {intro.subheadline && <p className="qq-subhead">{intro.subheadline}</p>}
      <Markdown className="qq-lede" text={intro.body} />
      {intro.bullets.length > 0 && (
        <ul className="qq-bullets">{intro.bullets.map((b, i) => <li key={i}><InlineMarkdown text={b} /></li>)}</ul>
      )}
      {p.leadFirst && (
        <div style={{ maxWidth: 420, margin: '0 auto 24px' }}>
          {lc.heading && <div className="qq-field"><label style={{ fontSize: 15 }}>{lc.heading}</label></div>}
          <LeadFields fields={lc.fields} values={p.lead} errors={p.leadErrors} onChange={p.setLead} hideLabelsIfSingle />
          <Markdown className="qq-note" text={lc.body} />
          <Consent text={lc.consentText} privacyUrl={lc.privacyUrl} checked={p.consent} error={p.consentError} onChange={p.setConsent} />
          <Honeypot value={p.honeypot} onChange={p.setHoneypot} />
        </div>
      )}
      <button type="button" className="qq-btn qq-btn-primary" onClick={p.onStart}>
        {intro.startLabel} →
      </button>
      {intro.estimatedMinutes ? (
        <p className="qq-note">
          About {intro.estimatedMinutes} minute{intro.estimatedMinutes === 1 ? '' : 's'} · Instant results
        </p>
      ) : null}
    </div>
  );
}

function LeadFields({ fields, values, errors, onChange, hideLabelsIfSingle }: {
  fields: LeadField[];
  values: LeadValues;
  errors: Record<string, string>;
  onChange: (k: string, v: string) => void;
  hideLabelsIfSingle?: boolean;
}) {
  // Pair first/last name side by side like the legacy forms
  const rows: LeadField[][] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const n = fields[i + 1];
    if (f.key === 'first_name' && n?.key === 'last_name') {
      rows.push([f, n]);
      i++;
    } else rows.push([f]);
  }
  const single = hideLabelsIfSingle && fields.length === 1;
  const autocomplete: Record<string, string> = {
    first_name: 'given-name', last_name: 'family-name', email: 'email', organization: 'organization',
    job_title: 'organization-title', phone: 'tel', state: 'address-level1',
  };
  return (
    <>
      {rows.map((row, ri) => (
        <div key={ri} className={row.length > 1 ? 'qq-fields-row' : undefined}>
          {row.map((f) => {
            const id = `qq-lead-${f.key}`;
            const err = errors[f.key];
            const common = {
              id,
              value: values[f.key] ?? '',
              'aria-invalid': !!err,
              placeholder: f.placeholder,
              onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(f.key, e.target.value),
            };
            return (
              <div className="qq-field" key={f.key}>
                {!single && (
                  <label htmlFor={id}>
                    {f.label} {f.required && <span className="qq-req">*</span>}
                  </label>
                )}
                {f.type === 'select' ? (
                  <select {...common} className={`qq-select ${err ? 'qq-error' : ''}`}>
                    <option value="">Select…</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea {...common} className={`qq-textarea ${err ? 'qq-error' : ''}`} />
                ) : (
                  <input
                    {...common}
                    type={f.type}
                    autoComplete={autocomplete[f.key]}
                    aria-label={single ? f.label : undefined}
                    className={`qq-input ${err ? 'qq-error' : ''}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function Consent({ text, privacyUrl, checked, error, onChange }: {
  text?: string; privacyUrl?: string; checked: boolean; error: boolean; onChange: (v: boolean) => void;
}) {
  if (!text) return null;
  return (
    <label className="qq-consent" style={error ? { color: 'var(--magenta)' } : undefined}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <InlineMarkdown text={text} />
        {privacyUrl && (
          <> <a href={privacyUrl} target="_blank" rel="noopener noreferrer">Privacy policy</a></>
        )}
      </span>
    </label>
  );
}

function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="qq-hp" aria-hidden="true">
      <label>
        Company website
        <input type="text" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export function QuestionInput({ q, value, onChange }: {
  q: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue | undefined) => void;
}) {
  const selected = value?.optionIds ?? [];
  const otherOpt = q.options.find((o) => o.allowOtherText && selected.includes(o.id));

  const otherBox = otherOpt && (
    <div className="qq-other">
      <input
        className="qq-input"
        autoFocus
        placeholder="Please specify"
        aria-label={`${otherOpt.label}: please specify`}
        value={value?.otherText ?? ''}
        onChange={(e) => onChange({ ...value, otherText: e.target.value })}
      />
    </div>
  );

  switch (q.type) {
    case 'single':
    case 'yesno':
      return (
        <>
          <div className="qq-options" role="radiogroup" aria-labelledby={`qq-q-${q.id}`}>
            {q.options.map((o) => (
              <button
                type="button"
                key={o.id}
                role="radio"
                aria-checked={selected.includes(o.id)}
                className="qq-option"
                onClick={() => onChange({ optionIds: [o.id], otherText: o.allowOtherText ? value?.otherText : undefined })}
              >
                <span className="qq-dot" />
                <span>{o.label}</span>
              </button>
            ))}
          </div>
          {otherBox}
        </>
      );
    case 'multi':
      return (
        <>
          <div className="qq-options" role="group" aria-labelledby={`qq-q-${q.id}`}>
            {q.options.map((o) => {
              const on = selected.includes(o.id);
              return (
                <button
                  type="button"
                  key={o.id}
                  role="checkbox"
                  aria-checked={on}
                  className="qq-option"
                  onClick={() => {
                    const ids = on ? selected.filter((x) => x !== o.id) : [...selected, o.id];
                    onChange(ids.length ? { ...value, optionIds: ids } : undefined);
                  }}
                >
                  <span className="qq-dot qq-square" />
                  <span>{o.label}</span>
                </button>
              );
            })}
          </div>
          {otherBox}
        </>
      );
    case 'dropdown':
      return (
        <>
          <div className="qq-options">
            <select
              className="qq-select"
              aria-labelledby={`qq-q-${q.id}`}
              value={selected[0] ?? ''}
              onChange={(e) => onChange(e.target.value ? { optionIds: [e.target.value], otherText: value?.otherText } : undefined)}
            >
              <option value="">Select…</option>
              {q.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          {otherBox}
        </>
      );
    case 'rating': {
      const min = q.scale?.min ?? 1;
      const max = q.scale?.max ?? 5;
      const nums = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
      return (
        <>
          <div className="qq-rating" role="radiogroup" aria-labelledby={`qq-q-${q.id}`}>
            {nums.map((n) => (
              <button type="button" key={n} role="radio" aria-checked={value?.value === n} className="qq-option"
                      onClick={() => onChange({ value: n })}>
                {n}
              </button>
            ))}
          </div>
          <div className="qq-rating-labels">
            <span>{q.scale?.minLabel}</span>
            <span>{q.scale?.maxLabel}</span>
          </div>
        </>
      );
    }
    case 'number':
      return (
        <div className="qq-options">
          <input
            className="qq-input"
            type="number"
            inputMode="decimal"
            aria-labelledby={`qq-q-${q.id}`}
            placeholder={q.placeholder}
            value={value?.value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : { value: Number(e.target.value) })}
          />
        </div>
      );
    case 'text':
      return (
        <div className="qq-options">
          <input className="qq-input" aria-labelledby={`qq-q-${q.id}`} placeholder={q.placeholder}
                 value={value?.text ?? ''} maxLength={500}
                 onChange={(e) => onChange({ text: e.target.value })} />
        </div>
      );
    case 'longtext':
      return (
        <div className="qq-options">
          <textarea className="qq-textarea" aria-labelledby={`qq-q-${q.id}`} placeholder={q.placeholder}
                    value={value?.text ?? ''} maxLength={4000}
                    onChange={(e) => onChange({ text: e.target.value })} />
        </div>
      );
  }
}
