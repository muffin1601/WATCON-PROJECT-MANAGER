import type { AiOrderResult } from "../../modules/ai/schema";
import type { CellValue, WorkbookGrid } from "./spreadsheet";
import { extractRowsFromWorkbook, isTableHeaderRow, type ExtractedRow } from "./tableExtract";
import { parseNumber, round } from "./numbers";

/**
 * Spreadsheet / CSV -> the same `AiOrderResult` envelope every other engine
 * produces, built **entirely by deterministic parsing**.
 *
 * A spreadsheet already is structured data. Sending it to a language model to
 * be re-read introduces a transcription step that can only lose fidelity —
 * and transcription is exactly where wrong prices came from. So for .xlsx and
 * .csv this path is authoritative: cells are read where they are printed, and
 * the AI layer is only consulted when no table could be found at all.
 */

const HEADER_SCAN_ROWS = 40;

interface HeaderFields {
  projectName: string;
  clientName: string;
  vendorName: string;
  poNumber: string;
  poDate: string;
  siteAddress: string;
  gstin: string;
  paymentTerms: string;
}

const LABELS: { key: keyof HeaderFields; re: RegExp }[] = [
  // The bare "#" is Zoho's label for the order number; the value guard below
  // is what keeps it from capturing anything else.
  { key: "poNumber", re: /^#$|^(p\.?o\.?\s*(no|number|ref)|purchase\s*order\s*(no|number)|work\s*order\s*(ref|no)|order\s*(ref|no|number)|w\.?o\.?\s*no)\b/i },
  { key: "poDate", re: /^(p\.?o\.?\s*date|order\s*date|date|dated)\b/i },
  { key: "clientName", re: /^(client|customer|buyer|bill\s*to|issued\s*by|owner|to)\b/i },
  { key: "vendorName", re: /^(vendor|supplier|seller|from)\b/i },
  // "Ref#" is Zoho's project reference, not the order number — the PDF reader
  // has always mapped it to the project name, and reading it as the PO number
  // here made the same document fill two different fields depending on which
  // format it arrived in.
  { key: "projectName", re: /^(project|project\s*name|job|site\s*name|work|ref(erence)?\s*(no)?)\b/i },
  { key: "siteAddress", re: /^(site|site\s*address|delivery\s*(address|at)|deliver\s*to|ship\s*to|shipping\s*address|location)\b/i },
  { key: "gstin", re: /^(gstin|gst\s*(no|number)|gst\s*reg)\b/i },
  { key: "paymentTerms", re: /^(payment\s*terms?|terms\s*of\s*payment)\b/i },
];

/** A cell that names a field rather than carrying its value. */
function isLabelCell(text: string): boolean {
  if (/[:：]\s*$/.test(text)) return true;
  const bare = text.replace(/[:\-–]\s*$/, "").trim();
  return LABELS.some(({ re }) => re.test(bare)) && bare.length <= 30;
}

function cellText(cell: CellValue): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).replace(/\s+/g, " ").trim();
}

/** dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy and ISO -> ISO. Empty when ambiguous. */
function toIsoDate(value: CellValue): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cellText(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const m = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  // Indian documents are dd/mm; a first component above 12 confirms it, and
  // anything that cannot be a month in either reading is not a date.
  if (day > 31 || month > 12) return "";
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Key/value header block above the table ("Work Order Ref | BPL/.../2026").
 * Reads both the "label in column A, value in column B" layout and the
 * "Label: value" single-cell layout.
 */
function readHeaderFields(workbook: WorkbookGrid): HeaderFields {
  const out: HeaderFields = {
    projectName: "",
    clientName: "",
    vendorName: "",
    poNumber: "",
    poDate: "",
    siteAddress: "",
    gstin: "",
    paymentTerms: "",
  };

  for (const sheet of workbook.sheets) {
    // The key/value block lives above the item table. Reading past the table's
    // header row turns its own cells into labels — a "Job" unit cell matched
    // the project-name label and filed the quantity beside it as the project.
    const tableAt = sheet.rows.findIndex((row) => isTableHeaderRow(row));
    const limit = tableAt >= 0 ? Math.min(tableAt, HEADER_SCAN_ROWS) : HEADER_SCAN_ROWS;
    const scan = sheet.rows.slice(0, limit);
    for (let r = 0; r < scan.length; r++) {
      const row = scan[r]!;
      const cells = row.map((c) => cellText(c));

      // "# PO-00551" printed as one cell with no label of its own — the way
      // Zoho heads a purchase order.
      if (!out.poNumber) {
        const token = cells.find((c) => /^#\s*[A-Za-z0-9][A-Za-z0-9/\-]{2,}$/.test(c));
        if (token) out.poNumber = token.replace(/^#\s*/, "");
      }

      // A label on its own line with its value on the line below ("Vendor
      // Address" over the vendor's name, "Deliver To" over the site address).
      // Read left-to-right only, this layout produced no vendor and no site at
      // all — every party field came back empty on a real PO.
      const soleLabel = cells.filter(Boolean);
      if (soleLabel.length === 1) {
        const label = soleLabel[0]!.replace(/[:\-–]\s*$/, "").trim();
        const below = (scan[r + 1] ?? []).map((c) => cellText(c)).filter(Boolean);
        const value = below.length === 1 ? below[0]! : "";
        if (value && value.length <= 200) {
          for (const { key, re } of LABELS) {
            if (out[key] || key === "poDate" || key === "poNumber") continue;
            if (!re.test(label)) continue;
            out[key] = value;
            break;
          }
        }
      }

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!;
        if (!cell) continue;

        // "Label: value" inside one cell.
        const inline = cell.match(/^([^:]{2,40}):\s*(.+)$/);
        let label = cell.replace(/[:\-–]\s*$/, "").trim();
        let value = "";
        if (inline) {
          label = inline[1]!.trim();
          value = inline[2]!.trim();
        } else {
          // Value in the next non-empty cell to the right — but a cell that is
          // itself a label is not a value. Two labels share a line all the
          // time ("Deliver To" on the left, "Date :" on the right), and taking
          // the neighbour blindly filed the order's date as its site address.
          for (let j = i + 1; j < cells.length; j++) {
            if (!cells[j]) continue;
            // A second label further along the row owns everything after it,
            // so the search stops rather than reaching past it.
            if (isLabelCell(cells[j]!)) break;
            value = cells[j]!;
            break;
          }
          // Nothing usable across the row: the value is printed underneath,
          // which is how addresses are laid out.
          if (!value) {
            const beneath = cellText(scan[r + 1]?.[i] ?? null);
            if (beneath && !isLabelCell(beneath)) value = beneath;
          }
        }
        if (!value || value.length > 200) continue;

        for (const { key, re } of LABELS) {
          if (out[key]) continue;
          if (!re.test(label)) continue;
          if (key === "poDate") {
            const iso = toIsoDate(inline ? value : (row[cells.indexOf(value)] ?? value));
            if (iso) out.poDate = iso;
          } else if (key === "poNumber") {
            // An order number is a reference token, not a sentence. Requiring
            // that shape is what lets a bare "#" label (Zoho prints the PO
            // number under one) be read without a stray column header
            // capturing the first description cell instead.
            if (/^[A-Za-z0-9][A-Za-z0-9/\\_.\-]{2,39}$/.test(value) && /\d/.test(value)) out.poNumber = value;
          } else {
            out[key] = value;
          }
          break;
        }
      }
    }
  }
  return out;
}

/**
 * The document's own stated grand total, read from a labelled totals row.
 *
 * Kept strictly for cross-checking. It is never used to adjust item rates —
 * scaling every rate so the arithmetic tallies silently rewrites prices the
 * client signed for, which is precisely the corruption this rewrite removes.
 */
function readDocumentTotal(workbook: WorkbookGrid): number {
  // Labels ranked by how definitive they are. A workbook routinely prints a
  // "Total" per sheet or per annexure as well as one "Grand Total" for the
  // order; taking whichever appeared last picks a per-sheet subtotal in any
  // multi-sheet file, so rank first and only then compare values.
  const RANKS: { re: RegExp; rank: number }[] = [
    { re: /\b(grand\s*total|net\s*payable|total\s*payable)\b/i, rank: 3 },
    { re: /\b(net\s*amount|total\s*amount|order\s*value)\b/i, rank: 2 },
    { re: /\btotal\b/i, rank: 1 },
  ];
  const EXCLUDE = /\b(gst|igst|cgst|sgst|tax|in\s*words|sub\s*-?\s*total)\b/i;

  let bestRank = 0;
  let best = 0;

  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows) {
      const cells = row.map((c) => cellText(c));
      const labelIndex = cells.findIndex((c) => c && !EXCLUDE.test(c) && RANKS.some((r) => r.re.test(c)));
      if (labelIndex < 0) continue;
      const label = cells[labelIndex]!;
      const rank = RANKS.find((r) => r.re.test(label))!.rank;
      if (rank < bestRank) continue;

      for (let j = cells.length - 1; j > labelIndex; j--) {
        const n = parseNumber(row[j] ?? null);
        if (n === null || n <= 0) continue;
        // Same rank across sheets: the order's total is the larger figure.
        if (rank > bestRank || n > best) {
          bestRank = rank;
          best = n;
        }
        break;
      }
    }
  }
  return best;
}

