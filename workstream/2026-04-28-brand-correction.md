# Session: brand-correction-jay-to-jai

**Date:** 2026-04-28 (IST)
**Workstream:** WS-B.1 — Brand name correction ("Jay Paras" → "Jai Paras")
**Estimated duration:** 30–60 minutes
**Workstream type:** Targeted refactor / maintenance

---

## Read this first (mandatory)

Before doing anything:

1. **Credential hygiene check.** Run these commands and verify all are clean. **DO NOT proceed if any fail.**

   ```bash
   echo "=== No tokens in remote URL ==="
   cd ~/Desktop/jay-paras
   git remote -v
   # Expected: clean https://github.com/jayparaswebapp/jayparas.git, NO ghp_ or pat_ in URL.

   echo "=== No GITHUB_TOKEN in env ==="
   env | grep -c GITHUB_TOKEN
   # Expected: 0

   echo "=== No tokens in .git/config ==="
   grep -E "ghp_|github_pat_" ~/Desktop/jay-paras/.git/config 2>/dev/null && echo "FAIL" || echo "OK"
   # Expected: OK
   ```

   If any check fails, **STOP** and tell Jay before doing anything else.

2. **Read `/sessions/` directory in chronological order.** The previous session notes explain where the project stands. Specifically read the most recent WS-B wrap-up note for context on what was last built.

3. **Verify the foundation is healthy:**

   ```bash
   cd ~/Desktop/jay-paras
   git status                        # should be clean
   git log --oneline -5              # confirm latest commits
   npm run build                     # should pass
   ```

4. **At the end of this session:**
   - Create `/sessions/2026-04-28-brand-correction.md` summarising changes.
   - This is a small focused session; one wrap-up note is enough.

---

## Context for this workstream

The business's legal name and brand name is **"Jai Paras"**, not "Jay Paras". This was confirmed by Jay after WS-B was complete. All user-visible strings across the OS must say "Jai Paras". However, several technical identifiers were already established as "jay paras" / "jayparas" / "JP-" and changing them would be costly with no user-visible benefit. This session draws the line precisely: change what users see, leave the plumbing alone.

This decision is recorded as ADR-008 (to be written in this session).

---

## Decisions made before this session (do not re-litigate)

