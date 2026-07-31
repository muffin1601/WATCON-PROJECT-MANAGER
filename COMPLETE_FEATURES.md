# Complete Features

Everything below is implemented and has been live-tested against the real Supabase database (not mocked), unless explicitly marked otherwise. Source spec: `watcon-project-management.html` at the project root.

## Dashboard (`/`)
- Live stats: active project count, total contract value, material sent, payments received, outstanding
- Searchable project list (client-side filter on name/client/site, same as the prototype)
- Every card computed from Prisma data — no hardcoded values

## Projects
- **Create** — `/projects/new`: name, client, site, project type, approval mode (Purchase Order / Quote-Email / Quote-WhatsApp / Quote-Verbal), PO ref, terms (GST/transport/payment), manual Sales Order item entry
- **Read** — `/projects/[id]`: header with inline status change (In Progress / On Hold / Completed), stats row, tabbed workspace
- **Update** — status change, and every sub-entity below
- **Delete** — cascades correctly through every related table (challans, bills, payments, discounts, amendments, documents, sales order items)

### Overview tab
Full financial summary: basic value, amendments, discounts, GST, total contract value, material sent, billed, received, balance. Terms & approval detail.

### Sales Order tab
Inline-editable CRUD table (add/edit/delete items), with live Dispatched / Balance Qty / Extra Qty columns once challans exist.

### Challans tab
- **Issue new challan** — dispatch against the Sales Order, with a live balance-qty table per item. Server-enforced (not just UI-validated): dispatch qty is capped to balance; "additional qty" (beyond BOQ) is silently clamped to zero unless the item's full SO qty has already been dispatched. Supports custom line items not on the Sales Order.
- **Attach Zoho challan** — records a challan issued outside the system (manual value or linked SO quantities, no capping), with a challan-copy file upload.
- **View** — quantities-only document preview (no rates/values shown), matching the prototype's `challanDocHTML()`.
- **Edit / Delete** — gated behind the prototype's own lightweight password prompt (`pincode110020` — same non-auth UX as the source, not a real security boundary).
- **Print** — A4 document layout matching the prototype pixel-for-pixel, including the extracted company logo.

### Running Bills tab
- **Generate** — pick an "up to" date and whether to apply discounts not yet billed. Computes gross value (Sales Order items + extras-beyond-BOQ as a separate section), GST, cumulative discount, subtracts everything already billed, and refuses to generate if there's nothing new to bill (never double-bills).
- List with A/B extras breakdown, print, delete.

### Payments tab
Full CRUD: record (date, amount, mode, reference, optional proof-of-payment upload), list, delete.

### Site Accounts tab
Read-only computed statement (material sent, discounts, GST, billable-to-date, billed, unbilled, received, balance) + running-bills table + print. **Not an editable ledger** — the prototype has no such CRUD, so neither does this (see `KNOWN_LIMITATIONS.md`).

### Discounts & Amendments tab
Full CRUD for both: discounts (date, amount, reason) and amendments (date, description, value change, optional approval-copy upload). Both immediately affect contract value / GST / balance everywhere they're shown.

### Documents tab
Real Supabase Storage integration: order-copy and approval-proof upload/view/delete, plus read-only listings of challan-copy and amendment-approval attachments (uploaded from their own tabs). Per-entity attachment model matching the prototype's `tabDocs()`, not a categorized document library.

## Settings (`/settings`)
Company profile (name, address, phone, email, GSTIN), GST rate, challan/bill numbering prefixes — all live-editable, immediately affecting every calculation. JSON data export (backup). Import is intentionally not implemented (bulk-overwriting a live production DB needs a deliberate reviewed operation, not a button).

## OCR
Provider-abstracted (`services/ocr/provider.ts`). Tesseract.js implemented as the free default — image input only (PNG/JPG). Extracts vendor, PO number, PO date, GST terms, and item rows via a heuristic text parser; every field is shown in an editable review modal before anything is saved to the Sales Order — never auto-applied. See `KNOWN_LIMITATIONS.md` for real accuracy expectations.

## Global Search
Database-driven search (header, any page) across projects, challans, running bills, payments, documents, discounts, amendments, and vendors.

## Printing
Every printed document (challan, running bill, site account statement) is pixel-matched to the prototype's `.doc`/`.dhead`/`.dtitle`/`.meta`/`.sig` layout, using the actual extracted company logo, via a `#printArea` portal + `@media print` mechanism identical in spirit to the source.

## Not built (see `PLAN.md` / `KNOWN_LIMITATIONS.md`)
- Vendor-facing Purchase Order module UI (schema exists, no screens)
- A dedicated "Reports" module or Excel export — the prototype has neither; its only reporting surface is the print documents above
- Advanced filter UI (status/date-range/vendor dropdowns) — the prototype has only the dashboard text search
