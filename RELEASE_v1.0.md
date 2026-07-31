# Release v1.0 — Release Candidate

**Status: production-ready.** This release has been through feature development, production hardening, and a principal-engineer-level release audit, with every fix live-verified against the real Supabase database — not just typechecked.

## Summary

A production Next.js rebuild of the single-file `watcon-project-management.html` prototype: the same UI, workflow, and financial logic, now backed by a real Postgres database (Supabase) and real file storage, with no authentication (public, single-tenant, by design — see `PLAN.md`).

## Completed modules

- **Dashboard** — live stats, searchable project list
- **Projects** — full CRUD, 8-tab workspace (Overview, Sales Order, Challans, Running Bills, Payments, Site Accounts, Discounts & Amendments, Documents)
- **Sales Order** — inline-editable line items with live dispatched/balance/extra-qty tracking
- **Challans** — issue against Sales Order (server-enforced balance-qty capping and extra-qty unlock rules) or attach externally-issued (Zoho) challans; view, edit, delete, print
- **Running Bills** — generation engine (gross/discount/GST/prior-billed cascade, never double-bills), print
- **Payments** — record/list/delete with optional proof-of-payment upload
- **Site Accounts** — computed statement + print (matches the prototype: read-only, not a ledger)
- **Discounts & Amendments** — full CRUD, immediately affecting every downstream calculation
- **Documents** — real Supabase Storage integration, per-entity attachment model
- **Settings** — company profile, GST rate, numbering, JSON export
- **OCR** — provider-abstracted, Tesseract.js implemented (image input), review-before-apply
- **Global Search** — database-driven, across 8 entity types
- **Print** — challan, running bill, and site account statement, pixel-matched to the prototype

Full detail: `COMPLETE_FEATURES.md`.

## What changed since the last checkpoint (this release audit)

Two real issues found and fixed during this specific pass:

1. **Documentation drift**: `README.md` still claimed the project only covered "Phase 0/Phase 1" and referenced a `reference/` folder deleted three phases ago. Rewritten to reflect the actual final state and link every doc.
2. **Unused dependency**: `pdfjs-dist` was added speculatively in the initial scaffold for a PDF split-screen viewer that was never built (documents are viewed via "open in new tab" instead). Removed.
3. **Non-atomic Sales Order replace**: the OCR "apply extracted data" flow deleted and recreated Sales Order items via N sequential client-side API calls — a failure partway through could leave the Sales Order empty or half-populated. Replaced with a single atomic server-side transaction (`PUT /api/projects/[id]/items/replace`).
4. **Bug in the fix for #3**: the new atomic-replace endpoint initially returned a false `200 OK` when called against a non-existent project with an empty items array (`deleteMany`/skipped-`createMany` don't validate the parent exists). Added an explicit existence check — caught by testing the exact edge case, not by inspection.

Everything else (architecture, dependencies, database indexes/constraints, API consistency, security posture) was audited and found sound — no further changes were made. See the per-section findings below.

## Architecture & dependency audit

- No circular or inverted dependencies: `services`/`modules`/`lib` never import from `components` (verified by grep, not assumption).
- No dead files: every component/service/hook is imported somewhere (one apparent false positive — `services/ocr/index.ts` — resolved as a directory-index import, correctly in use).
- No `TODO`/`FIXME`/`console.log`/debug code anywhere in the codebase.
- Every remaining dependency in `package.json` is genuinely used (checked individually after removing `pdfjs-dist`).
- Database indexes/constraints reviewed: all cascade rules correct (including the two fixed in earlier phases), all appropriate unique constraints in place. Search-relevant columns (`Challan.no`, `Payment.reference`, `Vendor.name`, etc.) have no dedicated full-text/trigram index — acceptable for this app's documented low data volume, since a plain B-tree index wouldn't meaningfully accelerate the `ILIKE`-style `contains` queries `services/searchService.ts` runs anyway; a real trigram index (`pg_trgm`) would be the correct future addition if project/record counts grow large, not a plain index.

## Deployment readiness

- `npm install && npx prisma generate && npm run build` succeeds cleanly.
- `npx next start` (actual production server, not dev mode) verified serving the dashboard, settings, and new-project pages, and a full create→dispatch→bill→discount→payment→document→delete scenario with zero server-side errors.
- Environment variables, Supabase setup, and Vercel deployment steps documented in `DEPLOYMENT_GUIDE.md`.
- Migrations are current (`prisma/migrations/`); no schema changes were needed in this release audit.
- Backup strategy documented (`DEPLOYMENT_GUIDE.md` — JSON export via Settings; no bulk-import, by design).

## Final acceptance checklist

- ✅ Builds cleanly (`next build`, zero errors)
- ✅ Starts cleanly (`next start`, verified against real requests)
- ✅ No TypeScript errors (`tsc --noEmit`)
- ✅ No ESLint errors (one pre-existing informational warning, not an error)
- ✅ Database integrity verified (cascade deletes, no orphaned rows after this session's full test suite)
- ✅ Storage verified (real upload/download/delete round-trip, byte-for-byte correct)
- ✅ OCR verified (real Tesseract round-trip on a generated test image, every field matched)
- ✅ Financial engine verified (GST included/extra, decimals, discount-before-GST ordering, multi-bill sequences, all hand-checked)
- ✅ Print layouts verified (challan, running bill, site account — pixel-matched to the prototype)
- ✅ CRUD verified on every entity (project, item, challan, bill, payment, discount, amendment, document, settings)
- ✅ Search verified (finds by name/client/number, safe against injection payloads, 2-char minimum)
- ✅ Accessibility improvements verified (dialog semantics, labelled controls, focus management)
- ✅ Responsive layouts verified for the specific overflow risks that are checkable via static CSS review (two found and fixed this cycle); **not** verified against a real device/viewport matrix — see `KNOWN_LIMITATIONS.md`

## Known limitations (unchanged from prior phases)

See `KNOWN_LIMITATIONS.md` for the full list. Headline items: Tesseract OCR is image-only and best-effort on real-world scan quality; no vendor-facing Purchase Order UI (schema-only); no "Import backup" (deliberate); no Reports module or advanced filters (the prototype has neither).

## Upgrade notes

No database migration is required to adopt this release over the previous checkpoint — the only schema-relevant change (`replaceProjectItems`) uses existing tables. If deploying fresh, follow `DEPLOYMENT_GUIDE.md` from scratch.

## Future roadmap (optional, not committed)

- Vendor-facing Purchase Order screens (schema already supports it)
- A real vision-based OCR provider (Azure/Google/Textract) for PDF input and higher accuracy
- `pg_trgm` search indexes if data volume grows significantly
- Real device-matrix responsive testing and a screen-reader accessibility pass
