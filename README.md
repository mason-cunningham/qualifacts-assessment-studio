# Qualifacts Assessment Studio

The Qualifacts team uses this platform to create, publish, and report on branded customer and prospect assessments.

**One site, one domain.** Every assessment is a folder on it:

| Path | What it is | Source |
|---|---|---|
| `https://qualifacts-assess.netlify.app/{slug}` | Public assessments (one per slug) | `apps/runner` |
| `https://qualifacts-assess.netlify.app/studio` | Internal Studio: dashboard, editor, responses, exports, library, users | `apps/studio` |

Later, `assess.qualifacts.com` replaces the netlify.app address. Creating or publishing an assessment never creates a new site or needs a deploy.

Shared packages:

- `packages/schema` defines what an assessment is (`AssessmentDefinition`).
- `packages/engine` holds scoring, branching, recommendations, and the pre-publish checklist.
- `packages/ui` has the Qualifacts-branded assessment experience, used by the Runner and by Studio's live preview.
- `packages/templates` contains the 4 legacy assessments rebuilt as templates.

Publishing is a database write, not a deploy. A published assessment is live at its link right away.

---

## One-time setup

### 1. Database (Supabase SQL editor)
Paste all of `supabase/schema.sql` into the SQL editor and run it.

It's **non-destructive**:
- It contains no `DROP` or `DELETE` statements and doesn't touch your existing lead tables.
- It's safe to run again, and safe if an earlier version of the script was already run.
- If `mason.cunningham@qualifacts.com` already has a login in this Supabase project, it makes that account the admin. Otherwise the first person to sign up in Studio becomes admin.

### 2. Supabase Auth settings
Go to Dashboard → **Authentication**:
- **Sign In / Providers → Email:** enabled.
- **Confirm email: OFF for now.** Supabase's built-in mailer only delivers to members of your Supabase team, so confirmation emails wouldn't reach coworkers. This is safe because new accounts start *pending*: an admin must approve them in Studio → Users.
- **URL Configuration:** set the Site URL to `https://<site>/studio`. Add `http://localhost:5173/studio` and the live Studio URL to Redirect URLs.

### 3. Become the first admin
Open Studio and create an account with your @qualifacts.com email. **The first person to sign up becomes an active admin automatically.** Everyone after that shows up under Users → "Waiting for approval".

### 4. Deploy the `admin-users` Edge Function (for password resets)
Go to Dashboard → **Edge Functions** → Deploy a new function, then:
- Name it `admin-users`.
- Paste in `supabase/functions/admin-users/index.ts`.
- Deploy with "Verify JWT" on.

No CLI is needed. `process-outbox` isn't needed yet (see "Email alerts" below).

### 5. Deploy (one time): GitHub → Netlify
1. Push this repo to a private GitHub repository.
2. In Netlify: **Add new site → Import an existing project → GitHub** and pick the repo.
   - Build settings come from `netlify.toml`: `npm ci && npm run build`, publish `dist`, Node 22.
   - Public build values come from `.env.production`, so no Netlify environment variables are needed.
3. **Site configuration → Change site name** to `qualifacts-assess`, or another available name.
4. If the name isn't `qualifacts-assess`:
   - Update `VITE_PUBLIC_BASE_URL` in `.env.production` and push.
   - Run this in the Supabase SQL editor (`q-quiz-config` overrides the env var in Studio):
     ```sql
     update "q-quiz-config" set value = '"https://<site>.netlify.app"' where key = 'public_base_url';
     ```

After that, every push to `main` redeploys automatically. **Publishing assessments never needs a deploy.** Only code changes do.

`npm run build` builds both apps, and `scripts/assemble.mjs` combines them into `dist/`:
- the assessments at `/`
- Studio at `/studio`
- `_redirects` with the routing rules

