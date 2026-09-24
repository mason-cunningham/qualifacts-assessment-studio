import { useEffect, useState, type ReactNode } from 'react';
import type { AssessmentDefinition, LeadValues } from '@qq/schema';
import { buildMergeContext, formatScore, renderTemplate, type AssessmentResults } from '@qq/engine';
import { Markdown } from './Markdown';

const GREY = '#B8B8C4';

export function ScoreRing({ pct, color, children }: { pct: number; color: string; children: ReactNode }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const [offset, setOffset] = useState(c);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOffset(c - (Math.max(0, Math.min(100, pct)) / 100) * c));
    return () => cancelAnimationFrame(id);
  }, [pct, c]);
  return (
    <div className="qq-ring">
      <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#E0D9D2" strokeWidth="10" />
        <circle
          className="qq-ring-arc"
          cx="70" cy="70" r={r}
          fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
        />
      </svg>
      <div className="qq-ring-inner">{children}</div>
    </div>
  );
}

export interface ResultsViewProps {
  definition: AssessmentDefinition;
  results: AssessmentResults;
  lead?: LeadValues;
  onRetake?: () => void;
  /** Hide print/retake (e.g. Studio response detail) */
  hideActions?: boolean;
  saveWarning?: string | null;
  onCtaClick?: (label: string, url: string) => void;
  onProductClick?: (productId: string) => void;
}

