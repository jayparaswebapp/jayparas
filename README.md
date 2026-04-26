# Jay Paras OS

Job-work management system for Jay Paras (Valsad-based rakhi manufacturer using six village-based women's groups as contract labour).

## Stack

- Next.js 14 App Router, TypeScript strict
- Tailwind CSS, mobile-first (44px tap targets)
- Supabase (Postgres + Auth)
- next-intl (Gujarati primary, English secondary)
- react-hook-form + zod
- date-fns + date-fns-tz (storage UTC, display IST)

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in real values
npm run seed:super-admin     # creates the seed super-admin from env vars
npm run dev                  # http://localhost:3000
```

## Documentation

- `docs/business-context.md` — what the business does and the job-work model
- `docs/data-model.md` — full schema specification
- `docs/decisions.md` — architectural decision records
- `sessions/` — chronological session notes (read most recent first)
- `workstream/` — workstream briefs (input to sessions)

## Conventions

- All timestamps stored in UTC, displayed in IST (`Asia/Kolkata`).
- Dates: `dd/MM/yyyy`. Numbers: Indian numbering (`1,00,000`). Currency: `₹` with two decimals.
- Every label/error goes through `t('...')`. No hard-coded strings in JSX.
- Soft-delete via `deleted_at` on every business table.