### Local development (Node.js 20+; tested on Node 26)
```
npm install
npm test                      # engine tests: all 4 legacy assessments must score identically
npm run dev:studio            # http://localhost:5173/studio
npm run dev:runner            # http://localhost:5174/{slug}
npm run check:db              # read-only security checks against the live database
```

---

## Everyday use
1. **Create:** Studio → New assessment → blank or a template (Eligibility, InSync Operational, CES, Payment Posting, or any assessment marked "team template").
2. **Edit:** use the tabs (Content, Scoring, Results page, Solutions, Lead form, Branding, Settings & share). The live preview on the right uses the real prospect experience and can jump straight to best, worst, or random results. Changes autosave.
3. **Publish:** the pre-publish checklist blocks real problems, such as a scored question with no points or tiers with no labels. Every publish creates an immutable version. Responses record the version they were scored against.
4. **Share:** use the tracking-link builder (`?src=acc2026&rep=jsmith&utm_campaign=…`), the QR code (PNG/SVG), or the iframe embed.
5. **Follow up:**
   - The owner gets an in-app alert (the bell) for every new lead.
   - Responses let you filter, open a lead to see *exactly* what they saw, and set follow-up status, assignee, and notes.
   - Export CSV (wide, or one row per answer) or a 3-sheet Excel file (Summary / Responses / Answers).
6. **Pause / close:** pause, set a close date, or set a response cap. The link then shows your "closed" message instead of a 404.

---

## Going live on assess.qualifacts.com later
1. IT adds one CNAME: `assess.qualifacts.com` → the Netlify site. Set it as the primary domain in Netlify. Studio then lives at `assess.qualifacts.com/studio`.
2. Update `VITE_PUBLIC_BASE_URL` in `.env.production` and push, **and** run:
   ```sql
   update "q-quiz-config" set value = '"https://assess.qualifacts.com"' where key = 'public_base_url';
   ```

Old `qualifacts-assess.netlify.app` links and printed QR codes keep working, because Netlify redirects them to the primary domain.

## Email alerts (later)
Right now alerts are in-app only, by design. When a sending option exists (a verified domain in Resend/SendGrid, or a Microsoft 365 mailbox):
1. Deploy `supabase/functions/process-outbox`.
2. Set its secrets: `RESEND_API_KEY`, `ALERT_FROM`, `STUDIO_URL`.
3. Add a Database Webhook on INSERT into `q-quiz-outbox` that calls it.
4. Run `update "q-quiz-config" set value = 'true' where key = 'email_alerts_enabled';`

No backlog builds up while email is off.

## Salesforce (later)
The data model is already shaped for it:
- Lead fields use Salesforce Lead names (`first_name`→FirstName, `organization`→Company, …).
- Responses have `crm_sync_status / crm_external_id / crm_synced_at`.
- Each assessment has `settings.crm` (enabled, Lead Source, Campaign ID, field map).
- `crm_sync` jobs flow through `q-quiz-outbox` once `crm_enabled` is true.

Only the Salesforce handler in `process-outbox` (`syncToCrm`) needs writing.

---

## Notes and known gaps (phase 2 backlog)
- **AI assistant** (generate from a brief, import a Word/PDF questionnaire, rewrite, suggest options/weights/results copy): planned as the `ai-assist` Edge Function with the Anthropic key stored as a secret.
- **Structured CSV/XLSX import** of questions.
- **Analytics charts:** funnel drop-off by question, score histogram, source/rep breakdown. The events are already being collected.
- **Link previews** (Teams/LinkedIn unfurls) need a Netlify Edge Function to inject per-assessment OG tags. The OG image field is already in Branding.
- **CES screenshots** in the CES template currently point at the old `qualifacts-ces-healthcheck.netlify.app/ces-assets/…`. Upload them to the Solutions library before retiring that site.
- **Excel styling:** the free SheetJS build can't write cell colors or fonts, so exports have column widths and filters but no branded header row.
- **Table names use hyphens** (`q-quiz-…`), so raw SQL must double-quote them: `select * from "q-quiz-responses"`.