export function ResultsView({ definition: def, results: r, lead = {}, onRetake, hideActions, saveWarning, onCtaClick, onProductClick }: ResultsViewProps) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const ctx = buildMergeContext(def, r, lead);
  const t = (s?: string) => renderTemplate(s, ctx);
  const res = def.results;
  const productName = new Map(def.products.map((p) => [p.id, p.name]));

  const actions = !hideActions && (res.allowPdf || (res.allowRetake && onRetake)) && (
    <div className="qq-actions">
      {res.allowPdf && (
        <button type="button" className="qq-btn qq-btn-ghost" onClick={() => window.print()}>
          Download / Print Results
        </button>
      )}
      {res.allowRetake && onRetake && (
        <button type="button" className="qq-link" onClick={onRetake}>Retake assessment</button>
      )}
    </div>
  );

  const ctas = (res.primaryCta?.label || res.secondaryCta?.label) && (
    <div className="qq-actions qq-no-print-keep">
      {res.primaryCta?.label && (
        <a className="qq-btn qq-btn-cta" href={res.primaryCta.url} target="_blank" rel="noopener noreferrer"
           onClick={() => onCtaClick?.(res.primaryCta!.label, res.primaryCta!.url)}>
          {t(res.primaryCta.label)}
        </a>
      )}
      {res.secondaryCta?.label && (
        <a className="qq-btn qq-btn-ghost" href={res.secondaryCta.url} target="_blank" rel="noopener noreferrer"
           onClick={() => onCtaClick?.(res.secondaryCta!.label, res.secondaryCta!.url)}>
          {t(res.secondaryCta.label)}
        </a>
      )}
    </div>
  );

  if (res.thankYouOnly || def.scoring.method === 'none') {
    return (
      <div className="qq-screen">
        {saveWarning && <div className="qq-warning">{saveWarning}</div>}
        <div className="qq-card qq-card-center qq-elevated">
          <div className="qq-check">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--qq-accent)' }} />
            </svg>
          </div>
          <h1 className="qq-h1" style={{ fontSize: 30 }}>{t(res.thankYouHeadline)}</h1>
          <Markdown className="qq-lede" text={t(res.thankYouBody)} />
          <Markdown className="qq-prose" text={t(res.body)} />
          {ctas}
          {res.footerNote && <p className="qq-footnote">{t(res.footerNote)}</p>}
        </div>
      </div>
    );
  }

  const tierColor = r.tier?.color ?? 'var(--qq-accent)';
  const ringPct = def.scoring.display === 'points' ? (r.max ? (r.points / r.max) * 100 : 0) : r.pct ?? 0;
  const denom =
    def.scoring.method === 'gaps'
      ? `${r.countedCount - r.gapCount} of ${r.countedCount} areas on track`
      : def.scoring.display === 'points'
        ? `out of ${Math.round(r.max * 100) / 100}`
        : '';
  const scoreText = formatScore(def, r);

  const sections = r.sections.filter((s) => {
    const d = def.sections.find((x) => x.id === s.sectionId);
    return s.hasScoredQuestions && (d?.showInResults ?? true);
  });

  const guidanceParts = [r.tier?.body ? t(r.tier.body) : '', res.showInsights && r.insight ? t(r.insight.body) : ''].filter(Boolean);
  const recs = r.recommendations;

  return (
    <div className="qq-screen qq-screen-wide">
      {saveWarning && <div className="qq-warning">{saveWarning}</div>}

      <div className="qq-card qq-card-center">
        <div className="qq-eyebrow">{t(res.eyebrow)}</div>
        {res.showScore && (
          <ScoreRing pct={ringPct} color={tierColor}>
            <div className="qq-score">
              {scoreText.endsWith('%') ? (<>{scoreText.slice(0, -1)}<small>%</small></>) : scoreText}
            </div>
            {denom && <div className="qq-score-denom">{denom}</div>}
          </ScoreRing>
        )}
        {r.tier && <h2 className="qq-tier" style={{ color: tierColor }}>{r.tier.label}</h2>}
        <Markdown className="qq-tier-summary" text={res.headline ? t(res.headline) : t(r.tier?.summary)} />
      </div>

      {guidanceParts.length > 0 && (
        <div className="qq-card">
          <h2 className="qq-h2">{t(res.insightsHeading)}</h2>
          {guidanceParts.map((g, i) => <Markdown key={i} className="qq-prose" text={g} />)}
        </div>
      )}

      {res.body && (
        <div className="qq-card"><Markdown className="qq-prose" text={t(res.body)} /></div>
      )}

      {res.showSectionBreakdown && sections.length > 0 && (
        <div className="qq-card">
          <h2 className="qq-h2">{t(res.sectionBreakdownHeading)}</h2>
          <div className="qq-sections">
            {sections.map((s) => {
              const color = s.pct === null ? GREY : s.tier?.color ?? tierColor;
              const solved = s.productIds.map((id) => productName.get(id)).filter(Boolean).join(', ');
              const gaps = s.items.filter((i) => i.isGap);
              return (
                <div className="qq-section-card" key={s.sectionId}>
                  <div className="qq-section-top">
                    <span className="qq-section-name">{s.name}</span>
                    <span className="qq-section-score" style={{ color }}>
                      {s.pct === null ? 'Not Currently Applicable' : s.tier?.label ? `${s.tier.label} · ${s.pct}%` : `${s.pct}%`}
                    </span>
                  </div>
                  {solved && <div className="qq-section-solved">Solved by: {solved}</div>}
                  <div className="qq-bar-track">
                    <div className="qq-bar-fill" style={{ width: `${s.pct ?? 100}%`, background: color }} />
                  </div>
                  {s.pct === null ? (
                    <div className="qq-na">
                      Not currently applicable based on your answer{s.gateAnswerLabel ? ` ("${s.gateAnswerLabel}")` : ''}. Worth revisiting if that changes.
                    </div>
                  ) : (
                    s.tier?.body && <div className="qq-section-interp">{t(s.tier.body)}</div>
                  )}
                  {res.showGapList && gaps.length > 0 && (
                    <ul className="qq-gaps">
                      {gaps.map((g) => (
                        <li key={g.questionId} className={g.counted ? '' : 'qq-monitor'}>
                          {g.shortLabel}: {g.answerLabel}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {res.showRecommendations && def.recommendations.enabled && (
        <div className="qq-card">
          <h2 className="qq-h2">{t(def.recommendations.heading)}</h2>
          {recs.length === 0 ? (
            <Markdown className="qq-prose" text={t(def.recommendations.emptyMessage) || "You're already covering every area we checked."} />
          ) : (
            <>
              <Markdown className="qq-prose" text={t(def.recommendations.intro)} />
              <div className="qq-recs" style={{ marginTop: 16 }}>
                {recs.map((rec) => {
                  const p = rec.product;
                  const ctaLabel = p.ctaLabel || def.recommendations.ctaLabel;
                  return (
                    <div className={`qq-rec ${p.imageUrl ? '' : 'qq-no-media'}`} key={rec.productId}>
                      {p.imageUrl && (
                        <div className="qq-rec-media">
                          <img src={p.imageUrl} alt={`${p.name} screenshot`} loading="lazy" onClick={() => setLightbox(p.imageUrl!)} />
                        </div>
                      )}
                      <div className="qq-rec-body">
                        {rec.badge && <span className={`qq-rec-badge ${rec.rank > 0 ? 'qq-alt' : ''}`}>{rec.badge}</span>}
                        {p.productLine && <div className="qq-rec-line">{p.productLine}</div>}
                        <h3 className="qq-rec-name">{p.name}</h3>
                        {p.tagline && <p className="qq-rec-what"><strong>{p.tagline}</strong></p>}
                        {p.whatItDoes && <p className="qq-rec-what">{p.whatItDoes}</p>}
                        {p.whyItMatters && (
                          <>
                            <div className="qq-rec-why-label">Why it matters</div>
                            <p className="qq-rec-why">{p.whyItMatters}</p>
                          </>
                        )}
                        {p.benefits.length > 0 && (
                          <ul className="qq-rec-benefits">{p.benefits.map((b, bi) => <li key={bi}>{b}</li>)}</ul>
                        )}
                        {ctaLabel && p.ctaUrl && (
                          <a className="qq-btn qq-btn-cta qq-no-print" href={p.ctaUrl} target="_blank" rel="noopener noreferrer"
                             onClick={() => onProductClick?.(p.id)} style={{ fontSize: 14, padding: '12px 22px' }}>
                            {ctaLabel}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {ctas}
      {res.footerNote && <p className="qq-footnote">{t(res.footerNote)}</p>}
      {actions}

      {lightbox && (
        <div className="qq-lightbox" role="dialog" aria-label="Screenshot" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  );
}
