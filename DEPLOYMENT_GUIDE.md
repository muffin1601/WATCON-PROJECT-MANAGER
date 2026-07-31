# Deployment Guide

## 1. Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Where to get it | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API | Public, safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API | Public, used only for reading public Storage URLs |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API | **Secret** — server-only, used for Storage writes. Never expose to the client. |
| `DATABASE_URL` | Supabase project → Settings → Database → Connection pooling (Transaction, port 6543) | Used at runtime by Prisma |
| `DIRECT_URL` | Supabase project → Settings → Database → Connection pooling (Session, port 5432) or direct connection | Used for migrations only |
| `OCR_PROVIDER` | — | `tesseract` (only implemented provider) |
| `NEXT_PUBLIC_APP_URL` | — | Your deployed URL |

**If your DB password contains special characters** (`@ # : / ? %` etc.), percent-encode them in both `DATABASE_URL` and `DIRECT_URL` (`@` → `%40`, `#` → `%23`, …) — an unencoded `@`/`#` will silently misparse the connection string. Keep any explanatory comments on their own line, never appended after a value — `dotenv` does not strip inline `# comment` text from unquoted values.

## 2. Supabase project setup

1. Create a Supabase project (any region — this app was verified against `ap-southeast-2`).
2. Note the connection strings from Settings → Database (you need both the pooled transaction-mode string on port 6543 for `DATABASE_URL`, and either the session-mode pooler on 5432 or the direct connection for `DIRECT_URL`).
3. Run migrations against the project:
   ```
   npx prisma migrate deploy
   ```
4. Apply the storage bucket + policy (creates the public `watcon-documents` bucket):
   ```
   # via the Supabase SQL editor, run the contents of:
   supabase/policies.sql
   ```
5. (Optional) seed sample data: `npm run prisma:seed`.

### A note on connection reliability
During development, the pooled connection (port 6543 / pgbouncer) was observed to be **intermittently unreachable** from one particular network path, while the direct/session connection (port 5432) was consistently reliable. This may not recur on your network or on Vercel's, but if you see occasional `PrismaClientInitializationError: Can't reach database server` in production logs with no other explanation, this is a known-possible cause — consider using the session-mode pooler for `DATABASE_URL` as well if it persists.

## 3. Production build

```
npm install
npx prisma generate
npm run build
npm start
```

`npm run build` runs `next build`, which itself runs a full TypeScript check — a stale or missing Prisma client (see `DATABASE_DOCUMENTATION.md`) will surface here as type errors, not at runtime.

## 4. Vercel deployment

1. Import the repository into Vercel.
2. Set all environment variables from step 1 in the Vercel project settings (Production, Preview, and Development environments as appropriate).
3. Build command: `npm run build` (default). Output: Next.js App Router (auto-detected).
4. **`tesseract.js` on serverless**: OCR runs inside a Next.js Route Handler (`POST /api/documents/[id]/ocr`), which on Vercel executes as a serverless function. Tesseract.js downloads its language data (`eng.traineddata`, a few MB) on first use per cold instance — expect the first OCR call after a deploy/cold-start to take noticeably longer (10–30s) than subsequent ones. If this becomes a problem, consider Vercel's function `maxDuration` config for that route, or moving OCR to a background job.
5. Deploy. Run `npx prisma migrate deploy` against the production database as part of your deploy pipeline (or manually) — Vercel does not run this automatically.

## 5. Backup strategy

- **Settings → Export data backup (JSON)** (`GET /api/settings/export`) dumps every project with its full relation graph (items, challans, bills, payments, discounts, amendments, documents — metadata only, not the file bytes) as a single JSON file. Run this on a schedule (manually, or via a cron hitting the endpoint) and store the output somewhere durable.
- **Supabase's own point-in-time recovery / daily backups** (available on paid Supabase plans) cover both the Postgres data and, separately, you should verify your Supabase plan's Storage backup/retention policy for the `watcon-documents` bucket — the JSON export above does **not** include the actual uploaded files, only their storage paths.
- **There is no "restore from backup" button** — re-importing a JSON export would mean bulk-writing to a live production database, which is a decision that needs a human running a reviewed script, not a UI action. If you need this, write a one-off script using `prisma.$transaction` against the exported JSON — don't wire it into the app.

## 6. Post-deploy smoke test

Minimum checklist after any deploy:
1. Dashboard loads and shows real project data.
2. Create a project, add a Sales Order item, confirm the contract value shown matches `qty × rate × 1.18` (or your configured GST rate).
3. Issue a challan, confirm the balance-qty math and that over-dispatch is rejected.
4. Generate a running bill, confirm it doesn't double-bill on a second immediate attempt.
5. Upload a document, confirm it downloads from its public Storage URL.
6. Delete the test project, confirm it 404s afterward (validates the cascade-delete fix holds).
