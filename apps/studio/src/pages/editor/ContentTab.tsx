import { useState } from 'react';
import { createQuestion, createSection, newId, type Question } from '@qq/schema';
import { orderedQuestions } from '@qq/engine';
import { Field, ImageField, NumberInput, TextArea, TextInput } from '../../components/ui';
import { QuestionEditor } from './QuestionEditor';
import { move, QUESTION_TYPE_LABELS, type EditorProps } from './helpers';

export function ContentTab({ def, update, readOnly, openId, setOpenId }: EditorProps & {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}) {
  const [addType, setAddType] = useState<Question['type']>('single');
  const ordered = orderedQuestions(def);
  const number = new Map(ordered.map((q, i) => [q.id, i + 1]));

  const updateQuestion = (id: string, fn: (q: Question) => void) =>
    update((d) => {
      const q = d.questions.find((x) => x.id === id);
      if (q) fn(q);
    });

  const moveQuestion = (id: string, dir: -1 | 1) =>
    update((d) => {
      const q = d.questions.find((x) => x.id === id)!;
      const siblings = d.questions.filter((x) => x.sectionId === q.sectionId);
      const pos = siblings.indexOf(q);
      const other = siblings[pos + dir];
      if (!other) return;
      const a = d.questions.indexOf(q);
      const b = d.questions.indexOf(other);
      [d.questions[a], d.questions[b]] = [d.questions[b], d.questions[a]];
    });

  const deleteQuestion = (id: string) => {
    const dependents = def.questions.filter((q) => q.showIf?.conditions.some((c) => c.questionId === id));
    const msg = dependents.length
      ? `Delete this question? ${dependents.length} other question(s) branch on it and will always be shown instead.`
      : 'Delete this question?';
    if (!window.confirm(msg)) return;
    update((d) => {
      d.questions = d.questions.filter((q) => q.id !== id);
      for (const q of d.questions) {
        if (!q.showIf) continue;
        q.showIf.conditions = q.showIf.conditions.filter((c) => c.questionId !== id);
        if (q.showIf.conditions.length === 0) q.showIf = undefined;
      }
      d.recommendations.rules = d.recommendations.rules.filter((r) => !(r.when.type === 'optionSelected' && r.when.questionId === id));
      d.insights = d.insights.filter((i) => !(i.when.type === 'optionSelected' && i.when.questionId === id));
    });
  };

  const duplicateQuestion = (id: string) =>
    update((d) => {
      const i = d.questions.findIndex((x) => x.id === id);
      const copy = structuredClone(d.questions[i]);
      copy.id = newId('q');
      copy.options = copy.options.map((o) => ({ ...o, id: newId('o') }));
      d.questions.splice(i + 1, 0, copy);
    });

  const addQuestion = (sectionId: string) => {
    const q = createQuestion(sectionId, addType);
    if (def.scoring.method !== 'points') q.options = q.options.map((o) => ({ ...o, points: undefined }));
    update((d) => {
      const lastInSection = d.questions.map((x) => x.sectionId).lastIndexOf(sectionId);
      d.questions.splice(lastInSection + 1, 0, q);
    });
    setOpenId(q.id);
  };

  const deleteSection = (id: string) => {
    const count = def.questions.filter((q) => q.sectionId === id).length;
    if (def.sections.length === 1) return window.alert('An assessment needs at least one section.');
    if (!window.confirm(count ? `Delete this section and its ${count} question(s)?` : 'Delete this section?')) return;
    const removed = new Set(def.questions.filter((q) => q.sectionId === id).map((q) => q.id));
    update((d) => {
      d.sections = d.sections.filter((s) => s.id !== id);
      d.questions = d.questions.filter((q) => q.sectionId !== id);
      for (const q of d.questions) {
        if (!q.showIf) continue;
        q.showIf.conditions = q.showIf.conditions.filter((c) => !removed.has(c.questionId));
        if (!q.showIf.conditions.length) q.showIf = undefined;
      }
      d.recommendations.rules = d.recommendations.rules.filter((r) =>
        !(r.when.type === 'sectionBelow' && r.when.sectionId === id) && !(r.when.type === 'optionSelected' && removed.has(r.when.questionId)));
    });
  };

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="card">
        <div className="card-title">Intro screen</div>
        <div className="card-sub">The first thing prospects see.</div>
        <div className="grid grid-2">
          <Field label="Eyebrow badge"><TextInput value={def.intro.eyebrow} onChange={(v) => update((d) => { d.intro.eyebrow = v || undefined; })} placeholder="Free Assessment" /></Field>
          <Field label="Start button label"><TextInput value={def.intro.startLabel} onChange={(v) => update((d) => { d.intro.startLabel = v; })} /></Field>
        </div>
        <Field label="Headline"><TextInput value={def.intro.headline} onChange={(v) => update((d) => { d.intro.headline = v; })} /></Field>
        <Field label="Subheadline"><TextInput value={def.intro.subheadline} onChange={(v) => update((d) => { d.intro.subheadline = v || undefined; })} /></Field>
        <Field label="Body" hint="Supports **bold**, *italic*, [links](https://…) and blank lines between paragraphs.">
          <TextArea rows={4} value={def.intro.body} onChange={(v) => update((d) => { d.intro.body = v || undefined; })} />
        </Field>
        <div className="grid grid-2">
          <Field label="Bullet points (one per line)">
            <TextArea rows={3} value={def.intro.bullets.join('\n')} onChange={(v) => update((d) => { d.intro.bullets = v.split('\n').filter((l, i, all) => l.trim() || i < all.length - 1); })} />
          </Field>
          <Field label="Estimated minutes"><NumberInput value={def.intro.estimatedMinutes} min={1} onChange={(v) => update((d) => { d.intro.estimatedMinutes = v; })} /></Field>
        </div>
        <ImageField label="Hero image (optional)" folder="heroes" value={def.intro.imageUrl} onChange={(v) => update((d) => { d.intro.imageUrl = v; })} />
      </div>

      <div className="row-between" style={{ margin: '22px 0 10px' }}>
        <div>
          <div className="card-title">Sections & questions</div>
          <div className="small muted">{ordered.length} questions in {def.sections.length} sections. Click a question to edit it.</div>
        </div>
        <label className="check small">
          New question type:
          <select className="select input-sm" style={{ width: 'auto' }} value={addType} onChange={(e) => setAddType(e.target.value as Question['type'])}>
            {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>

      {def.sections.map((s, si) => {
        const qs = def.questions.filter((q) => q.sectionId === s.id);
        return (
          <div className="outline-section" key={s.id}>
            <div className="outline-section-head">
              <input className="input" value={s.name} onChange={(e) => update((d) => { d.sections[si].name = e.target.value; })} aria-label="Section name" />
              <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Move section up" onClick={() => update((d) => move(d.sections, si, -1))}>↑</button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Move section down" onClick={() => update((d) => move(d.sections, si, 1))}>↓</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => deleteSection(s.id)}>Delete</button>
            </div>
            <div style={{ padding: '8px 12px 0' }}>
              <input className="input input-sm" placeholder="Section description (optional, internal)" value={s.description ?? ''}
                onChange={(e) => update((d) => { d.sections[si].description = e.target.value || undefined; })} />
              <label className="check small" style={{ margin: '8px 0' }}>
                <input type="checkbox" checked={s.showInResults} onChange={(e) => update((d) => { d.sections[si].showInResults = e.target.checked; })} />
                Show this section in the results breakdown
              </label>
            </div>
            {qs.map((q, qi) => {
              const open = openId === q.id;
              return (
                <div key={q.id}>
                  <div className={`q-row ${open ? 'open' : ''}`} onClick={() => setOpenId(open ? null : q.id)}>
                    <span className="q-num">Q{number.get(q.id)}</span>
                    <div className="q-summary">
                      <div className="q-text">{q.text || <span className="muted">(no question text)</span>}</div>
                      <div className="q-meta">
                        <span className="pill pill-neutral">{QUESTION_TYPE_LABELS[q.type].split(' (')[0]}</span>
                        {q.role !== 'scored' && <span className="pill pill-draft">{q.role}</span>}
                        {q.showIf && <span className="pill pill-paused">Branching</span>}
                        {!q.required && <span className="pill pill-neutral">Optional</span>}
                        {q.options.length > 0 && <span className="small muted">{q.options.length} choices</span>}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Move up" disabled={qi === 0} onClick={() => moveQuestion(q.id, -1)}>↑</button>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Move down" disabled={qi === qs.length - 1} onClick={() => moveQuestion(q.id, 1)}>↓</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => duplicateQuestion(q.id)}>Copy</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => deleteQuestion(q.id)}>Delete</button>
                    </div>
                  </div>
                  {open && (
                    <div className="q-editor">
                      <QuestionEditor def={def} q={q} readOnly={readOnly} onChange={(fn) => updateQuestion(q.id, fn)} />
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ padding: 10 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => addQuestion(s.id)}>+ Add question to {s.name || 'section'}</button>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn btn-secondary" onClick={() => update((d) => { d.sections.push(createSection(`Section ${d.sections.length + 1}`)); })}>
        + Add section
      </button>
    </fieldset>
  );
}
