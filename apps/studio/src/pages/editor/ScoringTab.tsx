import { useMemo } from 'react';
import { isChoiceType, newId, type InsightWhen, type Tier } from '@qq/schema';
import { computeResults, orderedQuestions } from '@qq/engine';
import { ColorPicker, Field, NumberInput, TextArea, TextInput } from '../../components/ui';
import { move, sampleAnswers, type EditorProps } from './helpers';
import { TierCopyButton } from '../../components/AiHelpers';

export function ScoringTab({ def, update, readOnly }: EditorProps) {
  const s = def.scoring;
  const scored = orderedQuestions(def).filter((q) => q.role === 'scored');
  const range = useMemo(() => {
    if (s.method === 'none') return null;
    const best = computeResults(def, sampleAnswers(def, 'best'));
    const worst = computeResults(def, sampleAnswers(def, 'worst'));
    return { best, worst };
  }, [def, s.method]);

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="card">
        <div className="card-title">Scoring method</div>
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          {([
            ['points', 'Points', 'Each answer is worth points. Score = points earned ÷ points possible. (Eligibility, CES)'],
            ['gaps', 'Gap flags', 'Answers are "on track" or "gap". Score = % of questions on track. (InSync Operational)'],
            ['none', 'No score (survey)', 'Collect answers only and show a thank-you message. (Payment Posting)'],
          ] as const).map(([k, label, help]) => (
            <label key={k} className="check" style={{ alignItems: 'flex-start' }}>
              <input type="radio" name="method" checked={s.method === k} onChange={() => update((d) => {
                d.scoring.method = k;
                d.results.thankYouOnly = k === 'none';
              })} />
              <span><b>{label}</b><br /><span className="small muted">{help}</span></span>
            </label>
          ))}
        </div>
        {s.method !== 'none' && (
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <Field label="Overall score" hint="Weighted sections lets some areas count more.">
              <select className="select" value={s.overall} onChange={(e) => update((d) => { d.scoring.overall = e.target.value as typeof s.overall; })}>
                <option value="allQuestions">All questions equally</option>
                <option value="weightedSections">Weighted by section</option>
              </select>
            </Field>
            <Field label="Show score as">
              <select className="select" value={s.display} onChange={(e) => update((d) => { d.scoring.display = e.target.value as typeof s.display; })}>
                <option value="percent">Percent (72%)</option>
                <option value="points">Points (41 of 60)</option>
              </select>
            </Field>
            <Field label="Tiers are based on">
              <select className="select" value={s.tierBasis} onChange={(e) => update((d) => { d.scoring.tierBasis = e.target.value as typeof s.tierBasis; })}>
                <option value="percent">Percent (0–100)</option>
                <option value="points">Raw points</option>
              </select>
            </Field>
          </div>
        )}
        {range && (
          <p className="small muted" style={{ margin: 0 }}>
            Possible range: <b>{s.tierBasis === 'points' ? range.worst.points : `${range.worst.pct ?? 0}%`}</b> (worst answers) to{' '}
            <b>{s.tierBasis === 'points' ? range.best.points : `${range.best.pct ?? 0}%`}</b> (best answers) ·{' '}
            {range.worst.tier?.label ?? '—'} → {range.best.tier?.label ?? '—'}
          </p>
        )}
      </div>

      {s.method !== 'none' && s.overall === 'weightedSections' && (
        <div className="card">
          <div className="card-title">Section weights</div>
          <div className="grid grid-3">
            {def.sections.map((sec, i) => (
              <Field key={sec.id} label={sec.name}>
                <NumberInput min={0} step={0.5} value={sec.weight} onChange={(v) => update((d) => { d.sections[i].weight = v ?? 1; })} />
              </Field>
            ))}
          </div>
        </div>
      )}

      {s.method !== 'none' && (
        <div className="card">
          <div className="card-title">{s.method === 'points' ? 'Points per answer' : 'Gap flags per answer'}</div>
          <div className="card-sub">Quick grid for every scored question. You can also edit these on each question.</div>
          {scored.length === 0 && <p className="muted">No scored questions yet.</p>}
          <div className="stack" style={{ gap: 10 }}>
            {scored.map((q) => {
              if (!isChoiceType(q.type)) {
                return (
                  <div key={q.id} className="small muted">
                    <b style={{ color: 'var(--navy)' }}>{q.shortLabel || q.text}</b>: {q.type === 'rating' ? `rating scale scored ${0}–${(q.scale?.max ?? 5) - (q.scale?.min ?? 1)} points` : 'not scored'}
                  </div>
                );
              }
              return (
                <div key={q.id} className="hairline-bottom" style={{ paddingBottom: 12 }}>
                  <div className="row-between">
                    <b style={{ color: 'var(--navy)', fontSize: 13 }}>{q.shortLabel || q.text}</b>
                    <label className="check small">Weight <NumberInput className="input input-sm input-num" min={0} step={0.5} value={q.weight}
                      onChange={(v) => update((d) => { d.questions.find((x) => x.id === q.id)!.weight = v ?? 1; })} /></label>
                  </div>
                  <div className="grid grid-2" style={{ gap: 6, marginTop: 6 }}>
                    {q.options.map((o) => (
                      <div key={o.id} className="row small" style={{ gap: 8 }}>
                        {s.method === 'points' ? (
                          <NumberInput className="input input-sm input-num" value={o.points} disabled={!!o.notApplicable}
                            onChange={(v) => update((d) => { d.questions.find((x) => x.id === q.id)!.options.find((x) => x.id === o.id)!.points = v; })} />
                        ) : (
                          <input type="checkbox" checked={!!o.isGap} disabled={!!o.notApplicable} aria-label="Gap"
                            onChange={(e) => update((d) => { d.questions.find((x) => x.id === q.id)!.options.find((x) => x.id === o.id)!.isGap = e.target.checked || undefined; })} />
                        )}
                        <span style={{ color: o.notApplicable ? 'var(--grey)' : undefined }}>{o.label || '(blank)'}{o.notApplicable ? ' (N/A)' : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {s.method !== 'none' && (
        <>
          {!readOnly && (
            <div className="row-between" style={{ marginTop: 16 }}>
              <span className="small muted">Let AI draft the summary and guidance copy for each tier from your sections and solutions.</span>
              <TierCopyButton def={def} update={update} />
            </div>
          )}
          <TierEditor
            title="Overall score tiers"
            sub={`A score lands in the tier with the highest minimum it meets. Based on ${s.tierBasis === 'points' ? 'raw points' : 'percent'}.`}
            tiers={s.tiers}
            withBody
            onChange={(fn) => update((d) => fn(d.scoring.tiers))}
            scaleMax={s.tierBasis === 'points' ? range?.best.max || 100 : 100}
          />
          <TierEditor
            title="Section tiers"
            sub="Labels and colors for each section's bar on the results page (always based on section percent)."
            tiers={s.sectionTiers}
            withBody
            bodyLabel="Interpretation shown under the bar"
            onChange={(fn) => update((d) => fn(d.scoring.sectionTiers))}
            scaleMax={100}
          />
          <InsightsEditor {...{ def, update, readOnly }} />
        </>
      )}
    </fieldset>
  );
}

function TierEditor({ title, sub, tiers, onChange, withBody, bodyLabel = 'Guidance paragraph (optional)', scaleMax }: {
  title: string; sub: string; tiers: Tier[]; onChange: (fn: (t: Tier[]) => void) => void; withBody?: boolean; bodyLabel?: string; scaleMax: number;
}) {
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="card-sub">{sub}</div>
      {sorted.length > 0 && (
        <div className="tier-bar" aria-hidden="true">
          {sorted.map((t, i) => {
            const next = sorted[i + 1];
            const width = Math.max(4, (((next ? next.min : scaleMax) - t.min) / (scaleMax || 1)) * 100);
            return <div key={t.id} style={{ width: `${width}%`, background: t.color }}>{t.label}</div>;
          })}
        </div>
      )}
      {tiers.map((t, i) => (
        <div key={t.id} className="tier-row">
          <Field label="From"><NumberInput className="input input-sm" value={t.min} onChange={(v) => onChange((ts) => { ts[i].min = v ?? 0; })} /></Field>
          <Field label="To"><NumberInput className="input input-sm" value={t.max} onChange={(v) => onChange((ts) => { ts[i].max = v ?? 0; })} /></Field>
          <div>
            <Field label="Label"><TextInput value={t.label} onChange={(v) => onChange((ts) => { ts[i].label = v; })} /></Field>
            <Field label="Color"><ColorPicker value={t.color} onChange={(v) => onChange((ts) => { ts[i].color = v; })} /></Field>
            {withBody && title.startsWith('Overall') && (
              <Field label="Summary (under the tier name)"><TextArea rows={2} value={t.summary} onChange={(v) => onChange((ts) => { ts[i].summary = v || undefined; })} /></Field>
            )}
            {withBody && (
              <Field label={bodyLabel} hint="Markdown + merge tags like {{score}}, {{weakestSection}}"><TextArea rows={2} value={t.body} onChange={(v) => onChange((ts) => { ts[i].body = v || undefined; })} /></Field>
            )}
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange((ts) => move(ts, i, -1))}>↑</button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange((ts) => move(ts, i, 1))}>↓</button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange((ts) => { ts.splice(i, 1); })}>✕</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }}
        onClick={() => onChange((ts) => { ts.push({ id: newId('t'), min: 0, max: 0, label: 'New tier', color: '#00B2A9' }); })}>
        + Add tier
      </button>
    </div>
  );
}

const INSIGHT_TYPES: Record<InsightWhen['type'], string> = {
  sectionsBelowCount: 'At least N sections score below X%',
  weakestInclude: 'These sections are among the N weakest',
  overallBetween: 'Overall score is between',
  optionSelected: 'A specific answer was chosen',
  always: 'Always (fallback)',
};

function defaultWhen(type: InsightWhen['type'], def: EditorProps['def']): InsightWhen {
  switch (type) {
    case 'sectionsBelowCount': return { type, pct: 60, atLeast: 2 };
    case 'weakestInclude': return { type, sectionIds: def.sections.slice(0, 1).map((s) => s.id), topN: 3 };
    case 'overallBetween': return { type, min: 0, max: 50 };
    case 'optionSelected': {
      const q = def.questions.find((x) => isChoiceType(x.type));
      return { type, questionId: q?.id ?? '', optionIds: [] };
    }
    default: return { type: 'always' };
  }
}

function InsightsEditor({ def, update }: EditorProps) {
  return (
    <div className="card">
      <div className="card-title">Guidance rules ("Where to focus")</div>
      <div className="card-sub">
        Conditional paragraphs on the results page. The <b>first</b> rule that matches is shown, so put specific rules above an "Always" fallback.
      </div>
      {def.insights.map((ins, i) => {
        const w = ins.when;
        const set = (fn: (x: typeof ins) => void) => update((d) => fn(d.insights[i]));
        return (
          <div key={ins.id} className="rule-box" style={{ marginBottom: 10 }}>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <b className="small" style={{ color: 'var(--teal-dk)' }}>#{i + 1}</b>
              <input className="input input-sm" style={{ flex: 1, minWidth: 140 }} placeholder="Internal label" value={ins.label ?? ''} onChange={(e) => set((x) => { x.label = e.target.value || undefined; })} />
              <select className="select input-sm" style={{ flex: 2, minWidth: 220 }} value={w.type} onChange={(e) => set((x) => { x.when = defaultWhen(e.target.value as InsightWhen['type'], def); })}>
                {Object.entries(INSIGHT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => update((d) => move(d.insights, i, -1))}>↑</button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => update((d) => move(d.insights, i, 1))}>↓</button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => update((d) => { d.insights.splice(i, 1); })}>✕</button>
            </div>
            <div className="row small" style={{ flexWrap: 'wrap', margin: '8px 0' }}>
              {w.type === 'sectionsBelowCount' && (
                <>At least <NumberInput className="input input-sm input-num" value={w.atLeast} onChange={(v) => set((x) => { (x.when as typeof w).atLeast = v ?? 1; })} />
                  sections below <NumberInput className="input input-sm input-num" value={w.pct} onChange={(v) => set((x) => { (x.when as typeof w).pct = v ?? 60; })} />%</>
              )}
              {w.type === 'weakestInclude' && (
                <>
                  All of
                  {def.sections.map((sec) => (
                    <label key={sec.id} className="check small">
                      <input type="checkbox" checked={w.sectionIds.includes(sec.id)} onChange={(e) => set((x) => {
                        const ww = x.when as typeof w;
                        ww.sectionIds = e.target.checked ? [...ww.sectionIds, sec.id] : ww.sectionIds.filter((id) => id !== sec.id);
                      })} />{sec.name}
                    </label>
                  ))}
                  are in the weakest <NumberInput className="input input-sm input-num" value={w.topN} onChange={(v) => set((x) => { (x.when as typeof w).topN = v ?? 3; })} /> sections
                </>
              )}
              {w.type === 'overallBetween' && (
                <>Score from <NumberInput className="input input-sm input-num" value={w.min} onChange={(v) => set((x) => { (x.when as typeof w).min = v ?? 0; })} />
                  to <NumberInput className="input input-sm input-num" value={w.max} onChange={(v) => set((x) => { (x.when as typeof w).max = v ?? 100; })} /></>
              )}
              {w.type === 'optionSelected' && (() => {
                const q = def.questions.find((x) => x.id === w.questionId);
                return (
                  <>
                    <select className="select input-sm" style={{ width: 'auto', maxWidth: 320 }} value={w.questionId} onChange={(e) => set((x) => { x.when = { type: 'optionSelected', questionId: e.target.value, optionIds: [] }; })}>
                      {def.questions.filter((x) => isChoiceType(x.type)).map((x) => <option key={x.id} value={x.id}>{x.shortLabel || x.text.slice(0, 60)}</option>)}
                    </select>
                    is
                    {q?.options.map((o) => (
                      <label key={o.id} className="check small">
                        <input type="checkbox" checked={w.optionIds.includes(o.id)} onChange={(e) => set((x) => {
                          const ww = x.when as typeof w;
                          ww.optionIds = e.target.checked ? [...ww.optionIds, o.id] : ww.optionIds.filter((id) => id !== o.id);
                        })} />{o.label}
                      </label>
                    ))}
                  </>
                );
              })()}
              {w.type === 'always' && <span className="muted">Matches whenever no rule above it does.</span>}
            </div>
            <TextArea rows={3} value={ins.body} placeholder="Guidance text. Markdown + merge tags, e.g. Your biggest gap is **{{weakestSection}}**." onChange={(v) => set((x) => { x.body = v; })} />
          </div>
        );
      })}
      <button type="button" className="btn btn-secondary btn-sm"
        onClick={() => update((d) => { d.insights.push({ id: newId('i'), when: { type: 'always' }, body: '' }); })}>
        + Add guidance rule
      </button>
    </div>
  );
}
