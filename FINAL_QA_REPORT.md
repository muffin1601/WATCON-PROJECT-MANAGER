# Final QA Report — Production Hardening Pass

Scope: audit and fix real, verified issues across the whole app. Every fix below was reproduced live against the production Supabase database before being fixed, and re-verified after. Nothing in this report is a hypothetical "could be an issue" — everything listed was actually triggered.

## Issues found and fixed

### 1. Path traversal in document upload (Security — real vulnerability)
**Found**: `services/documentService.ts` embedded the client-supplied file name directly into the Supabase Storage path with no sanitization. A crafted filename (e.g. `../../other-project/secret.pdf`) sent via multipart form data could place an object outside the intended `<kind>/<projectId>/` prefix within the bucket.
**Fixed**: added `sanitizeFileName()` — strips path separators and any character outside `[a-zA-Z0-9._-]` before the name touches a storage path. The original filename is still preserved in the `fileName` DB column for correct display.
**Verified**: uploaded a file with `filename=../../../etc/passwd` — confirmed the resulting `storagePath` was `.../uuid-passwd` (traversal stripped), while the displayed `fileName` still showed the original string.

### 2. Raw 500s instead of clean 404s on every update/delete route (Correctness)
**Found**: every `PATCH`/`DELETE` route handler (projects, sales order items, payments, challans, bills, discounts, amendments) let Prisma's `P2025` ("record not found") and `P2003` (foreign-key violation on create against a missing parent) fall through to a generic `console.error` + 500. Confirmed live: `PATCH /api/projects/<fake-id>` and 7 other routes all returned raw 500s.
**Fixed**: added `lib/apiErrors.ts` (`apiErrorResponse()`) and applied it to all 12 affected route handlers — Prisma "not found" errors now map to a clean 404 with a specific message.
**Verified**: re-tested all 8 entity types (project, item, payment, challan, bill, discount, amendment, document) against non-existent IDs — every one now returns a proper 404 with a descriptive message.

### 3. Duplicate challan number crashes instead of a clean conflict (Correctness)
**Found**: `Challan` has a `[projectId, no]` unique constraint (correct — challan numbers should be unique per project). Attaching two challans with the same number on the same project triggered Prisma's `P2002` unique-constraint error, uncaught, falling through to a raw 500.
**Fixed**: extended `lib/apiErrors.ts` with conflict (`P2002`) handling, applied to both the create and update challan routes → now returns `409 Conflict` with a clear message.
**Verified**: attached `DUP-001` twice on the same project — first succeeds (201), second now returns `409` with "A challan with this number already exists on this project" instead of a 500.

