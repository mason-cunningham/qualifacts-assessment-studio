// Supabase Edge Function: process-outbox (NOT needed yet)
//
// Drains "q-quiz-outbox" jobs:
//   lead_alert_email → sends an email (Resend) once RESEND_API_KEY + ALERT_FROM are set
//   crm_sync         → placeholder for the future Salesforce handler
//
// Nothing is enqueued until you flip the switches in "q-quiz-config"
// (email_alerts_enabled / crm_enabled), so this can sit undeployed for now.
//
// When ready: deploy it, add secrets RESEND_API_KEY, ALERT_FROM (e.g. "Qualifacts Assessments <assessments@qualifacts.com>"),
// STUDIO_URL, then either add a Database Webhook on INSERT into q-quiz-outbox that calls this
// function, or schedule it every minute with pg_cron.

import { createClient } from 'npm:@supabase/supabase-js@2';

interface Job {
  id: string;
  kind: 'lead_alert_email' | 'crm_sync';
  response_id: string | null;
  assessment_id: string | null;
  recipient: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: jobs, error } = await db
    .from('q-quiz-outbox')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .lte('run_after', new Date().toISOString())
    .order('created_at')
    .limit(25);
  if (error) return new Response(error.message, { status: 500 });

  const results: Record<string, string> = {};
  for (const job of (jobs ?? []) as Job[]) {
    // Claim the job (skip if another worker got it first)
    const { data: claimed } = await db
      .from('q-quiz-outbox')
      .update({ status: 'processing', attempts: job.attempts + 1 })
      .eq('id', job.id)
      .in('status', ['pending', 'failed'])
      .select('id');
    if (!claimed?.length) continue;

    try {
      const outcome = job.kind === 'lead_alert_email' ? await sendLeadAlert(job) : await syncToCrm(job);
      await db.from('q-quiz-outbox').update({ status: outcome, processed_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
      results[job.id] = outcome;
    } catch (e) {
      const backoffMin = 2 ** job.attempts;
      await db.from('q-quiz-outbox').update({
        status: 'failed',
        last_error: String((e as Error).message ?? e).slice(0, 1000),
        run_after: new Date(Date.now() + backoffMin * 60_000).toISOString(),
      }).eq('id', job.id);
      results[job.id] = 'failed';
    }
  }
  return new Response(JSON.stringify({ processed: Object.keys(results).length, results }), { headers: { 'Content-Type': 'application/json' } });
});

async function sendLeadAlert(job: Job): Promise<'sent' | 'skipped'> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('ALERT_FROM');
  if (!key || !from || !job.recipient) return 'skipped';
  const studio = Deno.env.get('STUDIO_URL') ?? '';
  const title = String(job.payload.title ?? 'New assessment lead');
  const body = String(job.payload.body ?? '');
  const link = job.response_id && studio ? `${studio}/responses/${job.response_id}` : '';
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [job.recipient],
      subject: title,
      html: `<div style="font-family:Arial,sans-serif;color:#1A1A2E">
        <h2 style="color:#2D2264;margin:0 0 8px">${esc(title)}</h2>
        <p style="margin:0 0 16px;color:#6B6B80">${esc(body)}</p>
        ${link ? `<a href="${esc(link)}" style="background:#00B2A9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">View response</a>` : ''}
      </div>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return 'sent';
}

async function syncToCrm(_job: Job): Promise<'sent' | 'skipped'> {
  // Future Salesforce handler:
  //  1. Load the response (+ assessment settings.crm).
  //  2. Map lead fields → Lead (FirstName, LastName, Email, Company, Title, Phone, State),
  //     plus settings.crm.field_map for custom fields, LeadSource = settings.crm.lead_source.
  //  3. Upsert by Email, optionally add to Campaign settings.crm.campaign_id.
  //  4. Update q-quiz-responses.crm_sync_status / crm_external_id / crm_synced_at.
  return 'skipped';
}
