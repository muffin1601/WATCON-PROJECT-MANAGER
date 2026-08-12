import { MAX_AI_UPLOAD_BYTES } from "../../modules/documents/uploadLimits";

// Central AI configuration. Every model id, limit and tunable lives here so
// there is exactly one place to change when models or pricing move.
//
// Model routing (decided with the business, see AI_DOCUMENT_ENGINE.md):
//   BOQ / Purchase Order -> Sonnet 5. Long multi-page documents with dense,
//     merged, continuation tables; this is where extraction quality matters.
//   Challan              -> Haiku 4.5. One or two pages, a short goods table.
//     Roughly a third of the cost and noticeably faster at no accuracy cost
//     on this shape of document.

export const MODEL_SONNET = "claude-sonnet-5";
export const MODEL_HAIKU = "claude-haiku-4-5";

export type DocumentClass = "BOQ" | "PURCHASE_ORDER" | "CHALLAN" | "UNKNOWN";

export function modelForDocument(kind: DocumentClass): string {
  return kind === "CHALLAN" ? MODEL_HAIKU : MODEL_SONNET;
}

/**
 * Hard page ceiling from the spec. Enforced at ingestion so a 400-page file
 * fails immediately with a clear message instead of burning tokens and then
 * timing out.
 */
export const MAX_DOCUMENT_PAGES = 50;

/**
 * Vercel is a poor fit for long visual PDF reads: even tiny scanned PDFs can
 * take minutes because every page is transcribed by a model. Keep production
 * reads bounded there; use Excel/CSV or a worker service for long scans.
 */
export const MAX_VISUAL_PDF_PAGES = Number(process.env.MAX_VISUAL_PDF_PAGES || (process.env.VERCEL ? 3 : 12));

/**
 * On Vercel, prefer deterministic local PDF table/text readers over a full
 * model pass. This avoids function timeouts at the cost of weaker extraction
 * on unusual PDF layouts. Set AI_PDF_MODE=ai to force the old AI-first path.
 */
export const FAST_PDF_MODE = process.env.AI_PDF_MODE !== "ai" && (process.env.VERCEL === "1" || process.env.AI_PDF_MODE === "fast");

/**
 * The Anthropic API rejects requests whose total body exceeds 32 MB. Base64
 * inflates bytes by ~4/3, so cap the raw file well under that.
 */
export const MAX_AI_FILE_BYTES = MAX_AI_UPLOAD_BYTES;

export function envNumber(name: string, defaultValue: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export const PDF_CHUNK_SIZE = envNumber("PDF_CHUNK_SIZE", 8);
export const PDF_CHUNK_OVERLAP = envNumber("PDF_CHUNK_OVERLAP", 1);
export const PDF_CHUNKING_THRESHOLD = envNumber("PDF_CHUNKING_THRESHOLD", 10);
export const PDF_MAX_CONCURRENT_CHUNKS = envNumber("PDF_MAX_CONCURRENT_CHUNKS", 3);
export const PDF_MAX_RETRIES = envNumber("PDF_MAX_RETRIES", 2);
export const PDF_OCR_CONCURRENCY = envNumber("PDF_OCR_CONCURRENCY", 2);

/**
 * Output ceiling per extraction call. A 50-page BOQ can legitimately produce
 * 300+ line items, and on Sonnet 5 `max_tokens` bounds thinking *plus*
 * response text — an ungenerous value truncates the item array mid-way.
 * Requests this large must stream (see client.ts) or they hit HTTP timeouts.
 */
export const MAX_OUTPUT_TOKENS = 64_000;

/**
 * Effort tuning. Extraction is a careful-reading task rather than an
 * open-ended reasoning one, so `medium` matches quality at materially lower
 * token spend; the small, well-structured challan runs at `low`.
 *
 * `high` was tried and reverted: on a 40-page Work Order it added minutes of
 * latency for no measured accuracy gain, and the serverless function's
 * duration cap is the binding constraint on this path, not token cost.
 */
export function effortForDocument(kind: DocumentClass): "low" | "medium" | "high" {
  return kind === "CHALLAN" ? "low" : "medium";
}

/**
 * Rows whose extraction confidence falls below this are surfaced to the user
 * for correction rather than silently trusted. Never used to *drop* a row —
 * the spec is explicit that low confidence highlights, it does not discard.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
