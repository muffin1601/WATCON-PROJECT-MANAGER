import type { AiOrderResult } from "../../modules/ai/schema";

/**
 * Reassembles the per-chunk extractions of one document into a single result.
 *
 * Chunks are cut on page boundaries, so every printed row belongs to exactly
 * one chunk. That is what makes this merge a concatenation rather than a
 * reconciliation, and it is deliberate — see the note on de-duplication below.
 */

export interface ChunkResult {
  index: number;
  startPage: number;
  endPage: number;
  result: AiOrderResult;
}

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

/**
 * Merges chunk results into one order result.
 *
 * **Item rows are concatenated, never de-duplicated by content.** It is
 * tempting to drop rows that look identical across a chunk boundary, and it
 * would be wrong: a real BOQ repeats the same line legitimately — this
 * project's Work Order quotes the same 50 mm ball valve, the same SS-316 pipe
 * sizes and the same cable runs in both the indoor and the outdoor annexure,
 * at identical quantities and rates. Collapsing those would silently delete
 * billable work and under-state the contract, and the reviewer would have no
 * way to see what went missing. Since chunks never overlap, a genuine
 * double-read cannot occur here anyway; a duplicated row means the document
 * really prints it twice, which is the reviewer's call to make, not ours.
 */
export function mergeChunkResults(chunks: ChunkResult[]): AiOrderResult {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const withItems = ordered.filter((c) => c.result.extractedData.items.length > 0);

  const items = ordered.flatMap((c) => c.result.extractedData.items);

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
