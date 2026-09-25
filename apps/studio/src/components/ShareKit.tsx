import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { copyText, publicUrl } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Field, useToast } from './ui';

/** Tracking-link builder + QR code + embed snippet for a published assessment. */
export function ShareKit({ slug, live }: { slug: string; live: boolean }) {
  const { publicBaseUrl, profile } = useAuth();
  const toast = useToast();
  const [src, setSrc] = useState('');
  const [rep, setRep] = useState('');
  const [campaign, setCampaign] = useState('');
  const [medium, setMedium] = useState('');
  const [qr, setQr] = useState<string>('');

  const url = useMemo(
    () => publicUrl(publicBaseUrl, slug, { src, rep, utm_campaign: campaign, utm_medium: medium }),
    [publicBaseUrl, slug, src, rep, campaign, medium],
  );
  const cleanUrl = publicUrl(publicBaseUrl, slug);

  useEffect(() => {
    QRCode.toDataURL(url, { width: 720, margin: 2, color: { dark: '#2D2264', light: '#FFFFFF' }, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  const downloadSvg = async () => {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 2, color: { dark: '#2D2264', light: '#FFFFFF' } });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = `${slug}${src ? `-${src}` : ''}-qr.svg`;
    a.click();
  };

  const embed = `<iframe src="${cleanUrl}?src=embed" title="Qualifacts assessment" style="width:100%;min-height:900px;border:0;" loading="lazy"></iframe>`;
  const myRep = profile?.email.split('@')[0] ?? '';

  return (
    <div className="stack">
      {!live && <div className="card small callout-warn">This assessment isn't live yet. Links will show "not found" until you publish.</div>}
      <Field label="Public link">
        <div className="link-box">
          <input className="input" readOnly value={cleanUrl} onFocus={(e) => e.target.select()} />
          <button className="btn btn-secondary" onClick={async () => (await copyText(cleanUrl)) && toast.ok('Link copied')}>Copy</button>
          <a className="btn btn-secondary" href={cleanUrl} target="_blank" rel="noreferrer">Open</a>
        </div>
      </Field>

      <div className="card subtle-box">
        <div className="card-title">Tracking link builder</div>
        <div className="card-sub">Tag links by event, channel, or rep so you can see where leads come from in Reports.</div>
        <div className="grid grid-2">
          <Field label="Source (src)" hint="e.g. acc2026, linkedin, email-nurture"><input className="input" value={src} onChange={(e) => setSrc(e.target.value.replace(/\s+/g, '-').toLowerCase())} /></Field>
          <Field label="Rep (rep)" hint={myRep ? <a href="#" onClick={(e) => { e.preventDefault(); setRep(myRep); }}>Use mine ({myRep})</a> : undefined}>
            <input className="input" value={rep} onChange={(e) => setRep(e.target.value.replace(/\s+/g, '').toLowerCase())} />
          </Field>
          <Field label="Campaign (utm_campaign)"><input className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} /></Field>
          <Field label="Medium (utm_medium)" hint="e.g. email, social, qr"><input className="input" value={medium} onChange={(e) => setMedium(e.target.value)} /></Field>
        </div>
        <div className="link-box">
          <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button className="btn btn-primary" onClick={async () => (await copyText(url)) && toast.ok('Tracking link copied')}>Copy</button>
        </div>
      </div>

      <div className="grid grid-2">
        <div>
          <div className="label" style={{ marginBottom: 6 }}>QR code (uses the tracking link above)</div>
          <div className="qr-box">{qr && <img src={qr} alt={`QR code for ${url}`} />}</div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <a className="btn btn-secondary btn-sm" href={qr} download={`${slug}${src ? `-${src}` : ''}-qr.png`}>Download PNG</a>
            <button className="btn btn-secondary btn-sm" onClick={downloadSvg}>Download SVG</button>
          </div>
          <p className="small muted">Tip: add <b>src=qr-booth</b> (or similar) before printing.</p>
        </div>
        <Field label="Embed on a web page" hint="Paste into qualifacts.com or a landing page.">
          <textarea className="textarea mono" rows={6} readOnly value={embed} onFocus={(e) => e.target.select()} />
          <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={async () => (await copyText(embed)) && toast.ok('Embed code copied')}>
            Copy embed code
          </button>
        </Field>
      </div>
    </div>
  );
}
