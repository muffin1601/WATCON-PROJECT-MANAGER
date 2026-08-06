/**
 * BOQ item rows out of free OCR text (scanned PDFs, camera photos).
 *
 * A BOQ row that survived OCR reads as
 *   "<description> [Make] <qty> <unit> <rate> <amount>"
 * with the numbers at the end. This anchors on the trailing number run rather
 * than on column positions, which OCR does not preserve.
 *
 * The hard part is not finding candidate rows — it is rejecting the ones that
 * are page furniture (letterhead addresses, phone numbers, CIN lines, page
 * footers) or table fragments OCR mangled beyond use. Emitting those as Sales
 * Order lines is worse than emitting nothing, because a plausible-looking
 * wrong rate reaches a client bill. So a row is only accepted when its own
 * numbers corroborate each other: qty x rate must equal the printed amount
 * within 2%. Rows that fail are counted and reported, not silently dropped.
 */

export interface OcrRow {
  description: string;
  make: string;
  unit: string;
  qty: number;
  rate: number;
  confidence: number;
}

export interface OcrRowsResult {
  rows: OcrRow[];
  /** Candidate rows rejected because their numbers did not corroborate. */
  rejected: number;
}

const UNIT_RE = /\b(nos?\.?|no\.?|pcs|sets?|mtrs?|rm|sq\.?ft|sqm|kgs?|ltrs?|lot|ls|job|each|bags?|metre)\b/i;

const SKIP_ROW =
  /^(s\.?\s?no|total|sub\s*total|grand\s*total|total amount|description|particulars|note|page|annexure|design|type of pool|pool size|flow rate|filtration turn|balancing tank|turn over)/i;

/** Letterhead / footer furniture that repeats on every scanned page. */
const PAGE_FURNITURE =
  /(corporate tower|rajendra place|new delhi|okhla|cin\s*no|www\.|@|p\s*\+?\s*91|\bltd\b|\blimited\b|unity group|authorised signatory|proprietor|for watcon)/i;

/** Trailing run of 3-4 numeric tokens — qty, rate and amount must all be present. */
const TAIL_NUMBERS = /((?:[\d][\d,]*(?:\.\d+)?\s+){2,3}[\d][\d,]*(?:\.\d+)?)\s*$/;

export function itemsFromOcrText(text: string): OcrRowsResult {
  const rows: OcrRow[] = [];
  let rejected = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 12 || SKIP_ROW.test(line) || PAGE_FURNITURE.test(line)) continue;

    const tail = TAIL_NUMBERS.exec(line);
    if (!tail) continue;

    const nums = tail[1]!
      .trim()
      .split(/\s+/)
      .map((t) => Number(t.replace(/,/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length < 3) continue;

    const description = line
      .slice(0, line.length - tail[0]!.length)
      .replace(UNIT_RE, " ")
      // OCR renders table borders as pipes/brackets/underscores — strip them
      // so a row of cell separators cannot pass as a description.
      .replace(/[|\[\]_~^]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // A real item description is words, not one token or a digit soup.
    const words = description.split(/\s+/).filter((w) => /[A-Za-z]{3}/.test(w));
    if (words.length < 2 || description.length < 8) continue;

    // Corroboration: some consecutive (qty, rate, amount) triple must hold.
    let qty = 0;
    let rate = 0;
    for (let i = 0; i + 2 < nums.length + 1 && i + 2 <= nums.length - 1; i++) {
      const a = nums[i]!;
      const b = nums[i + 1]!;
      const c = nums[i + 2]!;
      if (Math.abs(a * b - c) / c <= 0.02) {
        qty = a;
        rate = b;
        break;
      }
    }
    if (!qty || !rate) {
      rejected++;
      continue;
    }

    const unitMatch = UNIT_RE.exec(line);
    rows.push({
      description: description.slice(0, 160),
      make: "",
      unit: unitMatch ? unitMatch[1]!.replace(/\.$/, "") : "Nos",
      qty,
      rate,
      // Cross-checked, but still OCR: never presented as high confidence.
      confidence: 0.6,
    });
  }

  return { rows, rejected };
}
