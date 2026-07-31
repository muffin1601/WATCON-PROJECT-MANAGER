# Technical Architecture

## Stack
Next.js 16 (App Router, Turbopack) · TypeScript (strict) · CSS Modules only · Prisma ORM · Supabase Postgres + Storage · Zod · React Hook Form · TanStack Query · Tesseract.js. No authentication (public, single-tenant — see `PLAN.md`).

## Folder structure
```
app/                    Routes (pages) and API route handlers
  page.tsx              Dashboard
  projects/new/         New Project form page
  projects/[id]/        Project detail workspace
  settings/             Settings page
  api/                  Route handlers (see API ROUTES below)
components/             Design system + feature components, CSS Modules
  <Primitive>/           Button, Card, Chip, Modal, Table, Form, Tabs, etc.
  Header/                App header, GlobalSearch
  ProjectDetail/         Tab components (Overview, SalesOrder, Challans, Bills,
                         Payments, SiteAccounts, DiscountsAmendments, Documents)
                         + their modals (Issue/Attach challan, Ocr review, etc.)
  PrintDoc/              Print document layout (DocHead, ChallanDoc, BillDoc,
                         SiteAccountDoc) + shared print CSS
  ProjectForm/           New Project form
  Settings/              Settings form
hooks/                  usePrintPortal, useUploadDocument
lib/                    prisma client, decimal coercion, format helpers,
                         settings accessor, supabaseServer, apiClient (fetch wrapper)
modules/                Zod schemas + display-label maps, grouped by domain
  projects/, challans/, adjustments/, documents/, settings/, ocr/
services/               Business logic — the only place that talks to Prisma
                         for writes (route handlers stay thin)
  financials.ts          Pure functions ported from the prototype's <script>
  projectService.ts, challanService.ts, runningBillService.ts,
  adjustmentService.ts, documentService.ts, settingsService.ts, searchService.ts
  ocr/                    provider.ts (interface), providers/tesseract.ts,
                         providers/unimplemented.ts (azure/google-vision/textract stubs),
                         index.ts (factory + runOcrOnDocument), textParser.ts
prisma/                 schema.prisma, migrations/, seed.ts
supabase/               policies.sql (storage bucket + policy — not Prisma-owned)
styles/                 tokens.css (design tokens), globals.css, layout.module.css
public/                 watcon-logo.png (extracted from the prototype's embedded base64)
```

## Component hierarchy (project detail page)
```
app/projects/[id]/page.tsx (Server Component)
  → fetches Project + Settings via Prisma, builds a plain-JSON view model
  → ProjectDetailClient (Client Component — receives the view model as props)
      → ProjectHeader (status PATCH mutation)
      → Tabs (local state, no routing — matches the prototype)
      → one of: OverviewTab | SalesOrderTab | ChallansTab | BillsTab |
                PaymentsTab | SiteAccountsTab | DiscountsAmendmentsTab | DocumentsTab
          → each owns its own mutations (TanStack Query) and modals
          → Challans/Bills/SiteAccounts print via a shared #printArea portal
            (hooks/usePrintPortal.ts) rendering components/PrintDoc/* components
```

Reads are server-rendered directly from Prisma (no client-side data-fetching library for GETs); writes go through `/api/*` route handlers and trigger `router.refresh()` to re-fetch server data — this is why there's no separate client-side cache/store beyond TanStack Query's mutation state.

## Services (business logic layer)
Route handlers are intentionally thin: parse/validate with Zod, call a service function, map errors to HTTP status. All calculation and cascading logic lives in `services/`:

- **`financials.ts`** — pure, stateless functions ported 1:1 from the prototype's `<script>` block: `orderBase`, `amendTotal`, `discountTotal`, `gstOn`, `contractValue`, `dispatchedQty`/`extraQtyOf` (with an "up to date" cutoff for running-bill cumulative math), `customDispatched`, `dispatchedValue`, `challanValue`, `computeDispatchBalances`, `siteAccountFigures`. Every other service composes these rather than re-deriving totals.
- **`challanService.ts`** — the only place that enforces the dispatch rules server-side (balance-qty cap, extra-qty unlock). Never trusts client input for these.
- **`runningBillService.ts`** — `generateRunningBill()` ports `generateBill()` exactly: section A (SO items) + zoho manual-value challans + section B (extras), discount-cumulative tracking, GST, prior-billed subtraction, refuses to generate if nothing new to bill.
- **`documentService.ts`** + **`lib/supabaseServer.ts`** — Supabase Storage upload/delete using the service-role key (writes need auth; the bucket is public-read).
- **`ocr/`** — provider interface + factory (`OCR_PROVIDER` env var) + Tesseract implementation + heuristic text parser.
- **`searchService.ts`** — parallel `findMany` queries across 8 tables, case-insensitive `contains` matching.

## API routes
All under `app/api/`, REST-ish, Zod-validated bodies, JSON responses:
```
POST   /api/projects                          create project
PATCH  /api/projects/[id]                      update project fields / status
DELETE /api/projects/[id]                      delete (cascades)
POST   /api/projects/[id]/items                add sales order item
PATCH  /api/projects/[id]/items/[itemId]       update item
DELETE /api/projects/[id]/items/[itemId]       delete item
PUT    /api/projects/[id]/items/replace        atomically replace the whole sales order (used by OCR apply)
POST   /api/projects/[id]/payments             record payment
DELETE /api/payments/[paymentId]               delete payment
POST   /api/projects/[id]/challans             create challan (source: ISSUED_HERE | ATTACHED_EXTERNAL)
PATCH  /api/challans/[challanId]               update challan
DELETE /api/challans/[challanId]               delete challan
POST   /api/projects/[id]/bills                generate running bill
DELETE /api/bills/[billId]                     delete bill
POST   /api/projects/[id]/discounts            add discount
DELETE /api/discounts/[discountId]             delete discount
POST   /api/projects/[id]/amendments           add amendment
DELETE /api/amendments/[amendmentId]           delete amendment
POST   /api/documents                          upload (multipart: file + kind + entity id)
DELETE /api/documents/[documentId]             delete (storage object + DB row)
POST   /api/documents/[documentId]/ocr         run OCR, store OcrResult
GET    /api/search?q=                          global search
PATCH  /api/settings                           update settings
GET    /api/settings/export                    JSON data export
```

## Database
See `DATABASE_DOCUMENTATION.md`.

## Print mechanism
A single `<div id="printArea">` lives in the root layout, hidden by default. `styles/globals.css` has the `@media print { body > *:not(#printArea) { display:none } #printArea { display:block } }` rule (ported from the prototype's own `#printArea` CSS). `hooks/usePrintPortal.ts` uses `flushSync` inside the triggering click handler (not a `useEffect`, which would violate `react-hooks/set-state-in-effect`) to synchronously mount the target document into that portal before calling `window.print()`.

## Verification performed this build
`tsc --noEmit`, `eslint .`, `next build` all pass with zero errors on the final state of every phase. Every write path (create/update/delete on every entity) has been exercised against the live Supabase database with hand-verified arithmetic, not just HTTP-status checks — see `PLAN.md` for the specific test scenarios run per phase.
