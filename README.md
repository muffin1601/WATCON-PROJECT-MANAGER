# Watcon Project Management

Production Next.js rebuild of the single-file `watcon-project-management.html`
prototype (project root — the permanent design/behavior spec; see `PLAN.md`).
Next.js 16 + TypeScript + CSS Modules + Prisma + Supabase (Postgres, Storage).
**No authentication** — the app is public/single-tenant and opens straight to
the Dashboard, exactly like the prototype.

**Status: feature-complete, production-hardened, release-candidate.** See
`RELEASE_v1.0.md` for the release summary, `PLAN.md` for the full phase-by-
phase build history, and the other docs listed below for specifics.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Supabase project URL/keys
   and Postgres connection strings (pooled `DATABASE_URL`, direct
   `DIRECT_URL`) — see `DEPLOYMENT_GUIDE.md` for where to find each value and
   a password-encoding gotcha worth knowing about.
3. `npx prisma migrate deploy` — creates tables from `prisma/schema.prisma`.
4. Run `supabase/policies.sql` in the Supabase SQL editor — creates the
   public `watcon-documents` storage bucket (no RLS; this app has no auth).
5. `npm run prisma:seed` — optional sample project.
6. `npm run dev`.

## Documentation

- `PLAN.md` — phase-by-phase build history (what was built, why, and how each phase was verified live against Supabase)
- `COMPLETE_FEATURES.md` — full feature inventory, module by module
- `TECHNICAL_ARCHITECTURE.md` — folder structure, service layer, API routes, component hierarchy
- `DATABASE_DOCUMENTATION.md` — Prisma schema rationale, cascade rules, storage layout
- `DEPLOYMENT_GUIDE.md` — environment variables, Supabase setup, Vercel deployment, backup strategy
- `KNOWN_LIMITATIONS.md` — what genuinely doesn't work or wasn't built, and why
- `FINAL_QA_REPORT.md` — production-hardening audit: every bug found and fixed, with live reproduction steps
- `RELEASE_v1.0.md` — release notes

## Structure

- `app/` — Next.js App Router routes and API route handlers
- `components/` — design-system + feature components (CSS Modules)
- `modules/` — Zod schemas + display-label maps, grouped by domain (projects, challans, adjustments, documents, settings, ocr)
- `lib/` — cross-cutting utilities (Prisma client, Decimal coercion, format helpers, Supabase server client, API fetch wrapper, shared error mapping)
- `hooks/` — shared client hooks (`usePrintPortal`, `useUploadDocument`)
- `services/` — server-side business logic; the only layer that writes via Prisma (financial math, challan/running-bill engines, document/settings/search services, OCR provider abstraction)
- `prisma/` — schema, migrations, seed script
- `supabase/` — SQL not owned by Prisma (storage bucket + policy)
- `styles/` — design tokens (`tokens.css`, ported from the prototype's `:root`) + global CSS
- `public/` — static assets (`watcon-logo.png`, extracted from the prototype's embedded base64 logo)

## Security notes

Pinned to `next@16.2.12` (patched for CVE-2025-66478 and the Dec 11 2025
advisory). `npm audit` still reports high-severity advisories against
transitive `postcss`/`sharp` (used by `next/image`); the only "fix" npm
offers is downgrading Next to 9.3.3, which is not viable. Re-run `npm audit`
before each deploy and take the next non-breaking Next.js patch as soon as
one lands.

## Domain notes

The financial logic (contract value, dispatched qty/value, GST, running bill
generation, site account balance) is ported exactly from the `<script>`
block in `watcon-project-management.html` — see `PLAN.md` for the function
list and `services/financials.ts` for the implementation.
