# Session: foundation-setup

**Date:** 2026-04-26
**Workstream:** WS-A — Foundation
**Goal of this workstream:** A deployed, login-working skeleton with role-based auth, bilingual scaffolding, and a session-notes convention. No business logic yet.

---

## Read this first

You are Claude Code, working on **Jay Paras OS** — a job-work management system for a Valsad-based rakhi manufacturer that uses six village-based women's groups as contract labour.

**Before doing anything in this session:**
1. Read `/sessions/` directory if it exists. Read every file in chronological order to build context.
2. Read `/docs/data-model.md` (committed in this session — see Goals below).
3. Read `/docs/business-context.md` (committed in this session — see Goals below).

**At the end of this session:**
- Create the next session file in `/sessions/` named `YYYY-MM-DD-<slug>.md` summarising what was done, decisions made, blockers, and what the next session should pick up.
- Do not start the next workstream's work — leave it for the next session.

---

## Goals for this session

1. Initialise Next.js 14+ (App Router) + TypeScript + Tailwind project at the repo root `jayparas/`.
2. Wire up Supabase (project already exists, linked to GitHub).
3. Wire up Vercel deployment (account already exists, linked to GitHub).
4. Commit `/docs/data-model.md` and `/docs/business-context.md` (content provided below — copy verbatim).
5. Set up `/sessions/` convention with a README explaining it.
6. Implement **mobile + 6-digit PIN authentication** scaffolding via Supabase Auth.
7. Create the `app_users` table and `role` enum. **Do NOT create other business tables yet** — those come in WS-B.
8. Implement bilingual i18n scaffolding (Gujarati primary, English secondary). Use `next-intl` or equivalent. Locale switcher in header.
9. Build a minimal login screen + protected dashboard placeholder that says "Hello, <name>" and shows the user's role. Mobile-first responsive.
10. Seed one super-admin user (mobile + PIN provided in env vars; placeholder values in `.env.example`).
11. Deploy to Vercel; confirm login works in production.

---

## Tech stack (locked)

- **Framework:** Next.js 14+ App Router, TypeScript strict mode
- **Styling:** Tailwind CSS, mobile-first; minimum tap target 44px; large readable fonts (semi-literate user base)
- **UI components:** shadcn/ui — install only as needed, do not bulk-install
- **Database:** Supabase Postgres
- **Auth:** Supabase Auth (phone provider + custom PIN; see auth approach below)
- **Hosting:** Vercel (production); local dev on `localhost:3000`
- **i18n:** `next-intl` (or `next-i18next` if cleaner with App Router — your call, justify in session notes)
- **Form library:** `react-hook-form` + `zod`
- **Date/time:** `date-fns` + `date-fns-tz`, all storage UTC, all display IST (`Asia/Kolkata`), format `dd/MM/yyyy`
- **Linting:** ESLint + Prettier, pre-commit hook via Husky
- **Testing:** skip for v1, but structure code for testability

---

## Auth approach (mobile + PIN)

Supabase Auth's phone provider sends OTPs by default — we don't want that. Approach:

**Option A (recommended):** Use Supabase Auth's email/password flow under the hood, but the user-facing identifier is the mobile number and the password is the 6-digit PIN.
- Store mobile in `app_users.mobile`.
- For Supabase Auth, synthesise an email like `<mobile>@jayparas.internal` and treat the PIN as the password (with a server-side pepper before hashing if you want belt-and-braces, but Supabase already hashes).
- Login UI: two fields, mobile + PIN. Backend looks up the synthetic email and authenticates.
- Super-admin can change any user's PIN via a Supabase Edge Function that calls `admin.updateUserById`.

**Option B:** Custom auth table with PIN hash, JWT issued by an Edge Function. More work, more flexibility.

**Decision: go with Option A.** Document the rationale in session notes. We can migrate later if needed.

**PIN rules:**
- Exactly 6 digits, numeric only.
- No common-PIN check in v1 (future hardening).
- Server-side rate limit: 5 failed attempts per 15 minutes per mobile, hard-coded for now.
- Lockout state shown clearly in Gujarati + English.

---

## Database scope for this session

Only these objects:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM (
  'super_admin',
  'supervisor',
  'centre_manager',
  'accountant'
);

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  mobile text UNIQUE NOT NULL,
  role user_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_app_users_mobile ON app_users(mobile) WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own row" ON app_users
  FOR SELECT USING (auth.uid() = auth_user_id);

CREATE POLICY "super_admin full access" ON app_users
  USING (
    EXISTS (
      SELECT 1 FROM app_users a
      WHERE a.auth_user_id = auth.uid()
      AND a.role = 'super_admin'
      AND a.deleted_at IS NULL
    )
  );
