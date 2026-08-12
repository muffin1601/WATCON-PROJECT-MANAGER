# AI Document Engine

Automates the data entry that BOQs, Purchase Orders and Delivery Challans used
to require. **No screen, field, table or workflow changed** — the same New
Project form and the same Attach Challan modal are simply filled in for you,
and everything stays editable before it is saved.

---

## What changed, and why

The app already had a document auto-read: `services/import/orderParser.ts`,
~300 lines of regex and layout heuristics. It worked on the one Zoho PO layout
it was tuned against and degraded sharply on anything else. `KNOWN_LIMITATIONS.md`
recorded the ceiling honestly:

> PDF OCR is NOT supported by the Tesseract provider... Tesseract produces raw
> unstructured text with no layout/table awareness.

That ceiling is now gone, because Claude reads the document itself:

| | Before | Now |
|---|---|---|
| Scanned PDF | Not supported at all | Read directly, rotation/skew included |
| Table awareness | None (regex over flat text) | Merged cells, wrapped text, tables continuing across pages |
| Excel / CSV | Not supported | Converted to CSV server-side, merged cells resolved |
| Reply format | JSON asked for in prose, truncation repaired by guessing | Constrained by JSON Schema — malformed output is impossible |
| Fields captured | description, unit, qty, rate | + make, specification, code, amount, tax %, remarks, source page, per-row confidence |
| Long documents | Whatever fit in one pass | Up to 50 pages, every row |
| API key | In browser `localStorage`, readable by any visitor | Server-side env var only |

The old parser is **still present and still works**. With no `ANTHROPIC_API_KEY`
set, `/api/parse-order` continues to serve it, so the app degrades to its
previous behaviour rather than losing the feature.

---

## Architecture

The layering the spec asked for, one directory per layer:

```
Upload
  ↓
services/ai/ingest.ts      Ingestion  — file → Claude content blocks; page/size guards
  ↓
services/ai/extract.ts     Extraction — one structured Claude call per document
  ↓
services/ai/validate.ts    Validation — totals, duplicates, blanks, confidence
  ↓
services/ai/mapper.ts      Mapper     — AI shape → the app's existing shapes
services/ai/matching.ts    Matching   — reuse existing project / SO items
  ↓
Existing database (Prisma)  →  Existing UI
```

`services/ai/jobs.ts` sequences those layers and reports progress;
`services/ai/config.ts` holds every model id and limit.

### Why there is no OCR step for PDFs

Tesseract cannot open a PDF, which is what forced the old
"convert to PNG first" workaround. Claude accepts a PDF as a `document`
content block and reads scanned pages natively, so rasterisation — and the
`node-canvas` native dependency it needed — is not required. Tesseract stays
wired into `services/ocr/` for full-text search indexing, unchanged.

### Model routing

| Document | Model | Effort | Why |
|---|---|---|---|
| BOQ, Purchase Order | `claude-sonnet-5` | medium | Long documents, dense and merged tables |
| Challan | `claude-haiku-4-5` | low | One or two pages, a short goods table — ~⅓ the cost |
| Type detection | `claude-haiku-4-5` | low | Three-field answer; input cost only |

Change these in `services/ai/config.ts` — nothing else references a model id.

### Background processing

A 50-page extraction takes minutes, so it does not run inside the upload
request:

1. `POST /api/ai/extract` creates an `ExtractionJob` row and returns `202` with
   its id immediately.
2. The work runs in Next's `after()` — after the response is flushed.
3. The browser polls `GET /api/ai/jobs/:id` every 1.5s and renders
   `stage` + `progressPct` on the existing `ProgressBar`.

Because the job lives in the database, closing the tab or refreshing loses
nothing. Stages are `Uploading → Reading → OCR* → Extracting → Validating →
Generating sales order → Completed` (*only when pages must be read visually).

Jobs stuck over 20 minutes — a recycled serverless instance, say — are marked
failed when next polled, so nothing polls forever.

---

## Setup

### 1. Anthropic API key (required for AI reading)

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Get one at <https://platform.claude.com> → API keys. **Server-side only** — it
is never sent to the browser. Without it, uploads still work; only automatic
reading is disabled and the endpoint returns a clear 503.

### 2. Google Drive weekly backup

