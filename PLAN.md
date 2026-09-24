# Qualifacts Assessment Studio — Build Plan

An internal platform where Qualifacts marketing, product and CS teams create, publish and analyze
branded customer and prospect assessments without a developer.

Reference builds analyzed: Eligibility Health Check, InSync Operational Assessment,
CES Health Check, Patient Payment Posting Survey (all in `Downloads/index (5–8).html`).

---

## 1. What the four existing assessments tell us

| Assessment | Scoring model | Special mechanics |
|---|---|---|
| Eligibility Health Check | Points per option (1–3), section + overall %, 4 tiers | Standard sections |
| InSync Operational Assessment | Binary gap flags per option; modules map to add-ons | Gate questions: **soft** (ask, but score as "monitor") and **hard** (skip follow-ups); optional open-ended question |
| CES Health Check | Points 0/5/10; each question maps to a **feature card** | Feature library with images, "what it does / why turn it on / benefits"; recommendations ordered by impact |
| Payment Posting Survey | **No score**: pure survey | Dropdowns, 1–5 rating scales, "Other" with free text, optional email at the start |

Shared across all four: Qualifacts palette and Ekster font, intro → questions → lead form → results,
progress bar, back button, print/download results, retake, and a raw-fetch insert into one Supabase
table per assessment.

**Design consequence:** one config-driven engine has to handle points, gaps, unscored surveys,
branching/gates, and product recommendations. If it can faithfully reproduce all four, it covers
the team's needs. Migrating those four is the MVP acceptance test.

---

## 2. Architecture

```
                ┌──────────────────────────── Supabase (thjclunkjqnknsozlyyj) ───────────────────────────┐
                │  Auth (Microsoft Entra SSO, @qualifacts.com only)                                       │
                │  Postgres: q-quiz-* tables + RLS + RPCs      Storage: q-quiz-assets / q-quiz-imports    │
                │  Edge Functions: ai-assist · notify-lead · (later) crm-sync                             │
                └───────────────▲──────────────────────────────────────────────▲───────────────────────┘
                                │ authenticated (staff)                        │ anon (prospects, RPC only)
        ┌───────────────────────┴───────────┐                ┌─────────────────┴──────────────────┐
        │  STUDIO (internal)                │                │  RUNNER (public)                    │
        │  studio.assess.qualifacts.com     │  publish =     │  assess.qualifacts.com/{slug}       │
        │  Editor · Dashboard · Reports ·   │  DB write,     │  Loads published version by slug,   │
        │  Products library · AI assistant  │  no deploy ──▶ │  renders + scores, submits via RPC  │
        └───────────────────────────────────┘                └─────────────────────────────────────┘
```

**Stack**
- **Frontend:** React + TypeScript + Vite, one monorepo with two apps plus shared packages:
  - `apps/studio`: internal tool (auth required)
  - `apps/runner`: public assessment site (small bundle, no admin code)
  - `packages/engine`: the scoring, branching and recommendation logic, used by both apps so
    Preview scores exactly as live does
  - `packages/ui`: Qualifacts-branded components (the question card, results page, etc.)
  - `packages/schema`: TypeScript types + JSON Schema for the assessment definition (also used to
    validate AI output)
- **Hosting:** Netlify (already in use), with 2 sites from one repo.
- **Data:** Supabase Postgres, Storage and Edge Functions. The publishable key
  (`sb_publishable_…`) is safe in the browser. The **secret/service-role key and the Anthropic API
  key live only in Edge Function secrets**, never in frontend code.
- **Libraries:** SheetJS (`xlsx`) for Excel export; Recharts for dashboard charts; dnd-kit for
  drag-and-drop reordering; TipTap for rich text on results and descriptions; `qrcode` for booth QR codes.

---

## 3. How a live URL works

**No deploy per assessment.** The runner is a single, permanently deployed site. Publishing is a
database write:

1. An editor clicks **Publish** in Studio.
2. Studio validates the draft, resolves product references into snapshots, and calls
   `q_quiz_publish()`, which creates an immutable version and flips the status to `published`.
3. `https://assess.qualifacts.com/eligibility-health-check` is live immediately. The runner calls
   `q_quiz_get_published('eligibility-health-check')` and renders it.