```

Add an `updated_at` trigger using a standard `set_updated_at()` function.

---

## Repo structure to create

```
jayparas/
├── docs/
│   ├── business-context.md    # see Appendix A below
│   ├── data-model.md          # full spec (will be added by user — placeholder OK)
│   └── decisions.md            # ADRs as we go
├── sessions/
│   ├── README.md
│   └── 2026-04-26-foundation-setup.md   # this session's wrap-up note
├── src/
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── (app)/dashboard/
│   │   ├── api/
│   │   ├── layout.tsx
│   │   └── page.tsx              # redirect to /login or /dashboard
│   ├── components/
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts          # browser client
│   │   │   ├── server.ts          # server client
│   │   │   └── admin.ts           # service-role, server-only
│   │   ├── auth/
│   │   └── i18n/
│   ├── messages/
│   │   ├── en.json
│   │   └── gu.json
│   └── types/
├── supabase/
│   ├── migrations/
│   │   └── 20260426000001_initial_users.sql
│   └── seed.sql
├── .env.example
├── .gitignore
├── tailwind.config.ts
├── next.config.mjs
├── package.json
└── README.md
```

---

## Bilingual UX rules (apply from day one)

- Default locale: `gu` (Gujarati). Fallback: `en`.
- Every label, button, error message goes through `t('...')`. No hard-coded strings in JSX.
- Dates: `dd/MM/yyyy` always.
- Numbers: Indian numbering (1,00,000 not 100,000). Use `Intl.NumberFormat('en-IN')`.
- Currency: `₹` prefix, two decimal places.
- Locale switcher visible in header, even on mobile.
- Test with at least one Gujarati string per screen to confirm font rendering — recommend bundling Noto Sans Gujarati or similar.

---

## Mobile-first UI rules (apply from day one)

- Design at 360px width first, then scale up.
- Tap targets minimum 44×44 px.
- Forms: one field per row on mobile, label above input.
- Primary actions: large, full-width buttons.
- No horizontal scroll, ever.
- Icons + text, never icons alone (semi-literate users).
- High contrast (WCAG AA minimum).

---

## What NOT to do this session

- Do not create any business tables (lead_ladies, designs, jobs, etc.) — that's WS-B.
- Do not build any business screens — only login + empty dashboard.
- Do not over-install dependencies. Add only what's needed for the goals above.
- Do not write tests — defer.
- Do not implement audit log triggers — those come with WS-B tables.

---

## Decisions to record in `/docs/decisions.md` (ADR format)

1. Auth approach (Option A: synthetic email + PIN as password).
2. i18n library choice (whichever you pick + why).
3. Folder structure (App Router, route groups for auth vs app).
4. Storage timezone = UTC, display = IST.

---

## Acceptance criteria

- [ ] `npm run dev` works locally; login with seed super-admin succeeds.
- [ ] Wrong PIN shows bilingual error.
- [ ] After login, dashboard says "Hello <full_name>" with role badge, in selected locale.
- [ ] Locale switcher persists choice across reloads (cookie or localStorage).
- [ ] Vercel deploy is green; same login works in production.
- [ ] Migration `20260426000001_initial_users.sql` is applied to Supabase.
- [ ] `/sessions/2026-04-26-foundation-setup.md` is committed with what was done, what failed, what decisions were made, and what the next session (WS-B kickoff) should pick up.

---

## Appendix A — `docs/business-context.md` (commit this verbatim)

```markdown
# Jay Paras — Business Context

## What the business does
Jay Paras is a Valsad-based manufacturer of custom rakhis (the thread-bracelet exchanged during the Indian festival of Raksha Bandhan). Production is seasonal, peaking in July–August. The main centre in Valsad designs the products and prepares raw material packets; the actual assembly is done by women's groups in six surrounding villages on a contract-labour basis.

## The job-work model
Each village has one or more "lead ladies" (lead lady = ગ્રુપ લીડર). The lead lady visits the Valsad centre, collects a raw-material packet (weighed in grams), the design specs, and a target quantity. She returns to her village, distributes the work among the group's ladies, oversees execution, collects the finished rakhis, and brings them back to Valsad. For her coordination, she earns 15% of her group's total annual labour, paid every August.

A job has a 20-day SLA from packet issue.

## Locations
Main centre: **Valsad**.
Job-work locations: **Atgam, Khergam, Arnala, Ambheti, Jashoda, Vaghchhipa**.
A lead lady can serve multiple locations; a location can have multiple lead ladies.

## Units of finished goods
- **Guss (ગુસ)** = 144 pieces
- **Dozen (ડઝન)** = 12 pieces
- **Nang (નંગ)** = 1 piece

## Labour calculation
`labour = guss × rate_per_guss + dozen × dozen_multiplier (default 1.5)`
- `rate_per_guss` is per design, locked at job issue.
- Nang carries no labour value (rounding remainder).

## Weight loss
At receive time, finished weight is compared to issued raw weight. Loss > 5% (configurable) is soft-flagged.

## Outcomes at receive
1. **Accepted full** — standard.
2. **Partial — redo** — some pieces sent back; job stays open, SLA clock keeps ticking.
3. **Partial — reduced rate** — defective pieces accepted at a % discount.
4. **Partial — discarded** — defective pieces written off, no labour for them.

## Roles
- **Super-admin** (Jay Shah): everything, including settings and audit log.
- **Supervisor**: full operational access across all locations.
- **Centre manager**: operational access only for assigned locations.
- **Accountant**: read-only + exports.

## Login
Mobile number + 6-digit PIN. PIN reset by super-admin only.

## Out of scope for v1
Lead-lady self-login, raw material decomposition, inventory, photos, WhatsApp reminders.
```

---

## Notes for next session (WS-B kickoff)

After this session, the next session should:
- Create all business master tables (locations, lead_ladies, lead_lady_locations, centre_manager_locations, designs).
- Seed the six locations.
- Build super-admin master-data CRUD screens.
- Implement audit_log table + triggers.
- Implement settings table + seed + edit screen.

Do not touch jobs/receipts/payments — that's WS-C.
