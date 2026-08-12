import type { AiOrderItem, AiOrderResult } from "../../modules/ai/schema";

export interface ChunkOutcomeBase {
  index: number;
  chunkId: string;
  totalChunks: number;
  startPage: number;
  endPage: number;
  attempts: number;
}

export interface ChunkResult extends ChunkOutcomeBase {
  status: "COMPLETED";
  result: AiOrderResult;
}

export interface ChunkFailure extends ChunkOutcomeBase {
  status: "FAILED";
  errorMessage: string;
}

export type ChunkOutcome = ChunkResult | ChunkFailure;

/**
 * Reassembles the per-chunk extractions of one document into a single result.
 *
 * Chunks overlap on page boundaries, so duplicates may appear in adjacent
 * chunk results. The overlap is intentional: it preserves table continuity
 * across page breaks. Duplicate rows from the shared pages are removed here.
 */

/** First non-empty value wins, scanning chunks in page order. */
function firstText(chunks: ChunkResult[], pick: (r: AiOrderResult) => string): string {
  for (const c of chunks) {
    const value = pick(c.result).trim();
    if (value) return value;
  }
  return "";
}

/** First non-zero value wins, scanning chunks in page order. */
function firstNumber(chunks: ChunkResult[], pick: (r: AiOrderResult) => number): number {
  for (const c of chunks) {
    const value = pick(c.result);
    if (value) return value;
  }
  return 0;
}

function firstTerm(
  chunks: ChunkResult[],
  pick: (r: AiOrderResult) => "included" | "extra" | "unknown"
): "included" | "extra" | "unknown" {
  for (const c of chunks) {
    const value = pick(c.result);
    if (value !== "unknown") return value;
  }
  return "unknown";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function normalizeRowKey(item: AiOrderItem): string {
  return [
    item.description.trim().toLowerCase(),
    item.code.trim().toLowerCase(),
    item.unit.trim().toLowerCase(),
    item.qty.toString(),
    item.rate.toString(),
    item.amount.toString(),
    item.sourcePage.toString(),
  ].join("|");
}

function deduplicateOverlaps(items: AiOrderItem[]): AiOrderItem[] {
  const seen = new Set<string>();
  const deduped: AiOrderItem[] = [];

  for (const item of items) {
    const key = normalizeRowKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }
  return deduped;
}

/**
 * Merges chunk results into one order result.
 *
 * Adjacent chunks may overlap by a page to preserve table continuity.
 * Duplicate rows from the overlapping pages are removed where the same
 * row returns from both chunks with identical content and page reference.
 */
export function mergeChunkResults(chunks: ChunkResult[]): AiOrderResult {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const withItems = ordered.filter((c) => c.result.extractedData.items.length > 0);

  const items = deduplicateOverlaps(ordered.flatMap((c) => c.result.extractedData.items));

  // documentType: the first chunk to make a confident call. Later chunks see
  // only interior pages of a BOQ table and routinely answer "UNKNOWN", which
  // must not overwrite the judgement made from the title page.
  const documentType =
    ordered.find((c) => c.result.documentType !== "UNKNOWN")?.result.documentType ?? "PURCHASE_ORDER";

  // Confidence is the weakest link, not the average: one badly-read chunk
  // makes the whole extraction worth reviewing.
  const confidence = withItems.length
    ? Math.min(...withItems.map((c) => c.result.confidence))
    : ordered.length
      ? Math.min(...ordered.map((c) => c.result.confidence))
      : 0;

  return {
    documentType,
    confidence,
    extractedData: {
      projectName: firstText(ordered, (r) => r.extractedData.projectName),
      clientName: firstText(ordered, (r) => r.extractedData.clientName),
      vendorName: firstText(ordered, (r) => r.extractedData.vendorName),
      poNumber: firstText(ordered, (r) => r.extractedData.poNumber),
      poDate: firstText(ordered, (r) => r.extractedData.poDate),
      siteAddress: firstText(ordered, (r) => r.extractedData.siteAddress),
      deliveryAddress: firstText(ordered, (r) => r.extractedData.deliveryAddress),
      gstin: firstText(ordered, (r) => r.extractedData.gstin),
      terms: {
        gst: firstTerm(ordered, (r) => r.extractedData.terms.gst),
        transport: firstTerm(ordered, (r) => r.extractedData.terms.transport),
        payment: firstText(ordered, (r) => r.extractedData.terms.payment),
      },
      gstRatePct: firstNumber(ordered, (r) => r.extractedData.gstRatePct),
      discountPct: firstNumber(ordered, (r) => r.extractedData.discountPct),
      discountAmount: firstNumber(ordered, (r) => r.extractedData.discountAmount),
      discountNote: firstText(ordered, (r) => r.extractedData.discountNote),
      ratesAreGstInclusive: ordered.some((c) => c.result.extractedData.ratesAreGstInclusive),
      // The stated contract value is printed on the covering pages, so the
      // first non-zero reading is the document's own figure for the WHOLE
      // order — not a per-chunk subtotal. Summing chunk totals here would
      // double-count against the item rows.
      documentTotal: firstNumber(ordered, (r) => r.extractedData.documentTotal),
      remarks: firstText(ordered, (r) => r.extractedData.remarks),
      items,
    },
    validation: unique(ordered.flatMap((c) => c.result.validation)),
    warnings: unique(ordered.flatMap((c) => c.result.warnings)),
  };
}
