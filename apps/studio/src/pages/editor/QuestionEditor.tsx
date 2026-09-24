import { createOption, isChoiceType, newId, type AssessmentDefinition, type Condition, type Question, type ShowIf } from '@qq/schema';
import { orderedQuestions } from '@qq/engine';
import { Check, Field, ImageField, NumberInput, TextArea, TextInput } from '../../components/ui';
import { move, QUESTION_TYPE_LABELS, ROLE_LABELS } from './helpers';

interface Props {
  def: AssessmentDefinition;
  q: Question;
  onChange: (fn: (q: Question) => void) => void;
  readOnly: boolean;
}

export function QuestionEditor({ def, q, onChange, readOnly }: Props) {
  const method = def.scoring.method;
  const choice = isChoiceType(q.type);
  const ordered = orderedQuestions(def);
  const myIndex = ordered.findIndex((x) => x.id === q.id);
  const earlier = ordered.slice(0, myIndex).filter((x) => isChoiceType(x.type) || x.type === 'rating' || x.type === 'number');

  const changeType = (type: Question['type']) =>
    onChange((d) => {
      const wasChoice = isChoiceType(d.type);
      d.type = type;
      if (isChoiceType(type)) {
        if (type === 'yesno' && !wasChoice) {
          d.options = [{ id: newId('o'), label: 'Yes', points: 1 }, { id: newId('o'), label: 'No', points: 0, isGap: true }];
        } else if (!wasChoice || d.options.length === 0) {
          d.options = [createOption('', 3), createOption('', 2), createOption('', 1)];
        }
        if (d.role === 'info') d.role = 'scored';
      } else {
        if (d.role === 'gate') d.role = 'info';
        if (type === 'rating') d.scale = d.scale ?? { min: 1, max: 5, minLabel: '', maxLabel: '' };
        if (type === 'text' || type === 'longtext' || type === 'number') d.role = d.role === 'scored' ? 'info' : d.role;
      }
    });

  const conditions = q.showIf?.conditions ?? [];
  const setConditions = (fn: (c: Condition[]) => void) =>
    onChange((d) => {
      const next: ShowIf = { mode: d.showIf?.mode ?? 'all', conditions: structuredClone(d.showIf?.conditions ?? []) };
      fn(next.conditions);
      d.showIf = next.conditions.length ? next : undefined;
    });

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
      <Field label="Question">
        <TextArea rows={2} value={q.text} onChange={(v) => onChange((d) => { d.text = v; })} placeholder="Ask one clear thing…" />
      </Field>
      <div className="grid grid-3">
        <Field label="Type">
          <select className="select" value={q.type} onChange={(e) => changeType(e.target.value as Question['type'])}>
            {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Role">
          <select className="select" value={q.role} onChange={(e) => onChange((d) => { d.role = e.target.value as Question['role']; })}>
            {Object.entries(ROLE_LABELS)
              .filter(([k]) => choice || k !== 'gate')
              .filter(([k]) => q.type !== 'text' && q.type !== 'longtext' && q.type !== 'number' ? true : k !== 'scored')
              .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Short label" hint="Export column + results list">
          <TextInput value={q.shortLabel} onChange={(v) => onChange((d) => { d.shortLabel = v || undefined; })} placeholder="e.g. Denial tracking" />
        </Field>
      </div>
      <div className="grid grid-2">
        <Field label="Help text (optional)">
          <TextInput value={q.helpText} onChange={(v) => onChange((d) => { d.helpText = v || undefined; })} />
        </Field>
        <Field label="Section">
          <select className="select" value={q.sectionId} onChange={(e) => onChange((d) => { d.sectionId = e.target.value; })}>
            {def.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="row" style={{ marginBottom: 12, gap: 20 }}>
        <Check checked={q.required} onChange={(v) => onChange((d) => { d.required = v; })} label="Required" />
        {q.role === 'scored' && method !== 'none' && (
          <label className="check">Weight <NumberInput className="input input-sm input-num" step={0.5} min={0} value={q.weight} onChange={(v) => onChange((d) => { d.weight = v ?? 1; })} /></label>
        )}
      </div>

      {choice && (
        <div style={{ marginBottom: 12 }}>
          <div className="row-between" style={{ marginBottom: 6 }}>
            <span className="label">Answer choices</span>
            <span className="small muted">
              {q.role === 'scored' && method === 'points' && 'Points per choice'}
              {q.role === 'scored' && method === 'gaps' && 'Flag the choices that indicate a gap'}
            </span>
          </div>
          {q.options.map((o, i) => (
            <div key={o.id}>
              <div className="opt-row">
                <span className="handle">{String.fromCharCode(65 + i)}</span>
                <input className="input input-sm" value={o.label} placeholder={`Choice ${i + 1}`} onChange={(e) => onChange((d) => { d.options[i].label = e.target.value; })} />
                {q.role === 'scored' && method === 'points' ? (
                  <NumberInput className="input input-sm" value={o.points} placeholder="pts" disabled={!!o.notApplicable}
                    onChange={(v) => onChange((d) => { d.options[i].points = v; })} />
                ) : q.role === 'scored' && method === 'gaps' ? (
                  <label className="check small"><input type="checkbox" checked={!!o.isGap} disabled={!!o.notApplicable} onChange={(e) => onChange((d) => { d.options[i].isGap = e.target.checked || undefined; })} />Gap</label>
                ) : <span />}
                <div className="row" style={{ gap: 2 }}>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Move up" onClick={() => onChange((d) => move(d.options, i, -1))}>↑</button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Move down" onClick={() => onChange((d) => move(d.options, i, 1))}>↓</button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Remove" onClick={() => onChange((d) => { d.options.splice(i, 1); })}>✕</button>
                </div>
              </div>
              <div className="opt-flags">
                {(q.role === 'scored' || q.role === 'gate') && (
                  <label className="check small" title={q.role === 'gate' ? 'Choosing this marks the whole section not applicable' : 'Choosing this leaves the question out of the score'}>
                    <input type="checkbox" checked={!!o.notApplicable} onChange={(e) => onChange((d) => { d.options[i].notApplicable = e.target.checked || undefined; })} />
                    {q.role === 'gate' ? 'Section not applicable' : 'Not applicable (exclude from score)'}
                  </label>
                )}
                {method === 'points' && q.role === 'scored' && (
                  <label className="check small"><input type="checkbox" checked={!!o.isGap} onChange={(e) => onChange((d) => { d.options[i].isGap = e.target.checked || undefined; })} />List as a gap on results</label>
                )}
                <label className="check small"><input type="checkbox" checked={!!o.allowOtherText} onChange={(e) => onChange((d) => { d.options[i].allowOtherText = e.target.checked || undefined; })} />Ask "please specify"</label>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange((d) => { d.options.push(createOption('', method === 'points' ? 0 : undefined)); })}>+ Add choice</button>
        </div>
      )}

      {q.type === 'rating' && (
        <div className="grid grid-4">
          <Field label="Min"><NumberInput value={q.scale?.min ?? 1} onChange={(v) => onChange((d) => { d.scale = { ...(d.scale ?? { min: 1, max: 5 }), min: v ?? 1 }; })} /></Field>
          <Field label="Max"><NumberInput value={q.scale?.max ?? 5} onChange={(v) => onChange((d) => { d.scale = { ...(d.scale ?? { min: 1, max: 5 }), max: v ?? 5 }; })} /></Field>
          <Field label="Low label"><TextInput value={q.scale?.minLabel} onChange={(v) => onChange((d) => { d.scale = { ...(d.scale ?? { min: 1, max: 5 }), minLabel: v }; })} /></Field>
          <Field label="High label"><TextInput value={q.scale?.maxLabel} onChange={(v) => onChange((d) => { d.scale = { ...(d.scale ?? { min: 1, max: 5 }), maxLabel: v }; })} /></Field>
        </div>
      )}

      {(q.type === 'text' || q.type === 'longtext' || q.type === 'number') && (
        <Field label="Placeholder" hint="For free text, remind people not to include client information.">
          <TextInput value={q.placeholder} onChange={(v) => onChange((d) => { d.placeholder = v || undefined; })} />
        </Field>
      )}

      <ImageField label="Image (optional)" folder="questions" value={q.imageUrl} onChange={(v) => onChange((d) => { d.imageUrl = v; })} />

      <div className="rule-box">
        <div className="row-between">
          <span className="label">Branching: show this question only if…</span>
          {conditions.length > 1 && (
            <select className="select input-sm" style={{ width: 'auto' }} value={q.showIf?.mode ?? 'all'} onChange={(e) => onChange((d) => { if (d.showIf) d.showIf.mode = e.target.value as 'all' | 'any'; })}>
              <option value="all">All conditions match</option>
              <option value="any">Any condition matches</option>
            </select>
          )}
        </div>
        {conditions.length === 0 && <p className="small muted" style={{ margin: '6px 0' }}>Always shown.</p>}
        {conditions.map((c, ci) => {
          const target = def.questions.find((x) => x.id === c.questionId);
          const targetChoice = target && isChoiceType(target.type);
          return (
            <div key={ci} className="stack" style={{ gap: 6, padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <select className="select input-sm" style={{ flex: 2, minWidth: 200 }} value={c.questionId}
                  onChange={(e) => setConditions((cs) => { cs[ci] = { questionId: e.target.value, op: 'in', optionIds: [] }; })}>
                  {!target && <option value={c.questionId}>(deleted question)</option>}
                  {earlier.map((x) => <option key={x.id} value={x.id}>Q{ordered.indexOf(x) + 1}. {x.shortLabel || x.text.slice(0, 60)}</option>)}
                </select>
                <select className="select input-sm" style={{ flex: 1, minWidth: 140 }} value={c.op}
                  onChange={(e) => setConditions((cs) => { cs[ci].op = e.target.value as Condition['op']; })}>
                  {targetChoice ? (
                    <>
                      <option value="in">is any of</option>
                      <option value="notIn">is none of</option>
                    </>
                  ) : (
                    <>
                      <option value="gte">is at least</option>
                      <option value="lte">is at most</option>
                    </>
                  )}
                  <option value="answered">was answered</option>
                  <option value="notAnswered">was skipped</option>
                </select>
                {(c.op === 'gte' || c.op === 'lte') && (
                  <NumberInput className="input input-sm input-num" value={c.value} onChange={(v) => setConditions((cs) => { cs[ci].value = v; })} />
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConditions((cs) => { cs.splice(ci, 1); })}>Remove</button>
              </div>
              {targetChoice && (c.op === 'in' || c.op === 'notIn') && (
                <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
                  {target!.options.map((o) => (
                    <label key={o.id} className="check small">
                      <input type="checkbox" checked={!!c.optionIds?.includes(o.id)}
                        onChange={(e) => setConditions((cs) => {
                          const ids = new Set(cs[ci].optionIds ?? []);
                          if (e.target.checked) ids.add(o.id); else ids.delete(o.id);
                          cs[ci].optionIds = [...ids];
                        })} />
                      {o.label || '(blank)'}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {earlier.length > 0 ? (
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
            onClick={() => setConditions((cs) => { cs.push({ questionId: earlier[earlier.length - 1].id, op: isChoiceType(earlier[earlier.length - 1].type) ? 'in' : 'gte', optionIds: [] }); })}>
            + Add condition
          </button>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Branching can only depend on earlier questions.</p>
        )}
      </div>
    </fieldset>
  );
}
