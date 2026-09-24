import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBlankDefinition, slugify, type AssessmentDefinition } from '@qq/schema';
import { BUILT_IN_TEMPLATES } from '@qq/templates';
import { TopBar } from '../components/Layout';
import { Field, useToast } from '../components/ui';
import { supabase, T } from '../lib/supabase';
import { createAssessment, isSlugAvailable, readDefinition, uniqueSlug } from '../lib/assessments';
import { useAuth } from '../lib/auth';
import { publicUrl } from '../lib/format';
import type { AssessmentRow } from '../lib/types';

interface Choice {
  key: string;
  name: string;
  description: string;
  badge: string;
  make: () => AssessmentDefinition;
}

export function NewAssessmentPage() {
  const nav = useNavigate();
  const toast = useToast();
  const { canEdit, publicBaseUrl } = useAuth();
  const [teamTemplates, setTeamTemplates] = useState<AssessmentRow[]>([]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugOk, setSlugOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from(T.assessments).select('*').eq('is_template', true).then(({ data }) => setTeamTemplates((data as AssessmentRow[]) ?? []));
  }, []);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  useEffect(() => {
    if (!slug) return setSlugOk(null);
    const t = setTimeout(() => isSlugAvailable(slug).then(setSlugOk), 300);
    return () => clearTimeout(t);
  }, [slug]);

  const choices: Choice[] = [
    { key: 'blank', name: 'Blank assessment', description: 'Start from scratch with one section and one question.', badge: 'Blank', make: () => createBlankDefinition(title || 'Untitled assessment') },
    ...BUILT_IN_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      badge: t.scoringLabel,
      make: () => structuredClone(t.definition),
    })),
    ...teamTemplates.map((t) => ({
      key: t.id,
      name: t.title,
      description: t.description || 'Team template',
      badge: 'Team template',
      make: () => readDefinition(t.draft_definition) ?? createBlankDefinition(t.title),
    })),
  ];

  const pick = async (c: Choice) => {
    setChoice(c);
    const def = c.make();
    const t = c.key === 'blank' ? '' : def.meta.title;
    setTitle(t);
    setSlugTouched(false);
    if (t) setSlug(await uniqueSlug(t));
  };

  const create = async () => {
    if (!choice) return;
    if (!title.trim()) return toast.error('Give it a title.');
    if (!slug || slugOk === false) return toast.error('Choose an available link.');
    setBusy(true);
    try {
      const def = choice.make();
      def.meta.title = title.trim();
      if (!def.intro.headline || choice.key === 'blank') def.intro.headline = title.trim();
      const row = await createAssessment(def, { slug: slugify(slug) });
      nav(`/assessments/${row.id}`);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  if (!canEdit) {
    return (
      <>
        <TopBar title="New assessment" />
        <div className="s-page"><div className="card empty">Viewers can't create assessments. Ask an admin for editor access.</div></div>
      </>
    );
  }

  return (
    <>
      <TopBar title="New assessment" />
      <div className="s-page">
        <div className="card-title" style={{ marginBottom: 10 }}>1. Choose a starting point</div>
        <div className="grid grid-cards" style={{ marginBottom: 24 }}>
          {choices.map((c) => (
            <button
              key={c.key}
              className="a-card"
              style={{ textAlign: 'left', cursor: 'pointer', borderColor: choice?.key === c.key ? 'var(--teal)' : undefined, boxShadow: choice?.key === c.key ? '0 0 0 2px var(--teal)' : undefined, font: 'inherit' }}
              onClick={() => pick(c)}
            >
              <span className="pill pill-neutral" style={{ alignSelf: 'flex-start' }}>{c.badge}</span>
              <h3>{c.name}</h3>
              <span className="small muted">{c.description}</span>
            </button>
          ))}
          <div className="a-card" style={{ opacity: 0.6 }}>
            <span className="pill pill-neutral" style={{ alignSelf: 'flex-start' }}>Coming in phase 2</span>
            <h3>Generate with AI · Upload a document</h3>
            <span className="small muted">Describe your assessment or upload a draft questionnaire (Word, PDF, Excel), and Claude builds the first version for you.</span>
          </div>
        </div>

        {choice && (
          <div className="card" style={{ maxWidth: 640 }}>
            <div className="card-title">2. Name it</div>
            <Field label="Title" hint="Shown to prospects. You can change it later.">
              <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Revenue Cycle Health Check" />
            </Field>
            <Field
              label="Public link"
              hint={
                slugOk === false ? <span className="error-text">That link is taken.</span>
                : slug ? <span className="mono">{publicUrl(publicBaseUrl, slug)}</span>
                : 'Lowercase letters, numbers and dashes.'
              }
            >
              <input
                className="input mono"
                value={slug}
                onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-')); }}
                onBlur={() => setSlug((s) => slugify(s))}
              />
            </Field>
            <button className="btn btn-primary" disabled={busy || !title.trim() || !slug || slugOk === false} onClick={create}>
              {busy ? 'Creating…' : 'Create and open editor'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
