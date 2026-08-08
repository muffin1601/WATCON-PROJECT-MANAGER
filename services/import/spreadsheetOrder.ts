import type { AiOrderResult } from "../../modules/ai/schema";
import type { CellValue, WorkbookGrid } from "./spreadsheet";
import { extractRowsFromWorkbook, type ExtractedRow } from "./tableExtract";
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
  { key: "poNumber", re: /^(p\.?o\.?\s*(no|number|ref)|purchase\s*order\s*(no|number)|work\s*order\s*(ref|no)|order\s*(ref|no|number)|w\.?o\.?\s*no|ref(erence)?\s*(no)?)\b/i },
  { key: "poDate", re: /^(p\.?o\.?\s*date|order\s*date|date|dated)\b/i },
  { key: "clientName", re: /^(client|customer|buyer|bill\s*to|issued\s*by|owner|to)\b/i },
  { key: "vendorName", re: /^(vendor|supplier|seller|from)\b/i },
  { key: "projectName", re: /^(project|project\s*name|job|site\s*name|work)\b/i },
  { key: "siteAddress", re: /^(site|site\s*address|delivery\s*(address|at)|ship\s*to|location)\b/i },
  { key: "gstin", re: /^(gstin|gst\s*(no|number)|gst\s*reg)\b/i },
  { key: "paymentTerms", re: /^(payment\s*terms?|terms\s*of\s*payment)\b/i },
];

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
    for (const row of sheet.rows.slice(0, HEADER_SCAN_ROWS)) {
      const cells = row.map((c) => cellText(c));
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
          // Value in the next non-empty cell to the right.
          for (let j = i + 1; j < cells.length; j++) {
            if (cells[j]) {
              value = cells[j]!;
              break;
            }
          }
        }
        if (!value || value.length > 200) continue;

        for (const { key, re } of LABELS) {
          if (out[key]) continue;
          if (!re.test(label)) continue;
          if (key === "poDate") {
            const iso = toIsoDate(inline ? value : (row[cells.indexOf(value)] ?? value));
            if (iso) out.poDate = iso;
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

/** Document-level GST rate, when the file states one in a totals row. */
function readGstRate(workbook: WorkbookGrid): number {
  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        const text = cellText(cell);
        const m = text.match(/\b(?:gst|igst|cgst|sgst)\b[^0-9]{0,12}(\d{1,2}(?:\.\d+)?)\s*%/i);
        if (m) {
          const pct = Number(m[1]);
          if (pct > 0 && pct <= 40) return pct;
        }
      }
    }
  }
  return 0;
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
      remarks: [row.remarks, row.sheet && workbook.sheets.length > 1 ? `Sheet: ${row.sheet}` : ""]
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
    if (drift > 0.01) {
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
          gst: gstRatePct > 0 ? "extra" : "unknown",
          transport: "unknown",
          payment: header.paymentTerms,
        },
        gstRatePct,
        discountPct: 0,
        discountAmount: 0,
        discountNote: "",
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