| #   | Decision                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All user-visible strings change from "Jay Paras" to "Jai Paras"                                                                                                                                                                                                                    |
| 2   | Auth synthetic email domain remains `jayparas.internal` (invisible to users; changing it would invalidate existing auth records and risk lockout)                                                                                                                                  |
| 3   | GitHub repo name remains `jayparas` (external identifier; changing breaks Vercel/Supabase integrations)                                                                                                                                                                            |
| 4   | Vercel project name and production URL `jayparas.vercel.app` remain unchanged                                                                                                                                                                                                      |
| 5   | Supabase project name remains unchanged                                                                                                                                                                                                                                            |
| 6   | Local folder path `~/Desktop/jay-paras/` remains unchanged                                                                                                                                                                                                                         |
| 7   | Internal code prefixes like `JP-` (used for job codes and SKU prefixes) remain unchanged — "JP" maps cleanly to "Jai Paras" anyway                                                                                                                                                 |
| 8   | Historical ADRs (ADR-001 through ADR-007 or whatever was last written) keep their existing text — they are historical record, not living documentation                                                                                                                             |
| 9   | Variable names, file names, table names, and other code identifiers that contain "jayparas" or "jay_paras" or similar are **left as-is** unless they will appear in UI output (e.g. error messages displaying internal identifiers — those don't exist in our codebase as of WS-B) |

---

## Scope of this session

### Files to change

This is an exhaustive list of where to change. The grep step in "Discovery" below will produce the actual list; this is the expected set:

**Required to change:**

1. `src/messages/gu.json` — every "Jay Paras" / "જય પારસ" → "Jai Paras" / "જય પારસ"
   - **Note:** "જય" in Gujarati is the standard spelling for both "Jay" and "Jai" — pronounced "jai". Confirm with Jay during the session whether the Gujarati spelling stays `જય` (most common, matches existing) or should change to `જૈ` (less common, more phonetically precise for "Jai"). **Default: keep `જય`** since it's the more recognisable Gujarati form for this name. Document this decision in the ADR.

2. `src/messages/en.json` — every "Jay Paras" → "Jai Paras"

3. `README.md` — every "Jay Paras" → "Jai Paras"; section headers, prose, examples

4. `docs/business-context.md` — every "Jay Paras" → "Jai Paras"; the file's narrative is the canonical business context, so it must be correct

5. Any UI component files containing hard-coded "Jay Paras" text (there should be none if i18n was done correctly in WS-A, but verify — see "Discovery" below)

6. Page titles in `src/app/**/page.tsx` — check for any `<title>` or `metadata.title` hard-coded as "Jay Paras"; route them through i18n if not already

7. `src/app/layout.tsx` — root metadata if it contains the brand name

8. Any seed scripts (`scripts/seed-*.ts`) that store the brand name as data (likely none, but check)

9. PDF/email templates — none exist yet (planned for WS-F+); skip

10. `docs/decisions.md` — add ADR-008 at the bottom (do not edit existing ADRs)

**Required NOT to change:**

- `.env.example` and `.env.local`: `AUTH_EMAIL_DOMAIN=jayparas.internal` stays
- `src/lib/auth/synthetic-email.ts`: default domain stays `jayparas.internal`
- `package.json` `name` field if set to `jayparas` or similar — stays
- Any database table names, column names, RPC function names
- Any Supabase migration files (historical record, do not rewrite)
- Any file or folder paths
- Any URLs (GitHub, Vercel, Supabase)
- Existing ADR text (ADR-001 through whatever was last)
- Git commit messages in history
- The `JP-` prefix in SKU codes or job codes (will appear in WS-C and WS-F; ensure new code uses "JP-" not "JaiP-")

**Ambiguous — check during session:**

- If WS-B added any "About" or "Brand info" UI surface I'm not aware of, change brand name there
- If there are any environment variable names containing `JAY` or `JAYPARAS` — leave them, but note in wrap-up

---

## Discovery step (run first)

Before making changes, run this audit to produce the complete list:

```bash
cd ~/Desktop/jay-paras

# Find all occurrences of the brand name in user-facing surfaces.
# We deliberately exclude .git, node_modules, .next, package-lock.json, migrations.

echo "=== 'Jay Paras' (exact, with space) ==="
grep -rn "Jay Paras" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  --exclude=package-lock.json \
  . 2>/dev/null

echo ""
echo "=== 'Jay paras' (lowercase variant) ==="
grep -rni "jay paras" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  --exclude=package-lock.json \
  . 2>/dev/null | grep -v "Jay Paras"

echo ""
echo "=== 'જય પારસ' (Gujarati) ==="
grep -rn "જય પારસ" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  . 2>/dev/null

echo ""
echo "=== 'jayparas' / 'jay_paras' (technical identifiers — should NOT be changed) ==="
echo "These are flagged for awareness only — DO NOT modify these."
grep -rn -E "jayparas|jay_paras|jay-paras" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  --exclude=package-lock.json \
  . 2>/dev/null | head -40
```

The first three sections produce the change list. The fourth section is **awareness only** — those occurrences must be preserved.

Document the count of matches found in each section in the wrap-up note. If "Jay Paras" appears in more than ~20 places, that's expected; if it's in fewer than 5, double-check the search worked.

---

## Execution plan

### Step 1 — Discovery

Run the grep audit above. Capture the list of files needing changes. If anything appears in unexpected places (e.g., a migration file or a table column comment), STOP and confirm with Jay before proceeding.

### Step 2 — i18n catalogs first

Change `src/messages/en.json` and `src/messages/gu.json`. These are the canonical source of brand strings. After this change, run:

```bash
npm run typecheck
npm run build
```

If the build fails because a message key now references undefined content, fix that. Build must pass.

### Step 3 — Docs and README

Update `README.md` and `docs/business-context.md`. Re-read each file end-to-end after the edit — these are prose documents and search-and-replace can produce awkward sentence flow. Fix any awkward phrasing.

### Step 4 — Page metadata and titles

Search for `metadata` and `<title>` references in `src/app/**`. If any contain "Jay Paras" literally (instead of going through i18n), refactor them to use i18n. This is the right time to fix that — don't just patch the literal.

### Step 5 — ADR-008

Append to `docs/decisions.md`:

```markdown
## ADR-008 — Brand name correction: "Jay Paras" → "Jai Paras"

**Date:** 2026-04-28
**Status:** Accepted

### Context

The legal name and brand name of the business is "Jai Paras". Prior to this decision, the OS used "Jay Paras" throughout — a transliteration variant of the same Gujarati name (જય). The variant was established in initial setup (WS-A, WS-B) based on early conversation defaults, then later confirmed as incorrect by the founder. This ADR records the corrective action and what was deliberately left unchanged.

### Decision

All user-visible references to "Jay Paras" are replaced with "Jai Paras". Technical identifiers retain "jay paras" / "jayparas" / "JP-" / "jay_paras" forms for stability.

### What changes (user-visible)

- i18n message catalogs (en and gu)
- README.md
- docs/business-context.md
- Page metadata / titles
- Any future PDF / email / label templates (going forward)

### What stays (technical / external)

- Auth synthetic email domain `jayparas.internal` (changing risks lockout of existing users; not visible to users)
- GitHub repo name `jayparaswebapp/jayparas`
- Vercel project name and URL `jayparas.vercel.app`
- Supabase project name
- Local folder path `~/Desktop/jay-paras/`
- All database identifiers, code identifiers, file names
- SKU and job code prefix `JP-` (maps cleanly to "Jai Paras")
- Historical ADR text (these are immutable records)
- Historical migration files

### Gujarati spelling

The Gujarati form `જય પારસ` is retained (rather than `જૈ પારસ`). `જય` is the standard and recognisable form for this name in Gujarati script and is pronounced "Jai". This matches how the business is locally referred to.

### Consequences

- A small permanent inconsistency exists between user-visible name ("Jai Paras") and technical/external identifiers ("jayparas", "jay-paras", "JP-"). This is intentional and documented.
- Future contributors and Claude Code sessions must use "Jai Paras" for any new user-visible strings, and must NOT rename technical identifiers.
- If business ever wants to renew external identifiers (new domain, new repo), that's a separate workstream with its own ADR.
```

### Step 6 — Build, typecheck, manual smoke

```bash
npm run typecheck
npm run build
npm run dev  # in background or separate terminal
```

Manually verify in browser:

- Login screen header shows "Jai Paras"
- Login screen in Gujarati shows the Gujarati form
- Dashboard greeting / header shows "Jai Paras"
- Locale switcher still works
- One master-data screen (locations) loads and shows "Jai Paras" branding

### Step 7 — Commit and push

```bash
git add -A
git status        # verify .env*.local is NOT staged; verify only expected files are staged
git commit -m "Brand correction: Jay Paras → Jai Paras (user-visible only)

- Update i18n catalogs (en, gu)
- Update README and business-context docs
- Add ADR-008 documenting scope and rationale
- Technical identifiers (auth domain, repo, prefixes) deliberately preserved"
git push origin main
```

### Step 8 — Production verification

Wait ~2 minutes for Vercel auto-deploy. Then load `jayparas.vercel.app` and confirm:

- Login screen shows "Jai Paras" in both locales
- After login, dashboard shows "Jai Paras"

If anything still shows "Jay Paras" in production after redeploy, hard-refresh (Cmd+Shift+R) to bypass cache, then re-check.

---

## Acceptance criteria

- [ ] Credential hygiene checks at session start all pass
- [ ] Discovery audit run; match counts logged in wrap-up note
- [ ] `src/messages/en.json` updated — zero remaining "Jay Paras"
- [ ] `src/messages/gu.json` updated — zero remaining "Jay Paras" (English), Gujarati form decision logged
- [ ] `README.md` updated and prose reads naturally
- [ ] `docs/business-context.md` updated and prose reads naturally
- [ ] Page metadata / titles use i18n keys (not hard-coded literals)
- [ ] ADR-008 appended to `docs/decisions.md`
- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean
- [ ] Local manual smoke (browser): "Jai Paras" visible on login + dashboard in both locales
- [ ] Technical identifiers verified preserved: `git remote -v` still shows `jayparas`, `.env.local` still has `AUTH_EMAIL_DOMAIN=jayparas.internal`, folder is still `jay-paras`, `JP-` prefix references in code untouched
- [ ] Committed and pushed to `main`
- [ ] Vercel auto-deploy green
- [ ] Production smoke: "Jai Paras" visible on production login + dashboard in both locales
- [ ] `/sessions/2026-04-28-brand-correction.md` wrap-up note written

---

## What this session is NOT

- This is not a brand identity / visual design refresh. Logos, colours, typography all stay as-is.
- This is not a database migration. No SQL changes. No table renames.
- This is not an opportunity to refactor unrelated code. If you notice something worth refactoring, note it in the wrap-up's "Open questions" section — do not change it in this session.
- This is not a rename of the project's external identifiers. Repo, Vercel URL, Supabase project all stay.

---

## What if you find something I didn't anticipate?

If during discovery you find "Jay Paras" or "jayparas" in a place that's not on the explicit change/preserve lists above, **stop and ask Jay** before deciding. Examples that would require asking:

- A migration file containing the brand name in a comment or default value
- A database column with the brand name stored as data (shouldn't exist but check)
- An environment variable name like `JAY_PARAS_API_KEY`
- A package or module name that contains the brand name and is referenced widely

The default disposition is: **preserve technical identifiers, change only user-visible strings**. Edge cases require explicit decision, not assumption.

---

## Notes for next session (WS-C kickoff — jobs)

After this session, the next workstream is **WS-C — Jobs, receipts, payments, cancellations**, covered in the data model spec. Specifically:

- `jobs` table with auto-generated `JP-YYMM-NNNN` codes
- `job_receipts` table with multiple-receipts-per-job for partial outcomes
- `cancellations` and `payments` tables
- The Issue and Receive UI flows
- SLA badges, weight-loss flag, quantity comparison
- Four receive outcomes (accepted_full, partial_redo, partial_reduced_rate, partial_discarded)

When WS-C is drafted, any new user-visible strings should use "Jai Paras". The `JP-` job code prefix is correct as-is (do not change to `JaiP-` or similar).

### Prep Jay should do before WS-C

None specific to this brand-correction session. WS-C prep was already noted in the WS-B wrap-up.

---

## Final reminders to Claude Code

1. **Scope discipline matters here.** This is a small session deliberately. Do not expand scope. If you finish in 30 minutes, that's a success, not a sign you should do more.
2. **No tokens, no shortcuts on credentials.** Same hygiene rules as every session.
3. **Wrap-up note is mandatory even for a short session.** Future sessions need the audit trail.
4. **If anything in the discovery step finds matches in unexpected files, stop and ask.** Don't pattern-match — confirm.