/**
 * Document-level GST rate, when the file states one in a totals row.
 *
 * A tax split into CGST and SGST states half the rate on each line. Returning
 * the first match read "CGST 9%" as a 9% order, which understates the invoice
 * by half the tax — so the two halves are added when both are printed.
 */
function readGstRate(workbook: WorkbookGrid): number {
  let combined = 0;
  let single = 0;
  const seen = new Set<string>();

  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        const text = cellText(cell);
        const m = text.match(/\b(gst|igst|cgst|sgst|utgst)\b[^0-9]{0,12}(\d{1,2}(?:\.\d+)?)\s*%/i);
        if (!m) continue;
        const kind = m[1]!.toLowerCase();
        const pct = Number(m[2]);
        if (!(pct > 0 && pct <= 40)) continue;
        if (kind === "cgst" || kind === "sgst" || kind === "utgst") {
          // Each half counted once, however many times the file repeats it.
          if (seen.has(kind)) continue;
          seen.add(kind);
          combined += pct;
        } else if (!single) {
          single = pct;
        }
      }
    }
  }
  if (combined > 0) return combined;
  return single;
}

/**
 * A discount stated once for the whole order, in its totals block:
 * "Discount(4.00%) | 12,255.26", "Less: Discount | 5,000", "Special Discount |
 * 2%".
 *
 * This was previously not read at all from spreadsheets or from the PDF grid —
 * the fields were hard-coded to zero — so an order that had been discounted
 * arrived in the form at its undiscounted value. Both the percentage and the
 * amount are returned when the file prints both, because the New Project form
 * prefers the amount and falls back to the percentage.
 */
function readDocumentDiscount(workbook: WorkbookGrid): { pct: number; amount: number } {
  const LABEL = /(^|\b)(less\s*:?\s*)?(special\s*|trade\s*|cash\s*|additional\s*)?discount|rebate\b/i;
  // A per-row discount column header is not a totals line.
  const HEADER_ONLY = /^(disc|discount|discount\s*%|disc\s*%|rebate)$/i;

  let pct = 0;
  let amount = 0;

  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows) {
      const cells = row.map((c) => cellText(c));
      const labelIndex = cells.findIndex((c) => c && LABEL.test(c) && !HEADER_ONLY.test(c.replace(/[.:]+$/, "")));
      if (labelIndex < 0) continue;

      // "Discount(4.00%)" states the rate inside the label itself.
      const inlinePct = cells[labelIndex]!.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
      if (inlinePct && !pct) {
        const value = Number(inlinePct[1]);
        if (value > 0 && value < 100) pct = value;
      }

      for (let j = labelIndex + 1; j < cells.length; j++) {
        const text = cells[j]!;
        if (!text) continue;
        const n = parseNumber(text);
        if (n === null) continue;
        const value = Math.abs(n);
        if (value <= 0) continue;
        // A cell written as a percentage is the rate; anything else is money.
        if (/%\s*$/.test(text) && value < 100) {
          if (!pct) pct = value;
        } else if (!amount) {
          amount = value;
        }
      }
      if (pct || amount) return { pct, amount };
    }
  }
  return { pct, amount };
}

