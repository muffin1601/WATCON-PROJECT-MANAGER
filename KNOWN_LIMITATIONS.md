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
- **Advanced filters** (status/date-range/vendor/type dropdowns): the prototype has only a single client-side text search on the dashboard project list. That was kept as-is; no new filter UI was invented on top of it.

If any of these should actually be built as new functionality (not a port), that's a product decision for a human to make explicitly — it wasn't assumed.

## Settings

- The prototype's "Anthropic API key" field is intentionally absent, and stays absent now that the AI engine exists. The prototype needed it because it called the Anthropic API from the browser, which meant the key sat in `localStorage` where any visitor to the deployed page could read it. Here the key is a server-side env var (`ANTHROPIC_API_KEY`) that never reaches the client, so there is deliberately no user-facing field for it.
- **"Import backup" is not implemented.** The prototype's version was a client-side `localStorage` overwrite with no real consequence. Here it would mean bulk-overwriting a live production database from an uploaded JSON file — a fundamentally different risk that deserves a deliberate, reviewed script, not a button in a settings page. Export (read-only) is implemented.

## Vendor-facing Purchase Order module

`PurchaseOrder`/`PoLineItem`/`Vendor` exist in the schema (required by the original master spec) and are searchable, but there is no UI to create/manage them — the prototype itself has no such screens (its "Sales Order" is a different thing, already built). This is schema-only scaffolding for a future module, not a broken feature.

## Responsive / Accessibility / Performance

- **Responsive**: the ported CSS carries over the prototype's own mobile breakpoints (header, main content padding, project list card stacking). Newly-built UI (modals, tables inside modals, the Challan issuing table) was visually reviewed but not tested against a real device matrix — only browser viewport resizing. Wide tables inside modals (e.g. the Issue Challan balance table) may need horizontal scroll on narrow phones; this wasn't specifically stress-tested.
- **Accessibility**: modals have `role="dialog"`, `aria-modal`, labelled titles, and initial focus; icon-only buttons have `aria-label`s; the Tabs component uses `role="tab"`/`aria-selected`. This is a reasonable baseline pass, not a full WCAG audit — no screen-reader testing was performed, and color contrast was deliberately left unchanged (the instruction was explicit: don't alter the design for this).
- **Performance**: this is a low-data-volume internal tool (dozens of projects, not thousands), and no performance bottleneck was observed or is expected at that scale. No pagination, virtualization, or aggressive memoization was added because there's no evidence it's needed yet — adding it preemptively would be exactly the kind of premature optimization the project's own engineering guidelines warn against. Revisit if project/challan counts grow into the hundreds+ per project.

## Security / dependencies

- `npm audit` reports 12 high-severity advisories against transitive `postcss`/`sharp` (pulled in by Next.js's image optimizer). The only "fix" `npm audit fix --force` offers is downgrading Next.js to `9.3.3`, which is not viable. `next@16.2.12` (current stable) already includes the two real, actionable CVE fixes checked during this build (CVE-2025-66478, the Dec-11-2025 advisory). Re-check `npm audit` before each deploy and take the next non-breaking Next.js patch as soon as one lands.
- The Challan edit/delete "password" (`pincode110020`, hardcoded in `components/ProjectDetail/ChallansTab.tsx`) is the exact same non-auth UX the prototype had — a soft speed-bump, not a real access control. The whole app is intentionally public/no-login per the explicit master spec; don't mistake this for a security feature.

## Database connectivity

During development, Supabase's pooled connection (port 6543, pgbouncer) was intermittently unreachable from this build environment's network, while the direct/session connection (port 5432) was consistently reliable. This may be specific to that network path and not recur in production — noted in `DEPLOYMENT_GUIDE.md` as a thing to watch for, not a confirmed production issue.
