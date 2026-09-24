import { DEFAULT_LEAD_FIELDS, STANDARD_LEAD_KEYS, type LeadField } from '@qq/schema';
import { Check, Field, TextArea, TextInput } from '../../components/ui';
import { move, type EditorProps } from './helpers';

const STANDARD: LeadField[] = [
  ...DEFAULT_LEAD_FIELDS,
  { key: 'phone', label: 'Phone', type: 'tel', required: false },
  { key: 'state', label: 'State', type: 'text', required: false },
];

export function LeadTab({ def, update, readOnly }: EditorProps) {
  const lc = def.leadCapture;
  const set = (fn: (x: typeof lc) => void) => update((d) => fn(d.leadCapture));
  const missingStandard = STANDARD.filter((s) => !lc.fields.some((f) => f.key === s.key));

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="card">
        <div className="card-title">Lead capture</div>
        <div className="card-sub">When to ask who's taking the assessment.</div>
        <div className="stack" style={{ gap: 8 }}>
          {([
            ['beforeResults', 'Before showing results', 'Best for lead generation: people finish, then unlock their results.'],
            ['beforeQuestions', 'On the intro screen', 'Good for optional contact info on short surveys.'],
            ['off', 'Don\'t ask', 'Anonymous responses.'],
          ] as const).map(([k, label, help]) => (
            <label key={k} className="check" style={{ alignItems: 'flex-start' }}>
              <input type="radio" name="leadpos" checked={lc.position === k} onChange={() => set((x) => { x.position = k; })} />
              <span><b>{label}</b><br /><span className="small muted">{help}</span></span>
            </label>
          ))}
        </div>
      </div>

      {lc.position !== 'off' && (
        <>
          <div className="card">
            <div className="grid grid-2">
              <Field label="Heading"><TextInput value={lc.heading} onChange={(v) => set((x) => { x.heading = v; })} /></Field>
              <Field label="Submit button"><TextInput value={lc.submitLabel} onChange={(v) => set((x) => { x.submitLabel = v; })} /></Field>
            </div>
            <Field label="Intro text (optional)"><TextArea rows={2} value={lc.body} onChange={(v) => set((x) => { x.body = v || undefined; })} /></Field>
            <div className="grid grid-2">
              <Field label="Consent checkbox text (optional)" hint="If set, respondents must tick it to continue.">
                <TextArea rows={2} value={lc.consentText} onChange={(v) => set((x) => { x.consentText = v || undefined; })} placeholder="I agree to be contacted by Qualifacts about my results." />
              </Field>
              <Field label="Privacy policy URL (optional)"><TextInput value={lc.privacyUrl} onChange={(v) => set((x) => { x.privacyUrl = v || undefined; })} placeholder="https://www.qualifacts.com/privacy-policy/" /></Field>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Fields</div>
            <div className="card-sub">
              Standard fields map to Salesforce Lead fields ({Object.entries(STANDARD_LEAD_KEYS).map(([k, v]) => `${k}→${v}`).join(', ')}). Custom fields are saved too and can be mapped later.
            </div>
            {lc.fields.map((f, i) => {
              const standard = f.key in STANDARD_LEAD_KEYS;
              return (
                <div key={i} className="rule-box" style={{ marginBottom: 8 }}>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <input className="input input-sm" style={{ flex: 2, minWidth: 160 }} value={f.label} onChange={(e) => set((x) => { x.fields[i].label = e.target.value; })} aria-label="Label" />
                    <input className="input input-sm mono" style={{ flex: 1, minWidth: 120 }} value={f.key} disabled={standard} title={standard ? 'Standard field key' : 'Custom key (lowercase_with_underscores)'}
                      onChange={(e) => set((x) => { x.fields[i].key = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'); })} aria-label="Key" />
                    <select className="select input-sm" style={{ width: 'auto' }} value={f.type} onChange={(e) => set((x) => { x.fields[i].type = e.target.value as LeadField['type']; })}>
                      <option value="text">Text</option>
                      <option value="email">Email</option>
                      <option value="tel">Phone</option>
                      <option value="select">Dropdown</option>
                      <option value="textarea">Paragraph</option>
                    </select>
                    <Check checked={f.required} onChange={(v) => set((x) => { x.fields[i].required = v; })} label="Required" />
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => set((x) => move(x.fields, i, -1))}>↑</button>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => set((x) => move(x.fields, i, 1))}>↓</button>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => set((x) => { x.fields.splice(i, 1); })}>✕</button>
                  </div>
                  {f.type === 'select' && (
                    <Field label="Dropdown options (one per line)">
                      <TextArea rows={3} value={(f.options ?? []).join('\n')} onChange={(v) => set((x) => { x.fields[i].options = v.split('\n'); })} />
                    </Field>
                  )}
                  <input className="input input-sm" style={{ marginTop: 6 }} placeholder="Placeholder (optional)" value={f.placeholder ?? ''} onChange={(e) => set((x) => { x.fields[i].placeholder = e.target.value || undefined; })} />
                </div>
              );
            })}
            <div className="btn-row" style={{ marginTop: 8 }}>
              {missingStandard.map((s) => (
                <button type="button" key={s.key} className="btn btn-secondary btn-sm" onClick={() => set((x) => { x.fields.push({ ...s }); })}>+ {s.label}</button>
              ))}
              <button type="button" className="btn btn-secondary btn-sm"
                onClick={() => set((x) => { x.fields.push({ key: `custom_${x.fields.length + 1}`, label: 'Custom field', type: 'text', required: false }); })}>
                + Custom field
              </button>
            </div>
          </div>
        </>
      )}
    </fieldset>
  );
}