/**
 * The payment schedule, which a quotation prints as a numbered section under
 * the table rather than as a labelled cell beside it:
 *
 *   3. TERMS OF PAYMENT
 *   (a) 50% advance with Order.
 *   (b) 40% after approval of Designing
 *   (c) 10% after approval of drawings
 *
 * Only the labelled-cell layout was read before, so this — the layout the
 * business's own quotations use — left the Payment terms field empty.
 */
function readPaymentTerms(workbook: WorkbookGrid): string {
  const HEADING = /^\s*(?:\d+[.)]\s*)?(terms\s*of\s*payment|payment\s*terms?)\s*:?\s*$/i;
  // A schedule line: "(a) 50% advance", "50% along with order", "Balance on delivery".
  const SCHEDULE = /^\s*(?:[(\[]?[a-z0-9][)\].]\s*)?(?=.*(%|advance|balance|delivery|dispatch|completion|order|approval|against))/i;

  for (const sheet of workbook.sheets) {
    for (let r = 0; r < sheet.rows.length; r++) {
      const heading = sheet.rows[r]!.map((c) => cellText(c)).find(Boolean) ?? "";
      if (!HEADING.test(heading)) continue;

      const parts: string[] = [];
      for (let j = r + 1; j < sheet.rows.length && parts.length < 6; j++) {
        const line = sheet.rows[j]!.map((c) => cellText(c)).filter(Boolean).join(" ").trim();
        if (!line) {
          // One blank row inside the block is spacing; the block ends when a
          // line that is not part of the schedule follows.
          if (parts.length) break;
          continue;
        }
        if (/^\s*\d+[.)]\s*[A-Z]/.test(line) || HEADING.test(line)) break; // next numbered section
        if (!SCHEDULE.test(line)) break;
        parts.push(line.replace(/\s+/g, " ").trim());
      }
      if (parts.length) return parts.join(" ").slice(0, 300);
    }
  }
  return "";
}

/**
 * Whether GST is charged on top of the rates or already inside them. The
 * document says so in words; a stated rate alone does not settle it.
 */
function readGstTerm(workbook: WorkbookGrid, gstRatePct: number): "included" | "extra" | "unknown" {
  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        const text = cellText(cell);
        if (!/gst|tax/i.test(text)) continue;
        if (/\b(incl(usive|uded)?)\b/i.test(text)) return "included";
        if (/\b(extra|excl(usive|uded)?|will\s*be\s*charged|as\s*applicable|at\s*actuals)\b/i.test(text)) return "extra";
      }
    }
  }
  return gstRatePct > 0 ? "extra" : "unknown";
}

function normaliseUnit(unit: string): string {
  const cleaned = unit.replace(/[^A-Za-z.%/ ]/g, "").trim();
  return cleaned || "Nos";
}

/**
 * Applies a per-row discount column to produce the effective rate.
 *
 * Only percentage discounts are applied here, and only when the row prints
 * one — a discount expressed as an amount is left on the row for the reviewer
 * rather than divided back into a rate, because whether it applies per unit or
 * per line is not knowable from the cell alone.
 */
function effectiveRate(row: ExtractedRow): { rate: number; note: string | null } {
  if (row.rate === null) return { rate: 0, note: null };
  if (row.discount === null || row.discount <= 0) return { rate: row.rate, note: null };
  if (row.discount < 100 && row.qty !== null && row.amount !== null) {
    const withoutDiscount = row.qty * row.rate;
    const looksPercent = Math.abs(withoutDiscount * (1 - row.discount / 100) - row.amount) <= Math.max(1, row.amount * 0.01);
    if (looksPercent) {
      return {
        rate: round(row.rate * (1 - row.discount / 100), 2),
        note: `A ${row.discount}% discount from the file was applied to this rate.`,
      };
    }
  }
  return { rate: row.rate, note: `A discount of ${row.discount} is printed on this row but was not applied to the rate — check it.` };
}

export interface SpreadsheetOrderOutcome {
  result: AiOrderResult;
  /** False when no table was found, so the caller may fall back to the AI. */
  usable: boolean;
}

