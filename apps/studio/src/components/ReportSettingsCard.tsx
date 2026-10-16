import { useEffect, useState } from 'react';
import type { AssessmentDefinition } from '@qq/schema';
import { REPORT_DEFAULTS, type ReportSettings } from '@qq/ai';
import { supabase, T } from '../lib/supabase';
import { previewReport, requestReport } from '../lib/reports';
import { KNOWLEDGE_KIND_LABELS, type AssessmentRow, type AssessmentSettings, type KnowledgeRow } from '../lib/types';
import { Check, Field, useToast } from './ui';

/** Editor → Settings: AI-written PDF report for every response. */
export function ReportSettingsCard({ row, def, readOnly, saveSettings }: {
  row: AssessmentRow;
  def: AssessmentDefinition;
  readOnly: boolean;
  saveSettings: (patch: Partial<AssessmentSettings>) => Promise<boolean>;
}) {
  const toast = useToast();
  const report: ReportSettings = row.settings.report ?? { enabled: false };
  const [knowledge, setKnowledge] = useState<KnowledgeRow[] | null>(null);
  const [missing, setMissing] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const kIds = new Set(report.knowledgeIds ?? row.settings.ai_brief?.knowledgeIds ?? []);

  useEffect(() => {
    supabase.from(T.knowledge).select('id,title,kind,topic,product_line,char_count').eq('is_active', true).order('title')
      .then(({ data }) => setKnowledge((data as KnowledgeRow[]) ?? []));
  }, []);
  const countMissing = () =>
    supabase.from(T.responses).select('id', { count: 'exact', head: true }).eq('assessment_id', row.id).eq('is_test', false).in('report_status', ['none', 'failed'])
      .then(({ count }) => setMissing(count ?? 0));
  useEffect(() => { if (report.enabled) countMissing(); }, [report.enabled, row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (patch: Partial<ReportSettings>) => saveSettings({ report: { ...report, ...patch } });

  const preview = async (mode: 'best' | 'worst') => {
    setBusy(mode === 'best' ? 'Writing a strong-score sample…' : 'Writing a weak-score sample…');
    try {
      const { url } = await previewReport(row.id, def, mode);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const backfill = async () => {
    const { data } = await supabase.from(T.responses).select('id').eq('assessment_id', row.id).eq('is_test', false).in('report_status', ['none', 'failed']).limit(100);
    const ids = (data ?? []).map((x: { id: string }) => x.id);
    if (!ids.length) return;
    if (!window.confirm(`Create PDF reports for ${ids.length} existing response${ids.length === 1 ? '' : 's'}? Each one uses an AI request.`)) return;
    let done = 0;
    for (const id of ids) {
      setBusy(`Queuing reports… ${done}/${ids.length}`);
      try { await requestReport(id, true); } catch (e) { toast.error(e); break; }
      done++;
    }
    setBusy(null);
    toast.ok(`Started ${done} report${done === 1 ? '' : 's'}. They appear on each response within a few minutes.`);
    countMissing();
  };

  return (
    <div className="card">
      <div className="card-title">PDF report for each response</div>
      <div className="card-sub">
        Claude writes a personalized report from each respondent's answers (gaps, impact and practical recommendations), grounded in your Knowledge docs.
        It's saved as a PDF on the response for your team to share. Test responses are skipped.
      </div>
      <Check checked={report.enabled} onChange={(v) => save({ enabled: v })} label="Create a PDF report for every completed response" />
      {report.enabled && (
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: '14px 0 0', minWidth: 0 }}>
          <div className="grid grid-2">
            <Field label="Report title" hint="Shown at the top of page 1.">
              <input className="input" defaultValue={report.title ?? ''} placeholder={`${def.meta.title || row.title} Report`} onBlur={(e) => e.target.value !== (report.title ?? '') && save({ title: e.target.value || undefined })} />
            </Field>
            <Field label="Header line" hint="Small line under the logo.">
              <input className="input" defaultValue={report.brandLine ?? ''} placeholder="Powered by Qualifacts" onBlur={(e) => e.target.value !== (report.brandLine ?? '') && save({ brandLine: e.target.value || undefined })} />
            </Field>
            <Field label="Impact heading" hint="Heading for each area's impact paragraph.">
              <input className="input" defaultValue={report.impactLabel ?? ''} placeholder={`${REPORT_DEFAULTS.impactLabel} (e.g. Revenue Impact)`} onBlur={(e) => e.target.value !== (report.impactLabel ?? '') && save({ impactLabel: e.target.value || undefined })} />
            </Field>
            <Field label="Analyze areas scoring below (%)" hint="Those get Gap / Impact / Recommendations. If none are, the two weakest are covered.">
              <input type="number" min={1} max={100} className="input input-num" defaultValue={report.analyzeBelowPct ?? REPORT_DEFAULTS.analyzeBelowPct}
                onBlur={(e) => save({ analyzeBelowPct: e.target.value ? Math.min(100, Math.max(1, Number(e.target.value))) : undefined })} />
            </Field>
          </div>
          <Field label="Extra guidance for the writer (optional)" hint="e.g. “Never recommend outside consultants.” “Mention our 30-day onboarding.”">
            <textarea className="textarea" rows={2} defaultValue={report.guidance ?? ''} onBlur={(e) => e.target.value !== (report.guidance ?? '') && save({ guidance: e.target.value || undefined })} />
          </Field>
          <Field label="Knowledge docs to ground the report" hint={report.knowledgeIds ? 'Chosen for this report.' : 'Defaults to the docs used when this assessment was generated.'}>
            {!knowledge ? <span className="small muted">Loading…</span> : knowledge.length === 0 ? <span className="small muted">The Knowledge library is empty.</span> : (
              <div className="stack" style={{ gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                {knowledge.map((k) => (
                  <label key={k.id} className={`check pick-row ${kIds.has(k.id) ? 'on' : ''}`} style={{ padding: '6px 10px' }}>
                    <input type="checkbox" checked={kIds.has(k.id)} onChange={(e) => {
                      const n = new Set(kIds);
                      if (e.target.checked) n.add(k.id); else n.delete(k.id);
                      save({ knowledgeIds: [...n] });
                    }} />
                    <span style={{ flex: 1 }}><b style={{ color: 'var(--navy)' }}>{k.title}</b> <span className="small muted">· {KNOWLEDGE_KIND_LABELS[k.kind]}{k.topic ? ` · ${k.topic}` : ''}</span></span>
                  </label>
                ))}
              </div>
            )}
          </Field>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => preview('worst')}>Preview (weak score)</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => preview('best')}>Preview (strong score)</button>
            {!!missing && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={backfill}>Create for {missing} existing response{missing === 1 ? '' : 's'}</button>}
            {busy && <span className="small muted"><span className="ai-dots" style={{ marginRight: 6 }}><i /><i /><i /></span>{busy}</span>}
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>Previews use sample answers and the current draft. They open in a new tab and aren't saved on any response. Each preview uses one AI request.</p>
        </fieldset>
      )}
    </div>
  );
}
