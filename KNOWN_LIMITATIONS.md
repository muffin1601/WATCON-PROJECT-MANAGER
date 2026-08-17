# Known Limitations

Written honestly — this documents what genuinely doesn't work or wasn't built, not a hedge-everything disclaimer list. If something isn't mentioned here, it was tested and works.

## AI document engine (see AI_DOCUMENT_ENGINE.md)

- **Not yet run against the live Anthropic API.** No `ANTHROPIC_API_KEY` was available in this environment, so every layer *around* the model call was tested and passes — file-type gating, PDF page-count and encryption guards, XLSX/CSV conversion including merged cells, all validation rules, the mapper's output against the form's own schema, project and line-item matching against the real database, and the backup export/compress path. The Claude call itself, and therefore end-to-end extraction accuracy on your real BOQs, has **not** been observed. Set the key and run one real PO through the New Project form before trusting it in production.
- **Extraction accuracy on your specific documents is unproven.** The prompt encodes the domain rules the prototype had tuned against genuine Zoho POs (discount handling, GST basis, "Make:" rows, "RO" quantities), but those rules were carried over on the strength of that earlier tuning, not re-validated here against real files. Budget for one round of prompt tuning against a handful of your actual BOQs.
- **Page and size ceilings are hard.** 50 pages and 20 MB per document; larger files are rejected with a message telling the user to split them, not silently truncated.
- **Serverless duration.** `/api/ai/extract` requests `maxDuration = 300`. On Vercel Hobby (60s cap) a large scanned BOQ will be killed mid-extraction; the job is reaped and reported as a timeout. Use a plan that permits 300s, or a long-running Node host.
- **DOCX is not accepted** for AI reading (PDF, scanned PDF, XLSX, XLS, CSV, PNG, JPG, JPEG are). Export Word documents to PDF first — the same guidance the prototype gave.
- **Cost is real and per-document.** Roughly ₹1,300/month at typical volume, but a 50-page scanned BOQ is a genuinely expensive single call. Token usage per job is recorded on `ExtractionJob.usage`; watch it for the first month.

## Google Drive backup

- **Not yet run against a real Drive account.** No service-account credentials were available, so the export → gzip → timestamp → record pipeline was verified (79% compression on the current dataset, correct gzip magic bytes, `BackupRun` audit rows, retry-with-backoff, and a clean "not configured" failure), but no file has actually been uploaded to Drive. Run `?force=1` once after configuring credentials and confirm the file appears in the folder.
- **Backups are never pruned.** The spec said keep previous backups, so nothing deletes them — Drive storage will grow by roughly one compressed export per week. Prune manually if that matters.
- **Attachment files are not in the backup.** The export contains database rows including document *metadata*, but not the file bytes in Supabase Storage. A full restore needs Supabase's own storage backup as well.

## OCR (search indexing only — document extraction now uses the AI engine above)

Everything in this section still applies to `services/ocr/`, which powers full-text search over uploaded documents. It is **no longer on the extraction path**: Claude reads PDFs and scans directly, so the PDF/rasterization limitation below no longer constrains BOQ, PO or challan reading.

- **Provider**: only `tesseract` (Tesseract.js) is implemented. `azure`, `google-vision`, `aws-textract` are typed stubs (`services/ocr/providers/unimplemented.ts`) that prove the `OcrProvider` interface is genuinely swappable — wiring in a real one requires only implementing `extract()`, no changes anywhere else.
- **Image input only** (search indexing only; superseded for extraction). PDF OCR is NOT supported by the Tesseract provider — it throws a clear error if you try. Rasterizing a PDF to images server-side needs `node-canvas` (a native dependency), which wasn't safe to assume works in every deployment target without dedicated verification. Workaround: convert the PDF to PNG/JPG first, or implement a real vision-based provider (Azure/Google/Textract handle PDFs natively).
- **Extraction accuracy is genuinely limited, by design of the tool, not a bug.** Tesseract produces raw unstructured text with no layout/table awareness. `services/ocr/textParser.ts` is a regex/heuristic parser on top of that raw text — it was verified end-to-end on a clean, well-formatted test image (correctly extracted PO number, date, vendor, GST terms, and two item rows), but a real scanned/photographed PO with skew, noise, or an unusual layout will extract less reliably, especially the item table. This is *why* the review-and-edit modal is mandatory before anything is saved — the architecture assumes low-confidence extraction and designs for correction, not auto-apply.
- **Cold-start latency**: Tesseract downloads its English language data on first use per process — expect a slower first OCR call after a deploy or server restart (10–30s observed), fast afterward.
- **Turbopack/webpack gotcha already fixed**: `tesseract.js` resolves its worker script via a runtime path lookup that bundlers rewrite and break. Fixed via `serverExternalPackages: ["tesseract.js"]` in `next.config.ts` — if you ever remove or "clean up" that config, OCR will silently fail with `Cannot find module '...worker-script/node/index.js'`.