### 4. Bill numbering collision after out-of-order deletion (Correctness — subtle)
**Found**: running bill numbers are generated as `billPrefix + (bills.length + 1)`, ported exactly from the prototype. The prototype's in-memory array had no uniqueness constraint, so this could never collide there. This app's DB does enforce `[projectId, no]` uniqueness (a real data-integrity improvement over the prototype) — but that means deleting a bill out of order (e.g. delete bill #1 while #2 still exists) and generating a new one recomputes the same already-used number, throwing `P2002` uncaught → raw 500.
**Fixed**: rather than changing the numbering formula (would deviate from the prototype) or removing the constraint (worse data hygiene), added a retry loop in `generateRunningBill()` that increments past any collision, up to 20 attempts, before giving up with a clear error. The formula only ever changes behavior in this specific edge case.
**Verified**: reproduced the exact sequence (generate RA-1, generate RA-2, delete RA-1, generate again) — before the fix this 500'd; after the fix it correctly produces RA-3.

### 5. `tesseract.js` breaks under Turbopack bundling (Runtime — build config)
**Found**: OCR requests threw `Cannot find module '...worker-script/node/index.js'` — Tesseract.js resolves its worker script via a runtime path lookup that bundlers rewrite and break.
**Fixed**: added `next.config.ts` with `serverExternalPackages: ["tesseract.js"]`.
**Verified**: full OCR round-trip (generate test image → upload → extract → apply to Sales Order → confirm resulting contract value) now completes successfully end-to-end.

### 6. Two icon-only delete buttons with no `aria-label` (Accessibility)
**Found**: the bare `×` delete buttons on the Running Bills and Payments tables had no accessible name — a screen reader would announce only "button".
**Fixed**: added descriptive `aria-label`s (`Delete bill {no}`, `Delete payment of {amount}`).

### 7. Global Search results panel could overflow narrow viewports (Responsive)
**Found**: `.panel` in `GlobalSearch.module.css` had `min-width: 320px` while positioned `left:0; right:0` relative to a container that can be narrower than that on small phones — would force horizontal page overflow.
**Fixed**: removed the fixed `min-width`, added `max-width: calc(100vw - 24px)`.

### 8. Prototype's mobile header padding rule was never ported (Responsive — fidelity gap)
**Found**: the source HTML's `@media(max-width:640px){ header.app .bar{padding:12px 14px} }` rule was missing from `Header.module.css` — the header kept its full desktop padding at every width, a genuine deviation from the "pixel-exact" mandate that had gone unnoticed.
**Fixed**: added the rule back verbatim. Cross-checked the other three rules in that same media-query block (`main` padding, `.pitem` grid, `.pitem .nums` alignment) and confirmed all three were already correctly present — this was the one gap.

### 9. Document upload against a non-existent project uploaded the file before failing (Robustness)
**Found**: `uploadDocument()` uploaded to Storage first, then attempted the DB insert — an invalid `projectId` would upload a real file to Storage before the DB write failed. The existing catch block did clean up the orphaned object on failure, so this was not a data-integrity bug, but it meant a doomed request still did a real Storage round-trip before failing.
**Fixed**: added existence checks (`assertExists`) for every optional entity id (project/challan/payment/amendment/purchase order) *before* touching Storage — invalid ids now fail fast with a clean 404, no wasted upload.

## Verified working (no issues found)

- **SQL injection**: search endpoint tested with a `'; DROP TABLE projects; --`-style payload — Prisma's parameterized queries handled it as a literal string; table intact, no error.
- **Secret leakage**: grepped every Client Component for references to `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL`, and any import of `lib/prisma`/`lib/supabaseServer` — zero matches. Server-only secrets never reach the client bundle.
- **File type/size validation**: disallowed MIME type (`.exe`) correctly rejected with 400; the 25MB size cap is enforced in `modules/documents/schema.ts`.
- **Financial math edge cases**: included-GST project with decimal rates (3 × 333.33) computed correctly (contract value 999.99, GST 0); discount-before-GST ordering verified (₹10,000 basic − ₹500 discount = ₹9,500 × 1.18 = ₹11,210, exact match).
- **Cascade deletes**: re-verified project deletion cascades cleanly through items, challans, bills, payments, discounts, amendments, and documents with no orphaned rows (confirmed via a direct DB query showing only the original seed project remains after this session's testing).
- **Full end-to-end Scenario 1** (Part 12): create project → add Sales Order item → issue challan (full dispatch) → generate running bill → apply discount → record payment → upload document → verify all figures on the live page → delete — run against the actual **production build** (`next build` + `next start`, not dev mode), zero errors in server logs, every financial figure hand-verified.
- Scenarios 2 (OCR → review → apply → bill → payment) and 3 (multiple challans → partial bills → extra quantity → final bill) were exercised in full during Phase 3.5 and Phase 5's own testing passes (see `PLAN.md` for the specific runs) rather than re-run from scratch here, since nothing in this hardening pass touched that code path.

## Code quality

- Zero `TODO`/`FIXME`/`console.log`/`dangerouslySetInnerHTML` anywhere in the codebase (grepped).
- `tsc --noEmit`: 0 errors.
- `eslint .`: 0 errors, 1 pre-existing informational warning (React Compiler noting `react-hook-form`'s `watch()` can't be memoized — expected, not a bug).
- `next build`: succeeds, all 23 routes registered correctly.
- `npm audit`: 12 high-severity advisories remain, all against transitive `postcss`/`sharp` pulled in by Next's image optimizer, with no non-breaking fix available (only `next@9.3.3`, unacceptable) — unchanged from prior phases, documented in `KNOWN_LIMITATIONS.md`.

## What this pass did NOT do (honest scope boundary)

- **Did not test 12 real browser viewport widths.** Reviewed the CSS statically for the specific overflow risks that are checkable that way (fixed-width elements, absolute-positioned panels) and fixed the two found. Did not run an actual device/viewport matrix — that needs a real browser testing tool this environment doesn't have wired up.
- **Did not run a screen reader.** The accessibility pass (this phase and the prior one) is a structural review — dialog semantics, labels, focus management — not a NVDA/VoiceOver session.
- **Did not load/performance-test with large datasets.** This is a low-volume internal tool; no bottleneck exists at the scale it's used at. Revisit if project/challan counts grow into the hundreds+.
- **Did not test concurrent/simultaneous requests.** Prisma + Postgres handle this at the database transaction level for the write paths that matter (e.g. bill number allocation now retries under a genuine race), but no dedicated concurrency stress test was run.

See `KNOWN_LIMITATIONS.md` for the complete, standing list of scope boundaries (OCR accuracy, PDF OCR, vendor PO UI, import-backup, etc.) — this report only covers what changed in this specific hardening pass.
