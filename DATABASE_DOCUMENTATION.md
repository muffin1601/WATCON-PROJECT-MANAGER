# Database Documentation

Full source of truth: `prisma/schema.prisma`. This file explains the *why* behind the shape, not a field-by-field restatement — read the schema alongside this.

## Design principles
- **No JSON blobs for structured data.** The prototype kept everything (items, challans, bills, discounts, amendments) as arrays inside one `localStorage` object. Every one of those arrays is a real relational table here.
- **No auth tables.** This app has no login (see `PLAN.md`) — there is no `users` table, and nothing references one.
- **Decimal, not Float**, for every money/quantity field — `@db.Decimal(14,2)` for currency, `@db.Decimal(14,3)` for quantities. Prisma returns these as `Decimal.js` instances; `lib/decimal.ts#toNum()` is the single coercion point to plain `number` before anything reaches `services/financials.ts` or a Client Component.

## Core entities
```
Project
 ├─ PoItem[]            "items" — Sales Order line items
 ├─ Challan[]           delivery challans
 │   ├─ ChallanItem[]   qty dispatched per PoItem (qty = within SO, extraQty = beyond BOQ)
 │   └─ ChallanExtraItem[]  items dispatched that aren't on the SO at all
 ├─ Bill[]              running bills
 │   └─ BillLine[]      snapshot of what was billed (isExtra flags section B)
 ├─ Payment[]           payments received
 ├─ Discount[]          special discounts
 ├─ Amendment[]         scope changes (valueChange is signed)
 ├─ Document[]          project-level attachments (order copy / approval proof)
 └─ PurchaseOrder[]     vendor-facing PO module (schema only, no UI yet)

Document                polymorphic attachment: optionally linked to Project,
                        Challan, Payment, Amendment, or PurchaseOrder (exactly
                        one, in practice) — kind enum distinguishes purpose
OcrResult               1:1 with Document, records provider/status/raw/extracted
Setting                 single row (key="default") — company profile, GST rate,
                        challan/bill numbering
Vendor                  name/GSTIN/contact — used by PurchaseOrder and search
```

## Why `PoItem` (not `SalesOrderItem`)
The model name predates the UI naming split: it's genuinely the client-facing Sales Order line item (`project.items` in the prototype), but is named `PoItem`/`po_items` because it's also the target of `PoLineItem.linkedItemId` in the separate vendor-facing Purchase Order module. Renaming would touch every service/view-model file for a cosmetic gain — noted here instead.

## Cascade rules (the load-bearing part)
Every relation from a child back to `Project` is `onDelete: Cascade` — deleting a project removes everything under it. The one subtlety, found via live testing (see `PLAN.md` Phase 3.5):

> `ChallanItem.itemId → PoItem` and `PurchaseOrder.projectId → Project` originally had **no** `onDelete` rule, defaulting to Postgres's implicit `NO ACTION`/restrict. Deleting a Project cascades down two independent paths — `Project → PoItem` and `Project → Challan → ChallanItem` — and if the `PoItem` row got deleted before its still-referencing `ChallanItem` row, Postgres threw `P2003` (foreign key violation). Fixed with explicit `onDelete: Cascade` on `ChallanItem.item` and `PurchaseOrder.project`, and `onDelete: SetNull` on the optional `PoLineItem.linkedItem` (a PO line shouldn't vanish just because the SO item it references was removed).

If you add a new relation pointing at `PoItem`, `Challan`, `Payment`, `Amendment`, or `Bill`, give it an explicit `onDelete` — don't rely on the Postgres default, and test an actual delete with populated child rows before trusting it.

## Financial calculation fields worth understanding
- **`Bill.discountApplied` vs `Bill.discountCum`** — `discountCum` is the total discount applied *to date* (cumulative across all bills); `discountApplied` is just the delta applied *in this bill* (`discountCum - priorDiscountCum`). Both are stored because the print document and the "of which extras" UI column need the delta, while `siteAccountFigures()` needs the cumulative total.
- **`BillLine.isExtra`** — distinguishes section A (Sales Order items, cumulative qty × rate) from section B (extra items/quantities beyond the BOQ) on a generated bill. `orderQty`/`cumQty`/`rate` are nullable because the one line type that has neither (the "Material supplied vide attached Zoho challans" value-basis line) only has an `amount`.
- **`Challan.manualValue`** — set only when a challan (almost always `source: ATTACHED_EXTERNAL`) isn't linked to Sales Order items at all; `challanValue()` in `services/financials.ts` checks this first before falling back to computing from linked items.

## Storage structure (Supabase Storage)
Single bucket `watcon-documents`, public-read (see `supabase/policies.sql`), private-write (service-role key only, via `lib/supabaseServer.ts`). Path convention:
```
<kind-lowercase>/<projectId | "misc">/<uuid>-<original-filename>
```
e.g. `order_copy/3f2c…/8a1b…-po-scan.pdf`. No version history — re-uploading creates a new `Document` row with a new path; the old one must be explicitly deleted (both storage object and DB row, done atomically by `services/documentService.ts#deleteDocument`).

## Migrations
Run via `npx prisma migrate dev` locally, `npx prisma migrate deploy` in production. Current migrations:
1. `20260731065940_init` — full initial schema
2. `20260731074552_fix_cascade_deletes` — the FK fix described above

`npx prisma generate` must be re-run after any schema change (and after switching branches with different migration history) to keep the generated client in sync — `next build` runs TypeScript against the generated types, so a stale client shows up as build errors, not runtime errors.
