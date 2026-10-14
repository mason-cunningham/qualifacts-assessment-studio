import { useEffect, useState } from 'react';
import { supabase, T } from '../lib/supabase';
import { fmtRelative, copyText } from '../lib/format';
import { REPORT_STATUS_LABEL, reportInProgress, requestReport } from '../lib/reports';
import type { ResponseRow } from '../lib/types';
import { useToast } from './ui';

type ReportFields = Pick<ResponseRow, 'id' | 'report_status' | 'report_url' | 'report_error' | 'report_generated_at'>;

/** Response page: the AI-written PDF report (download, copy link, regenerate). */
export function ReportCard({ response, canEdit, reportsEnabled }: { response: ReportFields; canEdit: boolean; reportsEnabled: boolean }) {
  const toast = useToast();
  const [r, setR] = useState<ReportFields>(response);
  const [busy, setBusy] = useState(false);
  useEffect(() => setR(response), [response]);

  // While a report is being written, check back every few seconds
  useEffect(() => {
    if (!reportInProgress(r.report_status)) return;
    const t = window.setInterval(async () => {
      const { data } = await supabase.from(T.responses).select('id,report_status,report_url,report_error,report_generated_at').eq('id', r.id).single();
      if (data) setR(data as ReportFields);
    }, 5000);
    return () => window.clearInterval(t);
  }, [r.id, r.report_status]);

  const start = async (force: boolean) => {
    setBusy(true);
    try {
      await requestReport(r.id, force);
      setR((x) => ({ ...x, report_status: 'generating', report_error: null }));
      toast.ok('Writing the report. This usually takes under a minute.');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const status = r.report_status ?? 'none';
  if (status === 'none' && !reportsEnabled && !canEdit) return null;

  return (
    <div className="card">
      <div className="row-between">
        <div className="card-title">PDF report</div>
        <span className={`pill ${status === 'ready' ? 'pill-published' : status === 'failed' ? 'pill-test' : 'pill-neutral'}`}>{REPORT_STATUS_LABEL[status]}</span>
      </div>
      {status === 'ready' && r.report_url && (
        <>
          <div className="small muted" style={{ marginBottom: 10 }}>Generated {fmtRelative(r.report_generated_at)} · anyone with the link can open it.</div>
          <div className="btn-row">
            <a className="btn btn-primary btn-sm" href={r.report_url} target="_blank" rel="noreferrer">Open PDF</a>
            <a className="btn btn-secondary btn-sm" href={`${r.report_url}?download=`} download>Download</a>
            <button className="btn btn-secondary btn-sm" onClick={async () => (await copyText(r.report_url!)) && toast.ok('Link copied')}>Copy link</button>
            {canEdit && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => window.confirm('Write a new report? It replaces the current PDF and link.') && start(true)}>Regenerate</button>}
          </div>
        </>
      )}
      {reportInProgress(status) && (
        <div className="small muted">
          <span className="ai-dots" style={{ marginRight: 6 }}><i /><i /><i /></span>
          Claude is writing this report. It appears here automatically.
          {canEdit && status === 'pending' && <> <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => start(true)}>Start now</button></>}
        </div>
      )}
      {status === 'failed' && (
        <>
          <div className="small error-text" style={{ marginBottom: 8 }}>{r.report_error || 'The report could not be generated.'}</div>
          {canEdit && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => start(true)}>Try again</button>}
        </>
      )}
      {status === 'none' && (
        <>
          <div className="small muted" style={{ marginBottom: 8 }}>
            {reportsEnabled ? 'No report was created for this response.' : 'PDF reports are off for this assessment. You can still create one for this response.'}
          </div>
          {canEdit && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => start(false)}>Generate report</button>}
        </>
      )}
    </div>
  );
}
