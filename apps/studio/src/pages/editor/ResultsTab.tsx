import { MERGE_TAGS } from '@qq/engine';
import { Check, Field, TextArea, TextInput } from '../../components/ui';
import type { EditorProps } from './helpers';

export function ResultsTab({ def, update, readOnly }: EditorProps) {
  const r = def.results;
  const survey = def.scoring.method === 'none' || r.thankYouOnly;
  const set = (fn: (x: typeof r) => void) => update((d) => fn(d.results));

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="card">
        <div className="card-title">Results page</div>
        <div className="card-sub">What prospects see after they finish. Copy fields support Markdown and merge tags.</div>
        <Check checked={r.thankYouOnly} onChange={(v) => set((x) => { x.thankYouOnly = v; })} label="Show a thank-you message instead of scores (surveys)" />
      </div>

      {survey ? (
        <div className="card">
          <div className="card-title">Thank-you screen</div>
          <Field label="Headline"><TextInput value={r.thankYouHeadline} onChange={(v) => set((x) => { x.thankYouHeadline = v; })} /></Field>
          <Field label="Message"><TextArea rows={3} value={r.thankYouBody} onChange={(v) => set((x) => { x.thankYouBody = v || undefined; })} /></Field>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-title">Score header</div>
            <div className="grid grid-2">
              <Field label="Eyebrow"><TextInput value={r.eyebrow} onChange={(v) => set((x) => { x.eyebrow = v; })} /></Field>
              <div style={{ paddingTop: 22 }}><Check checked={r.showScore} onChange={(v) => set((x) => { x.showScore = v; })} label="Show the score ring" /></div>
            </div>
            <Field label="Headline override (optional)" hint="Leave blank to use each tier's summary.">
              <TextArea rows={2} value={r.headline} onChange={(v) => set((x) => { x.headline = v || undefined; })} />
            </Field>
            <Field label="Extra content (optional)" hint="Shown below the guidance, e.g. what happens next. Supports ### Headings, - bullets, **bold** and [links](https://…).">
              <TextArea rows={3} value={r.body} onChange={(v) => set((x) => { x.body = v || undefined; })} />
            </Field>
          </div>
          <div className="card">
            <div className="card-title">Sections on the page</div>
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Check checked={r.showInsights} onChange={(v) => set((x) => { x.showInsights = v; })} label="Guidance (tier guidance + matching guidance rule)" />
                <input className="input input-sm" style={{ maxWidth: 260 }} value={r.insightsHeading} onChange={(e) => set((x) => { x.insightsHeading = e.target.value; })} aria-label="Guidance heading" />
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Check checked={r.showSectionBreakdown} onChange={(v) => set((x) => { x.showSectionBreakdown = v; })} label="Section breakdown" />
                <input className="input input-sm" style={{ maxWidth: 260 }} value={r.sectionBreakdownHeading} onChange={(e) => set((x) => { x.sectionBreakdownHeading = e.target.value; })} aria-label="Breakdown heading" />
              </div>
              <Check checked={r.showGapList} onChange={(v) => set((x) => { x.showGapList = v; })} label="List flagged gaps under each section" />
              <Check checked={r.showRecommendations} onChange={(v) => set((x) => { x.showRecommendations = v; })} label="Recommended solutions (configure on the Solutions tab)" />
            </div>
          </div>
        </>
      )}

      <div className="card">
        <div className="card-title">Buttons & footer</div>
        <div className="grid grid-2">
          <Field label="Primary button label"><TextInput value={r.primaryCta?.label} placeholder="e.g. Talk to your account team" onChange={(v) => set((x) => { x.primaryCta = v || x.primaryCta?.url ? { label: v, url: x.primaryCta?.url ?? '' } : undefined; })} /></Field>
          <Field label="Primary button URL"><TextInput value={r.primaryCta?.url} placeholder="https://" onChange={(v) => set((x) => { x.primaryCta = { label: x.primaryCta?.label ?? '', url: v }; })} /></Field>
          <Field label="Secondary button label"><TextInput value={r.secondaryCta?.label} onChange={(v) => set((x) => { x.secondaryCta = v || x.secondaryCta?.url ? { label: v, url: x.secondaryCta?.url ?? '' } : undefined; })} /></Field>
          <Field label="Secondary button URL"><TextInput value={r.secondaryCta?.url} placeholder="https://" onChange={(v) => set((x) => { x.secondaryCta = { label: x.secondaryCta?.label ?? '', url: v }; })} /></Field>
        </div>
        <Field label="Footer note"><TextArea rows={2} value={r.footerNote} onChange={(v) => set((x) => { x.footerNote = v || undefined; })} /></Field>
        <div className="row" style={{ gap: 20 }}>
          <Check checked={r.allowPdf} onChange={(v) => set((x) => { x.allowPdf = v; })} label="Download / print button" />
          <Check checked={r.allowRetake} onChange={(v) => set((x) => { x.allowRetake = v; })} label="Retake link" />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Merge tags</div>
        <div className="grid grid-2 small">
          {MERGE_TAGS.map((m) => <div key={m.tag}><code>{m.tag}</code> <span className="muted">{m.help}</span></div>)}
        </div>
      </div>
    </fieldset>
  );
}