export function buildOrderFromWorkbook(workbook: WorkbookGrid, fileName: string): SpreadsheetOrderOutcome {
  const extraction = extractRowsFromWorkbook(workbook);
  const header = readHeaderFields(workbook);
  const documentTotal = readDocumentTotal(workbook);
  const gstRatePct = readGstRate(workbook);
  const discount = readDocumentDiscount(workbook);

  const validation: string[] = [];
  const warnings: string[] = [...extraction.warnings];

  const items = extraction.rows.map((row) => {
    const { rate, note } = effectiveRate(row);
    if (note) validation.push(`Row ${row.sourceRow} ("${row.description.slice(0, 60)}"): ${note}`);
    for (const reason of row.reviewReasons) {
      validation.push(`Row ${row.sourceRow} ("${row.description.slice(0, 60)}"): ${reason}`);
    }
    return {
      description: row.description,
      make: row.make,
      specification: row.specification,
      code: row.code,
      unit: normaliseUnit(row.unit),
      qty: row.qty ?? 0,
      rate,
      // The printed amount is preserved as printed. When the file did not
      // print one it stays 0 rather than being back-filled with qty x rate,
      // so validation downstream can tell "not printed" from "printed and
      // disagreeing".
      amount: row.amount ?? 0,
      taxPct: row.taxPct ?? 0,
      // The sheet a row came from is worth noting in a multi-sheet workbook.
      // A PDF's "sheets" are its pages, and "Sheet: Page 1" on every item is
      // noise in a field the reviewer reads.
      remarks: [row.remarks, row.sheet && workbook.kind !== "pdf" && workbook.sheets.length > 1 ? `Sheet: ${row.sheet}` : ""]
        .filter(Boolean)
        .join(" · "),
      sourcePage: 0,
      confidence: row.confidence,
    };
  });

  const needingReview = extraction.rows.filter((r) => r.reviewReasons.length > 0).length;
  if (needingReview > 0) {
    warnings.push(
      `${needingReview} of ${extraction.rows.length} row(s) could not be read with full confidence and are flagged for review. No value was guessed — check them against ${fileName}.`
    );
  }

  const computed = items.reduce((sum, it) => sum + it.qty * it.rate, 0);
  if (documentTotal > 0 && computed > 0) {
    const drift = Math.abs(computed - documentTotal) / documentTotal;
    // The stated total is normally the *net* figure: items, less the discount,
    // plus GST. When applying the discount and tax the file itself states
    // reproduces it, the rows are proven right and there is nothing to warn
    // about — warning anyway is what made this message appear on every
    // correctly-read order.
    const discountValue = discount.amount || (discount.pct ? (computed * discount.pct) / 100 : 0);
    const reconciled = (computed - discountValue) * (1 + gstRatePct / 100);
    const explained = Math.abs(reconciled - documentTotal) <= Math.max(1, documentTotal * 0.01);
    if (drift > 0.01 && !explained) {
      validation.push(
        `The item rows total ${round(computed, 2).toLocaleString("en-IN")} against the file's stated total of ${documentTotal.toLocaleString(
          "en-IN"
        )}. Rates were left exactly as the file prints them — the difference is usually GST, freight or a discount line, but check before saving.`
      );
    }
  }

  return {
    usable: items.length > 0,
    result: {
      documentType: /boq|bill\s*of\s*quantit/i.test(fileName) ? "BOQ" : "PURCHASE_ORDER",
      confidence: items.length ? (needingReview ? 0.8 : 0.95) : 0.1,
      extractedData: {
        projectName: header.projectName,
        clientName: header.clientName,
        vendorName: header.vendorName,
        poNumber: header.poNumber,
        poDate: header.poDate,
        siteAddress: header.siteAddress,
        deliveryAddress: "",
        gstin: header.gstin,
        terms: {
          gst: readGstTerm(workbook, gstRatePct),
          transport: "unknown",
          payment: header.paymentTerms || readPaymentTerms(workbook),
        },
        gstRatePct,
        discountPct: discount.pct,
        discountAmount: discount.amount,
        discountNote: discount.pct || discount.amount ? "Read from the document's totals block." : "",
        ratesAreGstInclusive: false,
        documentTotal,
        remarks: "",
        items,
      },
      validation,
      warnings,
    },
  };
}
