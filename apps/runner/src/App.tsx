import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { parseDefinition, type AssessmentDefinition } from '@qq/schema';
import { buildSubmission } from '@qq/engine';
import { AssessmentExperience, Markdown, qualifactsLogo } from '@qq/ui';
import { getPublished, submitResponse, trackEvent, type PublishedAssessment } from './supabase';
import { getSessionId, once, readAttribution } from './attribution';

type Load =
  | { kind: 'loading' }
  | { kind: 'home' }
  | { kind: 'notfound' }
  | { kind: 'error'; message: string }
  | { kind: 'closed'; title: string; message: string | null }
  | { kind: 'ready'; meta: PublishedAssessment; def: AssessmentDefinition };

function slugFromPath(): string {
  return decodeURIComponent(window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] ?? '').toLowerCase();
}

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.content = content;
}

export function App() {
  const slug = useMemo(slugFromPath, []);
  const [load, setLoad] = useState<Load>(slug ? { kind: 'loading' } : { kind: 'home' });
  const sessionId = useMemo(() => (slug ? getSessionId(slug) : ''), [slug]);
  const attribution = useMemo(readAttribution, []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    getPublished(slug)
      .then((row) => {
        if (cancelled) return;
        if (!row) return setLoad({ kind: 'notfound' });
        if (!row.is_open || !row.definition) {
          return setLoad({ kind: 'closed', title: row.title, message: row.closed_message });
        }
        const parsed = parseDefinition(row.definition);
        if (!parsed.ok || !parsed.definition) {
          console.error(parsed.errors);
          return setLoad({ kind: 'error', message: 'This assessment is temporarily unavailable.' });
        }
        setLoad({ kind: 'ready', meta: row, def: parsed.definition });
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setLoad({ kind: 'error', message: 'We could not load this assessment. Please check your connection and try again.' });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Page title / description / view event
  useEffect(() => {
    if (load.kind !== 'ready') return;
    const { def, meta } = load;
    document.title = `${def.meta.title} | Qualifacts`;
    const desc = def.meta.description || def.intro.subheadline || 'A free self-assessment from Qualifacts.';
    setMeta('description', desc);
    setMeta('og:title', def.meta.title, 'property');
    setMeta('og:description', desc, 'property');
    if (def.theme.ogImageUrl) setMeta('og:image', def.theme.ogImageUrl, 'property');
    if (once(sessionId, 'view')) {
      trackEvent({ assessmentId: meta.assessment_id, versionId: meta.version_id, sessionId, type: 'view', meta: { source: attribution.source ?? null } });
    }
  }, [load, sessionId, attribution]);

  if (load.kind === 'loading') {
    return <Shell><div className="qq-card qq-card-center"><p className="qq-lede">Loading…</p></div></Shell>;
  }
  if (load.kind === 'home') {
    return (
      <Shell>
        <div className="qq-card qq-card-center">
          <h1 className="qq-h1" style={{ fontSize: 28 }}>Qualifacts Assessments</h1>
          <p className="qq-lede">Use the link you were sent to open your assessment.</p>
          <a className="qq-btn qq-btn-primary" href="https://www.qualifacts.com">Visit qualifacts.com</a>
        </div>
      </Shell>
    );
  }
  if (load.kind === 'notfound') {
    return (
      <Shell>
        <div className="qq-card qq-card-center">
          <h1 className="qq-h1" style={{ fontSize: 28 }}>Assessment not found</h1>
          <p className="qq-lede">Double-check the link you were sent, or contact your Qualifacts representative.</p>
          <a className="qq-btn qq-btn-primary" href="https://www.qualifacts.com">Visit qualifacts.com</a>
        </div>
      </Shell>
    );
  }
  if (load.kind === 'error') {
    return <Shell><div className="qq-card qq-card-center"><p className="qq-lede">{load.message}</p></div></Shell>;
  }
  if (load.kind === 'closed') {
    return (
      <Shell>
        <div className="qq-card qq-card-center">
          <div className="qq-badge">{load.title}</div>
          <h1 className="qq-h1" style={{ fontSize: 28 }}>This assessment is closed</h1>
          <Markdown className="qq-lede" text={load.message || 'Thanks for your interest. This assessment is no longer accepting responses.'} />
          <a className="qq-btn qq-btn-primary" href="https://www.qualifacts.com">Visit qualifacts.com</a>
        </div>
      </Shell>
    );
  }

  const { def, meta } = load;
  const base = { assessmentId: meta.assessment_id, versionId: meta.version_id, sessionId };

  return (
    <AssessmentExperience
      definition={def}
      mode="live"
      persistKey={`qq-state:${meta.slug}:${meta.version_id}`}
      onStart={() => trackEvent({ ...base, type: 'start' })}
      onAnswer={(qid) => once(sessionId, `answer:${qid}`) && trackEvent({ ...base, type: 'answer', questionId: qid })}
      onLeadFormView={() => trackEvent({ ...base, type: 'lead_form_view' })}
      onCtaClick={(label, url) => trackEvent({ ...base, type: 'cta_click', meta: { label, url } })}
      onProductClick={(productId) => trackEvent({ ...base, type: 'product_click', meta: { productId } })}
      onSubmit={async ({ answers, results, lead, consent, honeypot, startedAt }) => {
        const payload = buildSubmission({
          def,
          assessmentId: meta.assessment_id,
          versionId: meta.version_id,
          sessionId,
          answers,
          results,
          lead,
          consent,
          attribution,
          startedAt,
          honeypot,
        });
        await submitResponse(payload);
        trackEvent({ ...base, type: 'complete' });
      }}
      footer={<Footer />}
    />
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="qq-root">
      <header className="qq-topbar">
        <a className="qq-logo" href="https://www.qualifacts.com"><img src={qualifactsLogo} alt="Qualifacts" /></a>
      </header>
      <main className="qq-main"><div className="qq-screen">{children}</div></main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="qq-footer qq-no-print">
      © {new Date().getFullYear()} Qualifacts Systems, LLC ·{' '}
      <a href="https://www.qualifacts.com/privacy-policy/" target="_blank" rel="noopener noreferrer">Privacy</a>
    </footer>
  );
}
