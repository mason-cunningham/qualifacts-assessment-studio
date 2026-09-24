import { useEffect, useState } from 'react';
import { slugify } from '@qq/schema';
import { Check, Field, TextArea, TextInput, useToast } from '../../components/ui';
import { ShareKit } from '../../components/ShareKit';
import { supabase, T } from '../../lib/supabase';
import { displayName, useAuth } from '../../lib/auth';
import { isSlugAvailable } from '../../lib/assessments';
import { fmtDate, publicUrl } from '../../lib/format';
import { PRODUCT_LINES, type AssessmentRow, type Profile, type VersionRow } from '../../lib/types';
import type { EditorProps } from './helpers';

export function SettingsTab({ def, update, readOnly, row, saveRow, onRestore }: EditorProps & {
  row: AssessmentRow;
  saveRow: (patch: Partial<AssessmentRow>) => Promise<boolean>;
  onRestore: (v: VersionRow) => void;
}) {
  const toast = useToast();
  const { publicBaseUrl, isAdmin } = useAuth();
  const [people, setPeople] = useState<Profile[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [slug, setSlug] = useState(row.slug);
  const [recipients, setRecipients] = useState((row.settings.alerts?.extra_recipients ?? []).join(', '));
  const settings = row.settings;

  useEffect(() => {
    supabase.from(T.profiles).select('id,email,full_name,role,is_active').eq('is_active', true).order('full_name')
      .then(({ data }) => setPeople((data as Profile[]) ?? []));
  }, []);
  useEffect(() => {
    supabase.from(T.versions).select('id,assessment_id,version_number,change_note,published_by,published_at').eq('assessment_id', row.id).order('version_number', { ascending: false })
      .then(({ data }) => setVersions((data as VersionRow[]) ?? []));
  }, [row.id, row.published_version_id]);
  useEffect(() => setSlug(row.slug), [row.slug]);

  const everPublished = !!row.published_version_id;
  const saveSettings = (patch: Partial<typeof settings>) => saveRow({ settings: { ...settings, ...patch } });

  const saveSlug = async () => {
    const s = slugify(slug);
    if (!s || s === row.slug) return setSlug(row.slug);
    if (!(await isSlugAvailable(s, row.id))) {
      toast.error(`"${s}" is already taken.`);
      return setSlug(row.slug);
    }
    if (await saveRow({ slug: s })) toast.ok('Link updated');
  };

  const restore = async (v: VersionRow) => {
    if (!window.confirm(`Replace the current draft with version ${v.version_number}? The live version isn't affected until you publish.`)) return;
    const { data, error } = await supabase.from(T.versions).select('*').eq('id', v.id).single();
    if (error) return toast.error(error);
    onRestore(data as VersionRow);
  };

  return (
    <>
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="card">
        <div className="card-title">Basics</div>
        <Field label="Title (shown to prospects)"><TextInput value={def.meta.title} onChange={(v) => update((d) => { d.meta.title = v; })} /></Field>
        <Field label="Description" hint="Used for the page description and in the dashboard.">
          <TextArea rows={2} value={def.meta.description} onChange={(v) => update((d) => { d.meta.description = v || undefined; })} />
        </Field>
        <div className="grid grid-2">
          <Field label="Product line">
            <select className="select" value={def.meta.productLine ?? ''} onChange={(e) => update((d) => { d.meta.productLine = e.target.value || undefined; })}>
              <option value="">—</option>
              {PRODUCT_LINES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Internal name (optional)" hint="Only visible in Studio, e.g. 'ACC 2026 booth version'.">
            <input className="input" defaultValue={row.internal_name ?? ''} onBlur={(e) => e.target.value !== (row.internal_name ?? '') && saveRow({ internal_name: e.target.value || null })} />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Public link</div>
        <Field
          label="Link"
          hint={everPublished ? 'Locked because this assessment has been published. Changing it would break links and QR codes already shared.' : publicUrl(publicBaseUrl, slugify(slug) || row.slug)}
        >
          <div className="row">
            <span className="muted mono">{publicBaseUrl}/</span>
            <input className="input mono" value={slug} disabled={everPublished && !isAdmin}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))} onBlur={saveSlug} />
          </div>
        </Field>
        {everPublished && isAdmin && <p className="small muted">As an admin you can still change it. Anything already shared will stop working.</p>}
      </div>

      <div className="card">
        <div className="card-title">Ownership & lead alerts</div>
        <div className="card-sub">New responses create an alert for the owner (the bell in Studio). Email alerts switch on once email sending is configured.</div>
        <div className="grid grid-2">
          <Field label="Owner">
            <select className="select" value={row.owner_id ?? ''} onChange={(e) => saveRow({ owner_id: e.target.value || null })}>
              <option value="">—</option>
              {people.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
            </select>
          </Field>
          <div style={{ paddingTop: 24 }}>
            <Check checked={settings.alerts?.enabled !== false} onChange={(v) => saveSettings({ alerts: { ...settings.alerts, enabled: v } })} label="Alert the owner about new responses" />
          </div>
        </div>
        <Field label="Also email (when email alerts are on)" hint="Comma-separated addresses.">
          <input className="input" value={recipients} onChange={(e) => setRecipients(e.target.value)}
            onBlur={() => saveSettings({ alerts: { ...settings.alerts, extra_recipients: recipients.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) } })} />
        </Field>
      </div>

      <div className="card">
        <div className="card-title">Availability</div>
        <div className="grid grid-2">
          <Field label="Close automatically on" hint="After this, the link shows the closed message.">
            <input type="datetime-local" className="input" value={row.closes_at ? toLocalInput(row.closes_at) : ''}
              onChange={(e) => saveRow({ closes_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </Field>
          <Field label="Response limit (optional)">
            <input type="number" min={1} className="input" defaultValue={settings.response_cap ?? ''}
              onBlur={(e) => saveSettings({ response_cap: e.target.value ? Number(e.target.value) : null })} />
          </Field>
        </div>
        <Field label="Closed message" hint="Shown when paused, closed, or at the response limit.">
          <textarea className="textarea" rows={2} defaultValue={settings.closed_message ?? ''} placeholder="Thanks for your interest. This assessment is no longer accepting responses."
            onBlur={(e) => e.target.value !== (settings.closed_message ?? '') && saveSettings({ closed_message: e.target.value || undefined })} />
        </Field>
        <Check checked={row.is_template} onChange={(v) => saveRow({ is_template: v })} label="Offer this as a team template when creating new assessments" />
      </div>

      <div className="card">
        <div className="card-title">Salesforce (coming later)</div>
        <div className="card-sub">When the Salesforce integration is switched on, responses from this assessment can create Leads automatically.</div>
        <Check checked={!!settings.crm?.enabled} onChange={(v) => saveSettings({ crm: { ...settings.crm, enabled: v } })} label="Sync responses from this assessment to Salesforce (once enabled)" />
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <Field label="Lead Source"><input className="input" defaultValue={settings.crm?.lead_source ?? 'Assessment'} onBlur={(e) => saveSettings({ crm: { ...settings.crm, lead_source: e.target.value } })} /></Field>
          <Field label="Campaign ID (optional)"><input className="input mono" defaultValue={settings.crm?.campaign_id ?? ''} onBlur={(e) => saveSettings({ crm: { ...settings.crm, campaign_id: e.target.value || null } })} /></Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Version history</div>
        {versions.length === 0 ? <p className="muted">Not published yet.</p> : (
          <table className="table">
            <thead><tr><th>Version</th><th>Published</th><th>By</th><th>Note</th><th /></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>v{v.version_number} {v.id === row.published_version_id && <span className="pill pill-published">Live</span>}</td>
                  <td>{fmtDate(v.published_at, true)}</td>
                  <td>{displayName(people.find((p) => p.id === v.published_by))}</td>
                  <td className="small">{v.change_note}</td>
                  <td style={{ textAlign: 'right' }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => restore(v)}>Restore to draft</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </fieldset>
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">Share</div>
      <ShareKit slug={row.slug} live={row.status === 'published'} />
    </div>
    </>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