Details:
- **Custom domain:** request `assess.qualifacts.com` (and optionally `studio.assess.qualifacts.com`)
  from IT as CNAMEs to Netlify. Until then, use `qualifacts-assess.netlify.app/{slug}`.
- **Slugs** are unique, editable before first publish, and locked after (with an optional redirect
  table later).
- **Pause / close:** set a status or close date. The URL stays up and shows a branded "This assessment
  is closed" message with a CTA instead of a 404.
- **Edits to a live assessment** stay in the draft until re-published. Every response records the
  version it was scored against.
- **Link previews** (Teams, LinkedIn, email): a Netlify Edge Function injects each assessment's
  title, description and OG image into the HTML so shared links unfurl properly.
- **Share kit** per assessment, generated in Studio:
  - Copy-link with tracking builder (`?src=acc2026&rep=jsmith&utm_campaign=…`)
  - QR code PNG/SVG for booths and print
  - iframe embed snippet for qualifacts.com pages
- **Legacy sites:** after each of the four is migrated, replace that Netlify site with a
  `_redirects` 301 to its new slug so existing links keep working.
- **Standalone HTML export** (optional, phase 3) for the rare case that needs a self-contained
  file. It is not the default.

Side benefit: the runner fetches its config at runtime, so the Mimecast URL-rewrite problem you hit
(documented in the InSync file) can't corrupt a deploy.

---

## 4. Assessment definition (the heart of the system)

Everything a user can customize lives in one versioned JSON document. The editor edits it, the AI
generates it, import produces it, the runner renders it, and the engine scores it.

```ts
AssessmentDefinition {
  schemaVersion: 1
  meta:     { title, subtitle, productLine, estimatedMinutes, audience: 'prospect'|'customer' }
  theme:    { accent: 'teal'|'magenta'|'navy'|'amber', logoUrl, coBrandLogoUrl, heroImageUrl,
              ogImageUrl }                           // constrained to brand palette
  intro:    { eyebrow, headline, body(rich), bullets[], imageUrl, startLabel,
              collectEmailUpfront: 'off'|'optional'|'required' }

  sections: [{ id, name, description, weight, scored: boolean, productIds[],
               naBehavior: 'exclude'|'monitor' }]   // "monitor" = InSync soft-gate behavior

  questions: [{
    id, sectionId,
    type: 'single'|'multi'|'dropdown'|'rating'|'yesno'|'text'|'longtext'|'number',
    text, helpText, shortLabel,           // shortLabel = column header in exports + results
    required, scored, weight, imageUrl,
    role: 'scored'|'gate'|'segment'|'info',  // segment = firmographic (org type, role…)
    options: [{ id, label, points, isGap, notApplicable,
                allowOtherText, recommendProductIds[] }],
    scale:  { min, max, minLabel, maxLabel, pointsMap? },   // rating questions
    showIf: { all|any: [{ questionId, op: 'in'|'notIn'|'gte'|'lte'|'answered', value }] }
  }]

  scoring: {
    method: 'points'|'gaps'|'none',
    overallFormula: 'weightedSections'|'allQuestions',
    tiers:        [{ id, min, max, label, color, headline, body(rich), ctaLabel, ctaUrl }],
    sectionTiers: [{ id, min, max, label, color }]    // e.g. Optimized / Minor Gaps / …
  }

  recommendations: {
    rules: [{ productId, priority,
              when: { sectionBelow: {sectionId, pct} }
                  | { optionSelected: {questionId, optionIds[]} }
                  | { gapCountAtLeast: {sectionId?, n} } }],
    maxShown, layout: 'cards'|'list', heading, intro
  }

  leadCapture: {
    position: 'beforeResults'|'beforeQuestions'|'afterResults'|'off',
    fields: [{ key, label, type, required, options? }],   // first/last/email/org/title/phone/state + custom
    consentText, privacyUrl, submitLabel
  }

  results: {
    showOverallScore, showSectionBreakdown, showRecommendations, showAnswerReview,
    headline, body(rich),                   // supports {{score}}, {{tier}}, {{firstName}}, {{organization}}
    blocks: [ ...ordered content blocks: text | callout | sectionScores | recommendations | cta | image ],
    primaryCta: { label, url },             // e.g. "Talk to your account team" / booking link
    allowPdfDownload, allowRetake,
    thankYouOnly: boolean                   // for pure surveys
  }

  products: [ ProductSnapshot ]             // filled at publish from q-quiz-products
}
```

