import { ACCENTS, BRAND_COLORS } from '@qq/schema';
import { Field, ImageField } from '../../components/ui';
import type { EditorProps } from './helpers';

const ACCENT_COLORS: Record<(typeof ACCENTS)[number], string> = {
  teal: BRAND_COLORS.teal,
  magenta: BRAND_COLORS.magenta,
  navy: BRAND_COLORS.navy,
  amber: BRAND_COLORS.amber,
};

export function BrandingTab({ def, update, readOnly }: EditorProps) {
  const t = def.theme;
  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="card">
        <div className="card-title">Brand</div>
        <div className="card-sub">Assessments always use the Qualifacts palette and Ekster typeface. Pick the accent for buttons and progress.</div>
        <Field label="Accent color">
          <div className="row">
            {ACCENTS.map((a) => (
              <button type="button" key={a} className={`btn ${t.accent === a ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => update((d) => { d.theme.accent = a; })}
                style={{ borderColor: t.accent === a ? 'var(--navy)' : undefined }}>
                <span className="swatch" style={{ background: ACCENT_COLORS[a], width: 18, height: 18 }} /> {a[0].toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
        </Field>
        <ImageField label="Logo override (optional)" folder="logos" hint="Defaults to the Qualifacts logo." value={t.logoUrl} onChange={(v) => update((d) => { d.theme.logoUrl = v; })} />
        <ImageField label="Product co-brand logo (optional)" folder="logos" hint="e.g. InSync, CareLogic, Credible, Streamline. Shown top-right." value={t.coBrandLogoUrl} onChange={(v) => update((d) => { d.theme.coBrandLogoUrl = v; })} />
        <ImageField label="Social share image (optional)" folder="og" hint="1200×630. Saved now; Teams/LinkedIn link previews will use it once server-side link previews ship (phase 2)." value={t.ogImageUrl} onChange={(v) => update((d) => { d.theme.ogImageUrl = v; })} />
      </div>
    </fieldset>
  );
}