```bash
GOOGLE_SERVICE_ACCOUNT_JSON=   # raw JSON, or base64 of it
GOOGLE_DRIVE_FOLDER_ID=        # the part after /folders/ in the Drive URL
BACKUP_CRON_SECRET=            # openssl rand -hex 32
```

1. Google Cloud Console → create a project → enable the **Google Drive API**.
2. Create a **service account**, then create a **JSON key** for it and download it.
3. In Google Drive, create the backup folder and **share it with the service
   account's `client_email`, as Editor**.
   *This step is the one that gets missed.* A service account has its own empty
   Drive; without the share, uploads succeed into a folder nobody can see.
4. Put the JSON in `GOOGLE_SERVICE_ACCOUNT_JSON`. If your hosting dashboard
   mangles the multi-line private key, base64 it instead:
   `base64 -w0 service-account.json`
5. Copy the folder id from its URL into `GOOGLE_DRIVE_FOLDER_ID`.
6. Generate `BACKUP_CRON_SECRET`. **Until this is set the backup endpoint is
   disabled** — it exports the entire database, so it fails closed.

Test it:

```bash
curl -H "Authorization: Bearer $BACKUP_CRON_SECRET" \
     "https://your-app/api/cron/backup?force=1"
```

`vercel.json` already schedules it for 19:00 UTC Sunday (00:30 IST Monday). On
any other host, point a scheduler at the same URL weekly. Running it more often
than weekly is safe — it skips unless a successful backup is more than 7 days
old, unless `force=1`.

Each run writes a `BackupRun` row (success or failure) so a silently broken
backup is visible. Old backups are never deleted.

### 3. Vercel / serverless timeouts

PDF reading can still be slow even below the upload-size limit, especially for
scanned/image PDFs. On Vercel the app runs in a safe mode:

- digital PDFs try the fast structured/local reader before AI
- if that fast read is weak, Vercel returns a best-effort local draft instead
  of waiting for a long AI pass
- scanned PDFs are limited by `MAX_VISUAL_PDF_PAGES` (default `3` on Vercel)

For better scanned-PDF automation, use Excel/CSV uploads where possible, split
large scans into small PDFs, enable Vercel Fluid Compute on a paid plan, or move
the document reader to a queue/worker host with no request timeout.

Set `AI_PDF_MODE=ai` only if your deployment can tolerate long PDF model calls.

---

## Limits

| Limit | Value | Where |
|---|---|---|
| Pages per document | 50 | `MAX_DOCUMENT_PAGES` |
| File size for AI reading | 4 MB | `MAX_AI_FILE_BYTES` |
| Scanned PDF pages on Vercel | 3 | `MAX_VISUAL_PDF_PAGES` |
| Output per extraction | 64,000 tokens | `MAX_OUTPUT_TOKENS` |
| Low-confidence threshold | 0.75 | `LOW_CONFIDENCE_THRESHOLD` |

Accepted: PDF, scanned PDF, XLSX, XLS, CSV, PNG, JPG, JPEG.

---

## Validation behaviour

Validation **never blocks and never discards** — per the spec, a low-confidence
row is highlighted for correction, not dropped. Checks: missing quantity,
missing description, zero rate, missing unit, `qty × rate` disagreeing with the
printed amount, duplicate rows, per-row confidence, and the item total against
the document's stated total.

Two deliberate behaviours worth knowing:

- **Rate reconciliation.** When the items sum to within 0.5–1.5× of the
  document's stated total but not to the total itself, rates are scaled
  proportionally so the Sales Order matches the figure the client signed, and a
  warning says so. Outside that band nothing is touched and the discrepancy is
  reported instead.
- **Challan matching is conservative.** Only a *confident* line match
  auto-fills a quantity. Weak matches are listed as unmatched for you to place,
  because a wrongly-linked line silently distorts that item's dispatched and
  pending figures with nothing on screen to reveal it.

---

## Cost

Typical volume (25 orders + 300 challans/month): **roughly ₹1,300/month**.
Instruction prompts are cached, so repeat extractions pay ~10% on that portion.
Per-call token usage is recorded on each `ExtractionJob.usage` for attribution.

---

## Testing without spending money

Everything except the Claude call is exercisable offline: ingestion (page
counting, XLSX/CSV conversion, type gating), validation, mapping and matching
are all pure functions over fixtures. With no API key set, `/api/ai/extract`
returns 503 and the older local parser continues to serve `/api/parse-order`.
