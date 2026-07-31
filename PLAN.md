# Watcon Project Management — Rebuild Plan

Source spec: `watcon-project-management.html` at the project root (single-file localStorage prototype).
Goal: pixel-exact UI, real backend. **Strict implementation mode** — the HTML
is the permanent, immutable design spec. No redesign, no modernization, no
new UX. If anything is ambiguous, follow the HTML.

**Public app — NO authentication.** No login, signup, sessions, middleware,
or user table. App opens straight to the Dashboard, same as the prototype.
Supabase is used only for Postgres (via Prisma) and Storage.

## Phases
- [x] Phase 0 — Scaffold (Next.js 16 App Router, TS, folder structure) — pinned `next@16.2.12` (patched CVE-2025-66478 + Dec-11-2025 advisory)
- [x] Phase 1 — Database (Prisma schema + Supabase SQL, no auth/users table)
- [x] Phase 2 — Design system components (Button, Card, StatCard, StatsGrid, Chip, Tabs, Segmented, Table, Form/FormField/Inputs, Modal/ConfirmModal/PasswordModal, FileDrop/AttachmentRow, Toast, ProgressBar, Status(Spinner/AiBadge), Header) — CSS Modules ported 1:1 from the HTML `<style>` block. Verified: `tsc --noEmit` clean, `next build` succeeds.
- [x] Phase 3 — Project module: Dashboard (stats + searchable list), New Project form (`ProjectForm`, react-hook-form + zod, manual SO item entry), Project detail workspace (`ProjectHeader` + status change, stats row, tab shell), **Overview** tab (full financial summary + terms/approval), **Sales Order** tab (inline-editable CRUD table), **Payments** tab (full CRUD: record/list/delete). Full Project CRUD (create/edit-status/delete) via `/api/projects` route handlers + `services/projectService.ts`. Verified end-to-end against the live Supabase DB: created a project via the real API, edited/added/deleted Sales Order items, recorded/deleted a payment, confirmed every displayed total (contract value, GST, basic value) recalculates correctly after each mutation, deleted the project and confirmed 404 + cascade.
- [x] Phase 3.5 — Challan + Running Bill engine. `services/challanService.ts` (server-enforced dispatch rules — never trusts the client), `services/runningBillService.ts` (generateBill ported exactly). Challans tab: issue (SO dispatch with live balance-qty table + extra-qty lock), attach Zoho challan (manual value / linked qty, no capping), view (quantities-only doc preview matching the prototype), edit/delete gated behind the prototype's own client-side password prompt, print. Running Bills tab: generate (upto-date + apply-discount), list with A/B extras breakdown, print, delete. Print documents (`components/PrintDoc/`) ported 1:1 from `docHead()`/`challanDocHTML()`/`printBill()`, including the real extracted company logo (`public/watcon-logo.png`, decoded from the prototype's embedded base64) and the `#printArea` portal mechanism from the original CSS. Verified: `tsc --noEmit`, `eslint` (0 errors — fixed a real `set-state-in-effect` issue via a `usePrintPortal` hook using `flushSync`), `next build` all pass. **Live-tested against Supabase with hand-verified math on every case:** over-dispatch rejected (422), extra-qty silently clamped to 0 when SO not fully dispatched, extra-qty correctly unlocks once SO qty is fully dispatched, balance-qty=0 rejects further dispatch, negative qty rejected (400), running bill generation matches hand-calculated gross/GST/discount/prior-billed/net-payable across 3 sequential bills (including a Zoho manual-value challan and a mid-stream discount), double-billing correctly prevented, and all figures confirmed rendering correctly on the actual page (not just the API). **Found and fixed a real schema bug during testing:** `ChallanItem.itemId → PoItem` and `PurchaseOrder.projectId → Project` had no `onDelete` cascade, causing project deletion to throw a live FK violation (`P2003`) — added `onDelete: Cascade` (and `SetNull` on the optional `PoLineItem.linkedItem`), migrated the live DB, re-verified delete works.
- [x] Phase 4 — Site Accounts + Discounts & Amendments + Documents. **Site Accounts** built as the prototype actually has it — a computed, read-only statement (`services/financials.siteAccountFigures`, no editable ledger, since the HTML has none) with running-bills table, account summary, and print (`SiteAccountDoc`, ported from `siteAccountDocHTML()`). **Discounts & Amendments**: full CRUD (`services/adjustmentService.ts`), amendment approval-copy upload. **Documents**: real Supabase Storage integration (`services/documentService.ts`, `lib/supabaseServer.ts`) — per-entity attachment model matching `tabDocs()` exactly (order copy, approval proof, read-only challan-copy/amendment-approval listings), not a categorized DAM. Also wired file upload into the Attach-Zoho-challan modal (challan copy) and the record-payment modal (proof of payment) — both present in the prototype's modals but not yet built in the earlier phase. Verified: `tsc --noEmit`, `eslint`, `next build` all clean. **Live-tested against Supabase**, including a real file round-trip: uploaded a PDF via the actual API → confirmed it downloads byte-for-byte correct from the public Storage URL → deleted it → confirmed both the DB row and the storage object are gone (had to cache-bust past Supabase's CDN cache to see the real post-delete state). Discount/amendment CRUD and the resulting contract-value/site-account math verified against hand calculations. Deviated deliberately from this phase's literal instructions in two places (debit/credit ledger CRUD for Site Accounts; categorized document library) because the prototype has neither — followed the standing "HTML is the only spec" rule instead, flagged to the user before building.
- [x] Phase 5 (final) — Settings + OCR + Global Search + Reports + production polish. **Settings** (`/settings`): full CRUD for company profile/GST rate/challan-bill numbering (matches the prototype's fields exactly, minus the browser-side Anthropic key which no longer applies), read-only JSON export; import deliberately not implemented (see KNOWN_LIMITATIONS.md). **OCR**: real provider abstraction (`services/ocr/provider.ts`), Tesseract.js implemented as the free default (image-only), heuristic text→structured-field parser, review-before-apply UI wired into the Documents tab's order copy. **Global Search**: database-driven, header-level, across projects/challans/bills/payments/documents/discounts/amendments/vendors. **Reports/Filters**: the prototype has neither a dedicated Reports module nor advanced filter UI — flagged and not invented, per the standing HTML-is-the-spec rule (print documents already built ARE the prototype's reporting surface). Accessibility pass: dialog semantics (`role="dialog"`, `aria-modal`, labelled, focus-managed) on Modal, `aria-label` audit closed two real gaps (bare `×` delete buttons on Bills/Payments rows had none). Code-quality pass: removed two dead files (`ComingSoonTab.tsx` from Phase 3.5, `PrintDoc/PrintModal.tsx` — superseded by the `usePrintPortal` pattern), consolidated a third duplicated `todayIso()` definition into `lib/format.ts`. `tsc --noEmit` / `eslint` / `next build` all pass with zero errors, zero warnings beyond one pre-existing benign react-hook-form compiler notice. **Live-tested against Supabase, including a genuinely real OCR round-trip** (not a mock): generated a test image with `sharp`, uploaded it, ran actual Tesseract OCR through the real pipeline, verified every extracted field (PO number, date, vendor, GST terms, both item rows) matched the image content exactly, applied the extracted items to a Sales Order, confirmed the resulting contract value recalculated correctly. Also verified Settings GST-rate changes propagate live to financial calculations, and global search correctly finds projects/challans by name/client/number with a working 2-character minimum. **Found and fixed a real bug during OCR testing**: `tesseract.js`'s internal worker-script path resolution breaks under Turbopack/webpack bundling (`Cannot find module '...worker-script/node/index.js'`) — fixed via `serverExternalPackages: ["tesseract.js"]` in a new `next.config.ts`.
Wrote all 5 final deliverable docs: `COMPLETE_FEATURES.md`, `TECHNICAL_ARCHITECTURE.md`, `DATABASE_DOCUMENTATION.md`, `DEPLOYMENT_GUIDE.md`, `KNOWN_LIMITATIONS.md`.
- [x] Production hardening / final QA pass (zero-bug release audit). Found and fixed **9 real, reproduced-live issues**: (1) path-traversal vulnerability in document upload filename handling — fixed with `sanitizeFileName()`; (2) every PATCH/DELETE route returned raw 500s instead of 404s for non-existent ids — added `lib/apiErrors.ts`, applied across 12 route handlers; (3) duplicate challan numbers crashed instead of returning 409 — added conflict handling; (4) bill numbering could collide after out-of-order deletion, crashing — added a bounded retry-on-conflict loop in `generateRunningBill()` rather than changing the ported formula; (5) `tesseract.js` breaks under Turbopack (same root cause as Phase 5, re-confirmed the fix holds); (6) two icon-only delete buttons missing `aria-label`; (7) Global Search results panel had a fixed `min-width` that could overflow narrow viewports; (8) the prototype's own `@media(max-width:640px){ header.app .bar{padding:12px 14px} }` rule had never been ported — a genuine pixel-fidelity gap, now fixed; (9) document upload touched Storage before validating the parent entity existed — added fail-fast existence checks. Every fix reproduced-then-verified live against Supabase, including a full end-to-end Scenario 1 (create → sales order → challan → bill → discount → payment → document → print-ready → delete) run against the actual **production build** (`next build && next start`, not dev mode). Zero orphaned test data confirmed via direct DB query after the session. Full detail in `FINAL_QA_REPORT.md`, including an honest list of what this pass did NOT cover (real device-matrix testing, screen readers, load testing, concurrency stress testing).
- [x] Final release certification audit (principal-engineer pass). Verified architecture layering (no circular/inverted deps — `services`/`modules`/`lib` never import `components`), dead-file scan (none found), dependency audit (found and removed `pdfjs-dist` — added in Phase 0 for a PDF split-screen viewer that was never built), database index/constraint review (sound; documented the deliberate absence of trigram search indexes given the low-volume use case). Found and fixed a real reliability gap: the OCR "apply" flow replaced Sales Order items via N sequential non-atomic client calls — replaced with a single atomic transaction (`services/projectService.ts#replaceProjectItems`, `PUT /api/projects/[id]/items/replace`) — and then found a bug IN that fix during live testing (false-positive 200 against a non-existent project with an empty items array) and fixed that too. Rewrote a badly stale `README.md` (still claimed "Phase 0/1 only", referenced a `reference/` folder deleted three phases ago). Wrote `RELEASE_v1.0.md`. `tsc`/`eslint`/`next build` all clean; DB confirmed to hold only the original seed project after the full test session.

## Phase 6 — Document Management & Smart Import pivot (in progress)

User directive: replace the OCR-first (auto-interpret-into-fields) workflow
with a document-centric one. No cloud AI (OpenAI/Claude/Azure/Google
Vision) — Tesseract stays (it's classical OCR, explicitly named as the
scanned-PDF tool), but nothing auto-interprets extracted text into
structured fields anymore; text is stored raw, for search only, and any
import into the Sales Order is user-driven (manual row selection / column
mapping), never automatic. This is a large pivot — 23 sub-parts in the
originating spec, realistically a multi-week build. Sequencing honestly
rather than claiming it's all done in one pass:

- [x] **6a — Document model rework**: `DocumentKind` extended with the new
  project-document-library categories (`PURCHASE_ORDER`, `BOQ`, `DRAWING`,
  `INVOICE`, `VENDOR_DOCUMENT`, `RUNNING_BILL_COPY`, `PHOTO`; legacy
  `ORDER_COPY` kept for existing rows). `Document` gained `notes`,
  `checksum` (SHA-256, duplicate detection), and a version-chain
  (`rootDocumentId`/`versionNumber`) where every re-upload is a full new row
  — nothing is ever overwritten in place, matching "nothing should ever be
  lost." Duplicate-on-upload detection (same checksum within a project) and
  encrypted/password-protected PDF detection (clean rejection, not a crash)
  wired into `services/documentService.ts`.
- [x] **6b — Raw text extraction for search** (`services/ocr/`): digital
  PDFs via their embedded text layer (`pdf-parse`, per-page), images via the
  existing Tesseract provider — stored per-page in the new `DocumentText`
  table, deliberately uninterpreted (no field/table guessing). Wired into
  `services/searchService.ts` as a `documentPage` result type (document +
  page number + text snippet). The old heuristic field-parser
  (`services/ocr/textParser.ts`), its schema (`modules/ocr/schema.ts`), and
  the auto-populate-Sales-Order flow (`OcrReviewModal`) are DELETED — the
  route is now `/api/documents/[id]/extract-text`. **Live-verified end to
  end**: real PDF upload → duplicate 409 + override → per-page extraction →
  search hit with correct page/snippet → version-replace chained v2 to root
  → project delete cascaded documents/versions/texts with zero orphans.
  **Third instance of the Turbopack worker-path bug class found**: pdf-parse
  (wraps pdf.js) needs `serverExternalPackages` just like tesseract.js —
  any package resolving worker/wasm files via runtime filesystem paths will.
- [ ] **6c — Document Library UI**: per-project category browser (grid/list
  with preview thumbnails, filename/size/date/type/notes/version columns),
  quick actions (rename/move/copy/download/replace/print/delete), version
  history view with restore.
- [ ] **6d — PDF Viewer**: zoom, rotate, fit width/page, page thumbnails,
  in-document text search, page jump, fullscreen, print, download, last-
  viewed-page memory. Needs `pdfjs-dist` reinstalled (removed as unused in
  the RC1 audit — it becomes genuinely needed here) and a real viewer
  component, not a small addition.
- [ ] **6e — Side-by-side workspace**: PDF viewer (left) + project info/
  items/financial summary (right), the new primary project-review screen.
  Depends on 6d.
- [ ] **6f — Excel/CSV import**: workbook + sheet preview, data grid,
  column mapping (Description/Qty/Unit/Rate/Amount/HSN/GST/Remarks),
  reusable named mapping templates. Needs a spreadsheet-parsing library
  (e.g. `xlsx`/`exceljs`) not yet a dependency.
- [ ] **6g — Smart Import review grid**: checkbox-gated selective import
  (project info / vendor / PO / items / notes independently), editable
  extracted-rows grid (insert/duplicate/delete/bulk-edit/sort/filter,
  invalid-cell highlighting). Depends on 6f (and, for PDF tables, real table
  extraction — no reliable open-source table-structure extraction exists
  without a native/Python toolchain (e.g. Camelot), which is a real
  discussion to have before committing to it — flagged, not silently
  skipped).
- [ ] **6h — Upload-first New Project flow**: replace the current manual
  form's position as the *only* entry point with Upload → Preview → Review
  → Create. Depends on 6c/6d/6e/6f/6g existing first — building the entry
  flow before the screens it hands off to would just be a dead end.
- [ ] **6i — Project dashboard document stats**: PO/Invoice/BOQ/Drawing/
  Running-Bill counts, total documents, storage used, chronological
  document timeline.
- [ ] **6j — Project export/import (ZIP)**: full project + documents +
  metadata export; import deferred pending a decision on how it interacts
  with the "no bulk-overwrite via button" stance already taken on Settings
  backup (see `KNOWN_LIMITATIONS.md`) — importing *new* projects from a ZIP
  is a different, safer operation than restoring over live data, but needs
  its own explicit scoping.
- [ ] **6k — Performance at scale** (1000+ documents, 200MB PDFs, virtual
  scrolling, lazy loading, background indexing): meaningful only once 6c/6d
  exist to actually render that volume — sequenced last on purpose.

## Design tokens (from source HTML `:root`, preserved exactly — see `styles/tokens.css`)
```
--ink:#12262E; --muted:#5B6E74; --bg:#EFF3F4; --surface:#FFFFFF;
--primary:#0E6E7A; --primary-dark:#0A4E57; --primary-soft:#E2F0F1;
--accent:#C99A3C; --line:#D6DFE1; --ok:#1E7F4F; --ok-soft:#E4F2EA;
--danger:#B3372E; --danger-soft:#F7E7E5; --warn:#9A6A15; --warn-soft:#F6EEDB;
--radius:10px;
fonts: Archivo (sans), IBM Plex Mono (mono)
```

## Component inventory (Phase 2 — `components/`, CSS Modules, ported from HTML classes)
- `Button` (.btn, .btn.p, .btn.d, .btn.sm, .btn.ghost)
- `Card` (.card / .hd / .bd)
- `StatCard` (.stat, .stat.hl, .val.pos/.neg)
- `Chip` / `Badge` (.chip teal/gold/green/red/grey)
- `Tabs` (.tabs button.on)
- `Segmented` (.seg button.on — approval-mode selector)
- `Table` (.tbl, sticky header, .r alignment, .tbl-wrap scroll)
- `Modal` (.modal-bg/.modal/.hd/.bd/.ft) + `ConfirmModal` + `PasswordModal` (port `pwdModal`/`confirmModal`)
- `Input`, `Select`, `Textarea`, `DatePicker` (label.f / span.t wrapper)
- `FileDrop` (.drop, drag states) + `AttachmentRow` (.att)
- `Toast` (.toast)
- `ProgressBar` (.bar-track/.bar-fill)
- `AiBadge` (.ai-badge) + `Spinner` (.spin)
- `PrintDocument` layout (.doc, .dhead, .dtitle, .meta, .sig — challan/bill/statement templates)

## Domain logic to port faithfully into `services/financials.ts` (Phase 4-7)
Exact formulas from the HTML `<script>` — do not rewrite/simplify:
- `orderBase`, `amendTotal`, `discountTotal`, `gstOn`, `contractValue`
- `dispatchedQty(item, uptoDate)`, `extraQtyOf(item, uptoDate)` — cumulative per SO item
- `customDispatched(uptoDate)` — items on challans not in the SO, aggregated by description+unit
- `dispatchedValue(uptoDate)`, `challanValue(challan)`
- Running bill generation: gross-to-date (A: SO items + B: extras) minus discount-cum minus GST-extra logic minus prior-billed = net payable; refuse generation if net payable <= 0
- Site account statement: billable-to-date, billed, unbilled, received, balance
- Challan qty rules: "dispatch now" capped at balance qty; "additional qty" (beyond BOQ) only unlocks once full SO qty for that item has been dispatched

## OCR extraction contract (Phase 9)
Same JSON shape the HTML's `extractOrder()` prompt required:
```
{ clientName, poNumber, poDate, siteAddress,
  terms: { gst, transport, payment },
  items: [{ description, unit, qty, rate }] }
```
Provider interface in `services/ocr/provider.ts`, first implementation `services/ocr/providers/anthropic.ts` (Claude vision — mirrors the prototype's Anthropic Messages API call), swappable for Google Vision/Azure/Textract/Tesseract later.

## Workflow (must match prototype navigation exactly)
Dashboard → Projects (list) → Project detail tabs: Overview, Sales Order, Challans, Running Bills, Payments, Site Accounts, Discounts & Amendments, Documents → Reports/print from within each tab (no separate "Purchase Orders" nav item in the prototype's UI — the `purchase_orders` table exists for the vendor-facing PO module required by spec but its screens are additive, not a prototype tab).