## Deliberate deviations from generic phase instructions (followed the HTML instead)

Several phase prompts during this build described functionality that doesn't exist in the actual prototype (`watcon-project-management.html`). Per the standing rule across every phase ("the HTML file is the only spec — never invent new UX"), these were flagged before building and the prototype's actual behavior was followed:

- **Site Accounts** is a read-only computed statement (material sent, discounts, GST, billed, unbilled, received, balance), not an editable debit/credit ledger with linked-entity fields. The prototype's `tabAccounts()` has no add/edit/delete — it's entirely derived from challans, bills, discounts, and payments already recorded elsewhere.
- **Documents** is a per-entity attachment model (order copy, approval proof, challan copies, amendment approvals), not a categorized document library with Invoices/Drawings/Contracts/Photos/Other categories. The prototype's `tabDocs()` has no such categorization.
- **Reports module**: there is no dedicated "Reports" page/section, because the prototype has none. Its only reporting/export surface is the print documents (challan, running bill, site account statement) — already built pixel-matched to the prototype. No Excel export exists in the prototype, so none was added.
- **Advanced filters** (status/date-range/vendor/type dropdowns): the prototype has only a single client-side text search on the dashboard project list. That was kept as-is on the dashboard. The newer Customers, Item Sheet and Quotations screens **do** have database-backed search, filtering, sorting and pagination, because those lists grow without bound and cannot be filtered in the browser.

If any of these should actually be built as new functionality (not a port), that's a product decision for a human to make explicitly — it wasn't assumed.

## Settings

- The prototype's "Anthropic API key" field is intentionally absent, and stays absent now that the AI engine exists. The prototype needed it because it called the Anthropic API from the browser, which meant the key sat in `localStorage` where any visitor to the deployed page could read it. Here the key is a server-side env var (`ANTHROPIC_API_KEY`) that never reaches the client, so there is deliberately no user-facing field for it.
- **"Import backup" is not implemented.** The prototype's version was a client-side `localStorage` overwrite with no real consequence. Here it would mean bulk-overwriting a live production database from an uploaded JSON file — a fundamentally different risk that deserves a deliberate, reviewed script, not a button in a settings page. Export (read-only) is implemented.

## Purchase module — implemented

Suppliers, the three-step Rate Inquiry wizard, the self-contained supplier reply form and its import, the landed-rate comparison sheet, PO issue, PO receipts and all three print documents (Rate Inquiry, Rate Comparison Sheet, Purchase Order) are built and tested.

Two things worth knowing about receipts:

- **`receivedQty` is a running total, not an increment.** The server posts only the difference to stock, so saving the same figure twice adds nothing. Re-entering a lower figure posts a negative `ADJUST_OUT` rather than rewriting history.
- **A downward correction carries no rate or vendor**, deliberately: recording it as a purchase would corrupt the "last purchase price" that both costing sheets read.

## Backup import / export

`exportAllData()` and `importBackup()` **must stay in step**. Import replaces what it restores, so any table present in one and missing from the other is a data-loss bug. Two rules encode this:

1. The export covers every business table (projects and all their children, customers, quotations, vendors, the item sheet, item masters with stock entries, rate inquiries and purchase orders).
2. The import only clears a table when the file actually carries a section for it. An older backup that predates a section therefore leaves that table alone instead of destroying data it cannot put back.

Credentials (the deletion password hash and the Anthropic API key) are never written into a backup and never restored from one.

Attachment **files** are still not in the backup — only their metadata rows. The files live in Supabase Storage and are untouched by import/export, so a restore re-attaches documents that are still there; a full disaster recovery also needs Supabase's own storage backup.

## Customers, Item Sheet and Quotations (added — what is and isn't covered)

