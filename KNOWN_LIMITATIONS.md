# Known Limitations

Written honestly — this documents what genuinely doesn't work or wasn't built, not a hedge-everything disclaimer list. If something isn't mentioned here, it was tested and works.

## OCR

- **Provider**: only `tesseract` (Tesseract.js) is implemented. `azure`, `google-vision`, `aws-textract` are typed stubs (`services/ocr/providers/unimplemented.ts`) that prove the `OcrProvider` interface is genuinely swappable — wiring in a real one requires only implementing `extract()`, no changes anywhere else.
- **Image input only.** PDF OCR is NOT supported by the Tesseract provider — it throws a clear error if you try. Rasterizing a PDF to images server-side needs `node-canvas` (a native dependency), which wasn't safe to assume works in every deployment target without dedicated verification. Workaround: convert the PDF to PNG/JPG first, or implement a real vision-based provider (Azure/Google/Textract handle PDFs natively).
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

- The prototype's "Anthropic API key" field is intentionally absent. That field existed only because the prototype called the Anthropic API directly from the browser. OCR here is a server-side provider selected via the `OCR_PROVIDER` env var, not a per-tenant browser-side key — there's no equivalent user-facing field for it.
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