How each existing assessment maps onto it:
- **Eligibility:** `method: points`, options scored 1–3, sections, 4 tiers.
- **InSync:** `method: gaps`; the gate questions become `role: gate`. Hard gates use `showIf` on the
  follow-ups; soft gates use `naBehavior: 'monitor'`. The open-ended question is `longtext`,
  unscored.
- **CES:** `method: points` (0/5/10) with `optionSelected` rules → feature cards; product `priority`
  replaces `impact`.
- **Payment Posting:** `method: none`, `segment` dropdowns, `rating` 1–5, `allowOtherText`,
  `collectEmailUpfront: 'optional'`, `thankYouOnly`.

---

## 5. Studio features

### 5.1 Dashboard (home)
- Cards and a table of every assessment: status pill (Draft / Live / Paused / Archived), owner,
  responses (total / last 30 days), completion rate, average score, last response, and quick
  actions (Open, Copy link, QR, Duplicate, Pause).
- Filters: mine / all, product line, status. Search.
- A "New assessment" button that offers four paths (see 5.3).

### 5.2 Assessment editor
Three-pane layout: **outline** (sections and questions, drag-to-reorder) | **editor panel** |
**live preview** (the real runner in an iframe, with desktop/mobile toggle and "jump to results
with sample answers").

Tabs:
1. **Content:** intro screen, sections, questions, options, help text, images, branching rules
   (visual "Show this question only if…" builder).
2. **Scoring:** method, points per option in a grid view (question × option → points, gap flag),
   section weights, tier bands with a visual 0–100 bar that highlights gaps or overlaps between
   bands. Includes a **score simulator**: pick answers or click "best case / worst case / random 100"
   to see score distribution and confirm every tier is reachable.
3. **Results page:** block-based builder for headline, body, section breakdown, recommendations,
   CTA and images. Tier-specific copy. Merge tags.
4. **Solutions:** attach products from the shared library and define recommendation rules
   ("recommend Grants Module when Grant Management < 60%" or "when Q7 = Manual").
5. **Lead form:** position, fields, required flags, consent text.
6. **Branding:** accent color (brand palette only), logos including product co-brand (InSync,
   CareLogic, Credible, Streamline…), hero and OG images.
7. **Settings and publish:** slug, notification recipients, close date, response cap, closed
   message, version history with diff and rollback, and the share kit.

Autosave to `draft_definition`, undo/redo, and a **pre-publish checklist**: every scored question
has points, tiers cover 0–100, referenced products exist, required copy is filled, no orphaned
`showIf` references, and the slug is available.

### 5.3 Four ways to create
1. **Start blank.**
2. **From template:** the four migrated assessments, plus admin-curated templates
   (`is_template = true`).
3. **Upload:**
   - **Structured:** a CSV/XLSX template (one row per option: section, question, type, option,
     points, gap, product) or JSON. Parsed client-side, no AI needed.
   - **Unstructured:** a Word doc, PDF, PowerPoint or pasted text of a draft questionnaire. It goes
     to the AI, which returns a full definition.
4. **Generate with AI:** a short brief form (topic, audience, product line, number of questions,
   scoring style, products to feature, tone). The AI returns a complete draft that the user then
   edits.

### 5.4 AI assistant (Anthropic API)
- **Server-side only:** a Supabase Edge Function `ai-assist` holds `ANTHROPIC_API_KEY`, verifies
  the caller is staff, logs to `q-quiz-ai-requests`, and returns JSON validated against
  `packages/schema` (invalid output is retried or its errors surfaced).
- **Modes:**
  - `generate`: build a full assessment from a brief.
  - `import`: convert an uploaded document to a definition. PDFs are sent natively; DOCX, PPTX and
    XLSX are text-extracted first.
  - `rewrite`: rewrite a question for clarity, tone or reading level; also "make these options
    mutually exclusive".
  - `options`: suggest answer options with points weights and gap flags.
  - `results_copy`: draft tier headlines and body copy, and recommendation blurbs.
  - `map_products`: suggest which library products solve which sections or answers.
  - `review`: critique the whole assessment (leading questions, overlapping tiers, too long, jargon).
- **Context:** every call includes Qualifacts brand voice guidance, BH industry context, and the
  product library, so suggestions reference real products and never invent them.
- **Models:** start with Sonnet 5 for most calls and Opus 5.5 for full generation and import.
  Confirm current model IDs, pricing and structured-output support when building.
- **UX:** inline sparkle buttons on each field ("✨ Improve", "✨ Suggest options") plus a side chat
  panel that proposes changes as a diff the user accepts or rejects.

### 5.5 Solutions library
A shared catalog (`q-quiz-products`): name, product line, category, what it does, why it matters,
benefits, screenshot, logo and CTA. It is maintained once and reused across assessments, seeded
from the CES feature library and the InSync add-ons. Changes reach live assessments on their next
publish.

### 5.6 Responses and reports
- **Per-assessment analytics:**
  - Funnel: views → starts → lead form → completes, with drop-off by question.
  - Score histogram, tier breakdown and section averages.
  - Per-question answer distribution (bar charts built from the `q-quiz-response-answers` view).
  - Trend over time, and breakdown by `source` / `rep_code` / UTM.
- **Responses table:** filter by date, tier, score range, source, follow-up status, text search.
  Clicking a row opens the **exact results page the prospect saw** (rendered from their version)
  plus their answers, notes, follow-up status and assignee.
- **Export (CSV and Excel):**
  - **Wide:** one row per response; columns for lead fields, scores, tier, each section, then each
    question (using `shortLabel` as the header).
  - **Long:** one row per answer.
  - The Excel workbook has 3 sheets (Summary, Responses, Answers), branded header row, and frozen
    panes.
  - Exports respect current filters and exclude test submissions by default.
- **Cross-assessment "All leads" report,** for handing off to sales.

### 5.7 Notifications and integrations
- **New-lead alerts:** a database webhook on `q-quiz-responses` insert triggers the Edge Function
  `notify-lead`, which emails the configured recipients (via Resend or M365) and optionally posts
  to a Teams channel, including score, tier, top gaps and a link to the response.
- **Prospect email copy** of their results (optional per assessment).
- **Phase 3:** Salesforce/HubSpot sync (whichever CRM Qualifacts uses) and a generic outbound
  webhook.

### 5.8 Admin
User list (roles: admin / editor / viewer, deactivate), template curation, AI usage view and
brand defaults.

---

## 6. Runner (prospect experience)

Ported from your existing UI so it looks exactly like today's assessments. The engine generalizes
the logic.

- Screens: intro → questions (fade transitions, progress bar showing "Module 2 of 5", back button,
  branching-aware "3 of 17") → lead form → results → optional thank-you.
- Results: overall score dial, tier headline and body, section bars with section tiers,
  recommendation cards (image, what it does, benefits, CTA), primary CTA, download/print PDF,
  retake.
- Resilience: answers are saved to `sessionStorage` so a refresh doesn't lose progress. If
  submission fails, results still show (matching today's behavior). A honeypot field provides spam
  protection, with Cloudflare Turnstile available later if needed.
- Tracking: `session_id` plus funnel events via `q_quiz_track_event`. URL params (`src`, `rep`,
  `utm_*`) are captured.
- Accessibility (WCAG 2.1 AA) and mobile-first design. Radio groups are keyboard-navigable.
- Staff preview mode (`?preview=1` while signed in) renders the draft and flags submissions as
  `is_test`.

---

## 7. Branding

Pulled from the existing assessments. These become design tokens in `packages/ui`:

| Token | Value | Use |
|---|---|---|
| `--teal` / `--teal-dk` | `#00B2A9` / `#008F87` | Primary actions, top tier |
| `--navy` | `#2D2264` | Headings, header |
| `--magenta` / `--magenta-dk` | `#C6007E` / `#A0006A` | Accent, lower tiers |
| `--amber` | `#E8A317` | Middle tier, highlights |
| `--bg` | `#F5F0EB` | Warm cream page background |
| `--text` / `--text-muted` | `#1A1A2E` / `#6B6B80` | Body copy |
| `--border` | `#E0D9D2` | Dividers, cards |
| Font | **Ekster** (400/700/800) | Everything |

- Tier color defaults: teal → amber → magenta → dark magenta (as in InSync).
- Studio uses the same system (navy sidebar, cream canvas), so the product feels like Qualifacts
  internally too.
- Editors pick accents **from the palette only** (no free color picker) to keep assessments on brand.
- ⚠️ **Confirm the Ekster web-font license** covers hosting on a shared platform. Serve the font
  from `q-quiz-assets` or the app rather than inlining base64 in every page.

---

## 8. Data and security

- SQL: `supabase/001_q_quiz_schema.sql`.

  | Table / view | Purpose |
  |---|---|
  | `q-quiz-profiles` | Staff and roles |
  | `q-quiz-products` | Solutions library |
  | `q-quiz-assessments` | Drafts and settings |
  | `q-quiz-versions` | Immutable published snapshots |
  | `q-quiz-responses` | Leads, scores, answers, attribution, follow-up |
  | `q-quiz-events` | Funnel analytics |
  | `q-quiz-ai-requests` | AI usage log |
  | Views `q-quiz-response-answers`, `q-quiz-assessment-stats` | Reporting |
  | Buckets `q-quiz-assets` (public), `q-quiz-imports` (private) | File storage |

- Prospects never get table access. They only call three `SECURITY DEFINER` RPCs, which validate the
  status, cap field lengths and payload size, and enforce the close date and response cap.
- Staff access requires an active `q-quiz-profiles` row. Profiles are auto-created only for
  `@qualifacts.com` users.
- Scores are computed client-side by the shared engine and stored **alongside raw answers +
  version id**, so any response can be re-scored server-side if a weight is ever disputed.
  Server-side re-scoring in the Edge Function is a phase-3 hardening option.
- **PHI:** these assessments collect business and operational information, not PHI. Still, add
  guidance text near free-text fields ("Please don't include client information") and a retention
  setting.
- Existing legacy tables stay untouched. A one-time script can copy their historical leads into
  `q-quiz-responses` under the migrated assessments, so reporting covers all time.

---

## 9. Phased delivery

**Phase 0: Setup**
- Run the SQL. Configure Supabase Auth with Microsoft Entra (IT: app registration) and restrict
  sign-in to @qualifacts.com.
- Create the monorepo and 2 Netlify sites. Request the DNS CNAMEs.

**Phase 1: MVP (replace the manual process)**
- `packages/schema` + `packages/engine` with unit tests reproducing all 4 existing assessments'
  scores exactly.
- Runner (port the existing UI to config-driven rendering).
- Studio: auth, dashboard, full manual editor with live preview, publish/pause, slugs, share link + QR.
- Responses table, response detail, CSV and Excel export.
- Migrate the 4 assessments as templates, then redirect the old Netlify URLs.

**Phase 2: Scale the team**
- AI assistant (generate, import, rewrite, options, results copy, review).
- CSV/XLSX structured import.
- Solutions library UI, recommendation rules builder, score simulator.
- Analytics (funnel, distributions, source/rep breakdowns).
- New-lead email and Teams alerts. OG link previews. Version history and rollback.

**Phase 3: Polish and integrate**
- CRM sync, prospect results email, standalone HTML export.
- Server-side re-scoring, Turnstile, cross-assessment benchmarks ("you scored above 70% of
  organizations like yours"), multi-language, A/B variants.

---

## 10. Decisions and dependencies to confirm

1. **IT:** Microsoft Entra app registration for SSO, plus DNS for `assess.qualifacts.com`.
2. **CRM target** for phase 3 (Salesforce vs HubSpot) and who receives lead alerts by default.
3. **Ekster font license** for web hosting.
4. **Anthropic API key / billing owner** for the Edge Function secret.
5. **Governance:** can any editor publish, or does an admin approve? The schema supports either;
   the default is that editors can publish.