These three modules are fully built end-to-end (schema, migration, service, API, UI, print) and were tested against the live database. What they deliberately do **not** yet include:

- **Costing sheets** (Project Costing tab and the Quotation Costing sheet tab) are built. The automatic cost rate comes from the Item Sheet's purchase list price less our purchase discount, falling back to the most recent real purchase; per-line manual overrides are stored per project/quotation. Both are gated on the `costing` permission, so a salesperson can quote without seeing what the company pays.
- **Quotation attachments.** Quotations have no document attachments of their own; projects still do. The prototype has none either.
- **Customer archive vs delete.** Customers and catalogue items with history are archived, never hard-deleted, so nothing that a project or quotation points at can vanish. Only a completely unused record can be deleted outright. This is intentional, not a missing feature.

## Authentication & permissions — now implemented

The app is **no longer public**. Sign-in, per-module View/Create/Amend/Delete permissions and the Admin user panel from the reference HTML are all built, with the changes a real server requires:

- Passwords are stored only as scrypt hashes; the prototype's plaintext-in-localStorage model is not reproduced.
- The browser holds an opaque random session token in an `httpOnly` cookie; only a SHA-256 hash of it is stored, so database read access does not grant login.
- **Authorisation is enforced server-side in all 61 API handlers** via `requirePermission(module, action)`, not by hiding buttons. `middleware.ts` additionally rejects any unauthenticated API request before it reaches a handler.
- Sign-in failures return one message for unknown user / wrong password / deactivated account, and spend the same hashing time either way, so the form cannot enumerate usernames.
- The last active administrator cannot be demoted, deactivated or deleted, and no route ever selects `passwordHash` into a payload.

First run creates the `admin` account using the existing Settings password, so an existing deployment is not locked out. Change it from Admin immediately.

Two deliberate deviations from the prototype, both because it ran entirely in the browser:
- **Permissions are re-checked on the server.** In the prototype `can()` ran in the browser and could be bypassed from the console.
- **Costing is gated on its own `costing` permission**, so a salesperson can quote without seeing what the company pays.

## Responsive / Accessibility / Performance

- **Responsive**: the ported CSS carries over the prototype's own mobile breakpoints (header, main content padding, project list card stacking). Newly-built UI (modals, tables inside modals, the Challan issuing table) was visually reviewed but not tested against a real device matrix — only browser viewport resizing. Wide tables inside modals (e.g. the Issue Challan balance table) may need horizontal scroll on narrow phones; this wasn't specifically stress-tested.
- **Accessibility**: modals have `role="dialog"`, `aria-modal`, labelled titles, and initial focus; icon-only buttons have `aria-label`s; the Tabs component uses `role="tab"`/`aria-selected`. This is a reasonable baseline pass, not a full WCAG audit — no screen-reader testing was performed, and color contrast was deliberately left unchanged (the instruction was explicit: don't alter the design for this).
- **Performance**: this is a low-data-volume internal tool (dozens of projects, not thousands), and no performance bottleneck was observed or is expected at that scale. No pagination, virtualization, or aggressive memoization was added because there's no evidence it's needed yet — adding it preemptively would be exactly the kind of premature optimization the project's own engineering guidelines warn against. Revisit if project/challan counts grow into the hundreds+ per project.

## Security / dependencies

- `npm audit` reports 12 high-severity advisories against transitive `postcss`/`sharp` (pulled in by Next.js's image optimizer). The only "fix" `npm audit fix --force` offers is downgrading Next.js to `9.3.3`, which is not viable. `next@16.2.12` (current stable) already includes the two real, actionable CVE fixes checked during this build (CVE-2025-66478, the Dec-11-2025 advisory). Re-check `npm audit` before each deploy and take the next non-breaking Next.js patch as soon as one lands.
- The Challan edit/delete "password" (`pincode110020`, hardcoded in `components/ProjectDetail/ChallansTab.tsx`) is the exact same non-auth UX the prototype had — a soft speed-bump, not a real access control. The whole app is intentionally public/no-login per the explicit master spec; don't mistake this for a security feature.

## Database connectivity

During development, Supabase's pooled connection (port 6543, pgbouncer) was intermittently unreachable from this build environment's network, while the direct/session connection (port 5432) was consistently reliable. This may be specific to that network path and not recur in production — noted in `DEPLOYMENT_GUIDE.md` as a thing to watch for, not a confirmed production issue.
