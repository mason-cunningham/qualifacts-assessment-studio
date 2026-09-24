import { useState } from 'react';
import { newId, type AssessmentDefinition, type Question } from '@qq/schema';
import { computeResults, orderedQuestions } from '@qq/engine';
import { summarizeDefinition, type OptionsResult, type ReviewResult, type RewriteResult, type TierCopyResult } from '@qq/ai';
import { runAi } from '../lib/ai';
import { sampleAnswers } from '../pages/editor/helpers';
import { Modal, useToast } from './ui';

function audienceOf(def: AssessmentDefinition): string {
  return def.meta.description ? `Organizations taking "${def.meta.title}": ${def.meta.description}` : 'Behavioral health organizations';
}

function questionContext(def: AssessmentDefinition, q: Question) {
  return {
    assessmentTitle: def.meta.title,
    audience: audienceOf(def),
    scoringMethod: def.scoring.method,
    sectionName: def.sections.find((s) => s.id === q.sectionId)?.name ?? '',
    question: {
      text: q.text,
      type: q.type,
      role: q.role,
      options: q.options.map((o) => ({ label: o.label, points: o.points, isGap: o.isGap })),
    },
  };
}

/** "✨ Improve wording" and "✨ Suggest choices" for one question. */
export function QuestionAiTools({ def, q, onChange }: {
  def: AssessmentDefinition;
  q: Question;
  onChange: (fn: (q: Question) => void) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<'rewrite' | 'options' | null>(null);
  const [alts, setAlts] = useState<RewriteResult['alternatives'] | null>(null);
  const [opts, setOpts] = useState<OptionsResult | null>(null);
  const choice = ['single', 'multi', 'dropdown', 'yesno'].includes(q.type);

  const rewrite = async () => {
    if (!q.text.trim()) return toast.error('Write a first draft of the question, then improve it.');
    setBusy('rewrite');
    try {
      const { data } = await runAi({ mode: 'rewrite', ...questionContext(def, q) });
      setAlts(data.alternatives);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    if (!q.text.trim()) return toast.error('Write the question first.');
    setBusy('options');
    try {
      const { data } = await runAi({ mode: 'options', ...questionContext(def, q) });
      setOpts(data);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const applyOptions = () => {
    if (!opts) return;
    const dependents = def.questions.filter((x) => x.showIf?.conditions.some((c) => c.questionId === q.id));
    if (dependents.length && !window.confirm(`${dependents.length} question(s) branch on this question's current choices. Replacing the choices removes those branching rules. Continue?`)) return;
    onChange((d) => {
      d.options = opts.options.map((o) => ({
        id: newId('o'),
        label: o.label,
        ...(def.scoring.method === 'points' && !o.notApplicable ? { points: o.points } : {}),
        ...(o.isGap ? { isGap: true } : {}),
        ...(o.notApplicable ? { notApplicable: true } : {}),
      }));
    });
    setOpts(null);
    toast.ok('Choices replaced. Check branching and recommendations on the Solutions tab.');
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={rewrite}>
          {busy === 'rewrite' ? 'Thinking…' : '✨ Improve wording'}
        </button>
        {choice && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={suggest}>
            {busy === 'options' ? 'Thinking…' : '✨ Suggest choices'}
          </button>
        )}
      </div>
      {alts && (
        <div className="rule-box">
          <div className="row-between"><span className="label">Suggested wording</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAlts(null)}>Dismiss</button></div>
          {alts.map((a, i) => (
            <div key={i} className="row-between" style={{ padding: '6px 0', borderTop: i ? '1px dashed var(--border)' : undefined, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{a.text}</div>
                <div className="small muted">{a.shortLabel} · {a.why}</div>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { onChange((d) => { d.text = a.text; d.shortLabel = a.shortLabel; }); setAlts(null); }}>Use</button>
            </div>
          ))}
        </div>
      )}
      {opts && (
        <div className="rule-box">
          <div className="row-between"><span className="label">Suggested choices</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpts(null)}>Dismiss</button></div>
          <ol className="small" style={{ margin: '6px 0', paddingLeft: 20 }}>
            {opts.options.map((o, i) => (
              <li key={i}>{o.label} <span className="muted">{def.scoring.method === 'points' && !o.notApplicable ? `· ${o.points} pts ` : ''}{o.isGap ? '· gap ' : ''}{o.notApplicable ? '· N/A' : ''}</span></li>
            ))}
          </ol>
          <p className="small muted" style={{ margin: '0 0 8px' }}>{opts.rationale}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={applyOptions}>Replace choices</button>
        </div>
      )}
    </div>
  );
}

/** "✨ Write tier copy" for the overall score tiers. */
export function TierCopyButton({ def, update }: { def: AssessmentDefinition; update: (fn: (d: AssessmentDefinition) => void) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TierCopyResult | null>(null);

  const run = async () => {
    if (!def.scoring.tiers.length) return toast.error('Add tiers first.');
    setBusy(true);
    try {
      const best = computeResults(def, sampleAnswers(def, 'best'));
      const { data } = await runAi({
        mode: 'tier_copy',
        assessmentTitle: def.meta.title,
        audience: audienceOf(def),
        tierBasis: def.scoring.tierBasis,
        maxPoints: best.max || null,
        sections: def.sections.filter((s) => s.showInResults).map((s) => s.name),
        products: def.products.map((p) => p.name),
        tiers: def.scoring.tiers.map((t) => ({ label: t.label, min: t.min, max: t.max })),
      });
      setResult(data);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!result) return;
    update((d) => {
      d.scoring.tiers.forEach((t, i) => {
        const r = result.tiers[i];
        if (!r) return;
        t.label = r.label || t.label;
        t.summary = r.summary;
        t.body = r.body;
      });
    });
    setResult(null);
    toast.ok('Tier copy applied');
  };

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={run}>{busy ? 'Writing…' : '✨ Write tier copy'}</button>
      {result && (
        <Modal title="Suggested tier copy" onClose={() => setResult(null)} wide
          footer={<><button className="btn btn-ghost" onClick={() => setResult(null)}>Discard</button><button className="btn btn-primary" onClick={apply}>Apply to tiers</button></>}>
          {result.tiers.map((t, i) => (
            <div key={i} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--border)' : undefined }}>
              <b style={{ color: def.scoring.tiers[i]?.color }}>{t.label}</b> <span className="small muted">{def.scoring.tiers[i] ? `${def.scoring.tiers[i].min}–${def.scoring.tiers[i].max}` : ''}</span>
              <div>{t.summary}</div>
              <div className="small muted">{t.body}</div>
            </div>
          ))}
        </Modal>
      )}
    </>
  );
}

/** "✨ Review" the whole assessment. */
export function ReviewButton({ def, onJumpToQuestion }: { def: AssessmentDefinition; onJumpToQuestion: (questionId: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const qs = orderedQuestions(def);

  const run = async () => {
    setBusy(true);
    try {
      const { data } = await runAi({ mode: 'review', outline: summarizeDefinition(def) });
      setResult(data);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const sevClass = { high: 'error', medium: 'warning', low: 'warning' } as const;

  return (
    <>
      <button className="btn btn-secondary btn-sm" disabled={busy} onClick={run}>{busy ? 'Reviewing…' : '✨ Review'}</button>
      {result && (
        <Modal title="AI review" onClose={() => setResult(null)} wide footer={<button className="btn btn-primary" onClick={() => setResult(null)}>Close</button>}>
          <p style={{ marginTop: 0 }}>{result.overall}</p>
          {result.issues.length === 0 ? <p className="muted">No issues found.</p> : (
            <ul className="checklist">
              {result.issues.map((i, n) => {
                const q = i.questionNumber ? qs[i.questionNumber - 1] : undefined;
                return (
                  <li key={n} className={sevClass[i.severity]}>
                    <span>{i.severity === 'high' ? '⛔' : '⚠️'}</span>
                    <span>
                      {q && <b>Q{i.questionNumber}: </b>}{i.message}
                      <br /><span className="small">→ {i.suggestion}</span>
                    </span>
                    {q && <button className="btn btn-ghost btn-sm" onClick={() => { setResult(null); onJumpToQuestion(q.id); }}>Go to</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}
