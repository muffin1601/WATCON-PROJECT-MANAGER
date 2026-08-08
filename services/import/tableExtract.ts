import type { CellValue, SheetGrid, WorkbookGrid } from "./spreadsheet";
import { parseNumber, parsePositive, round } from "./numbers";

/**
 * Deterministic product/price extraction from a spreadsheet or CSV grid.
 *
 * This is the "structured parsing first" half of the engine: when the source
 * file already carries a table, no language model is asked to read it. The
 * values are taken from the cells they are printed in, so a rate can never be
 * paired with the wrong product, and nothing is ever invented — a value the
 * file does not contain comes back null and the row is flagged for review.
 *
 * Three problems drive the design:
 *
 *  1. **The header is rarely row 1.** Real BOQs carry company blocks, PO
 *     references and blank spacer rows above the table, and a workbook often
 *     holds several tables (per annexure, per section, per sheet). So the
 *     header is *found by scoring every row*, and a new header simply starts
 *     a new table.
 *  2. **Column names vary per client.** "Rate", "Unit Rate", "Unit Price",
 *     "Price/Unit" and "Basic Rate" all mean the same column, and "Unit
 *     Price" must not be mistaken for the unit-of-measure column. Matching is
 *     therefore scored by specificity rather than by first-match-wins.
 *  3. **Not every row under a header is a product.** Section headings,
 *     sub-totals, GST lines and blank spacers live inside the table. Those
 *     are classified out; anything ambiguous is kept and flagged, because
 *     dropping a real product silently is the worst outcome.
 */

export type ItemField =
  | "sno"
  | "code"
  | "description"
  | "specification"
  | "make"
  | "unit"
  | "qty"
  | "rate"
  | "discount"
  | "taxPct"
  | "amount"
  | "remarks";

interface Pattern {
  field: ItemField;
  re: RegExp;
  /** Higher wins when one header cell matches several fields. */
  score: number;
}

/**
 * Header synonyms, most specific first. The scores matter: "unit price" must
 * beat "unit", and "total amount" must beat "total" losing to a tax column.
 */
const PATTERNS: Pattern[] = [
  // --- rate (per-unit price). Deliberately outranks `unit` on "unit price".
  { field: "rate", re: /^(unit\s*(price|rate|cost)|rate\s*(per\s*unit|\/\s*unit)?|price\s*(per\s*unit|\/\s*unit)?|basic\s*rate|net\s*rate|list\s*rate|mrp|rate\s*\(?(rs|inr|₹)?\.?\)?)$/i, score: 100 },
  { field: "rate", re: /\b(unit\s*price|unit\s*rate|rate\s*per|price\s*per|basic\s*rate|net\s*rate)\b/i, score: 90 },
  { field: "rate", re: /^rate\b/i, score: 80 },
  { field: "rate", re: /^price\b/i, score: 70 },

  // --- amount (line total)
  { field: "amount", re: /^(amount|total\s*amount|line\s*total|net\s*amount|total\s*value|value|taxable\s*value|total)$/i, score: 100 },
  { field: "amount", re: /\b(amount|line\s*total|net\s*amount|total\s*value|taxable\s*value)\b/i, score: 85 },
  { field: "amount", re: /^amt\b/i, score: 80 },

  // --- quantity
  { field: "qty", re: /^(qty|quantity|qnty|qty\.|nos|no\.\s*of\s*(units|nos)|order\s*qty|required\s*qty)$/i, score: 100 },
  { field: "qty", re: /\b(quantity|qty)\b/i, score: 85 },

  // --- unit of measure
  { field: "unit", re: /^(unit|uom|u\.?o\.?m\.?|units|unit\s*of\s*measure|measurement\s*unit)$/i, score: 100 },
  { field: "unit", re: /\b(uom|unit\s*of\s*measure)\b/i, score: 90 },
  { field: "unit", re: /^unit\b/i, score: 60 },

  // --- description / product name
  { field: "description", re: /^(description|item\s*description|material\s*description|product|product\s*name|item|item\s*name|particulars|particulars\s*of\s*goods|goods\s*description|work\s*description|nomenclature|material)$/i, score: 100 },
  { field: "description", re: /\b(description|particulars|product\s*name|item\s*name|nomenclature)\b/i, score: 85 },
  { field: "description", re: /^(item|product|material|goods|work)s?\b/i, score: 70 },

  // --- code / SKU
  { field: "code", re: /^(sku|item\s*code|product\s*code|material\s*code|code|hsn|hsn\/?sac|hsn\s*code|sac|part\s*(no|number)|catalog(ue)?\s*(no|number))$/i, score: 100 },
  { field: "code", re: /\b(sku|hsn|sac|item\s*code|product\s*code|part\s*no)\b/i, score: 85 },

  // --- make / brand
  { field: "make", re: /^(make|brand|makes|brands|brand\s*\/\s*makes?|make\s*\/\s*brand|manufacturer)$/i, score: 100 },
  { field: "make", re: /\b(brand|make|manufacturer)\b/i, score: 80 },

  // --- tax
  { field: "taxPct", re: /^(gst|gst\s*%|gst\s*rate|tax|tax\s*%|tax\s*rate|igst|cgst|sgst|vat)\s*(\(%\))?$/i, score: 100 },
  { field: "taxPct", re: /\b(gst|tax|igst|cgst|sgst|vat)\s*(%|rate|percent)/i, score: 90 },

  // --- discount
  { field: "discount", re: /^(disc|discount|discount\s*%|disc\s*%|less|rebate)$/i, score: 100 },
  { field: "discount", re: /\b(discount|rebate)\b/i, score: 85 },

  // --- specification / remarks / serial
  { field: "specification", re: /^(spec|specs|specification|specifications|technical\s*specification|size|model)$/i, score: 100 },
  { field: "remarks", re: /^(remark|remarks|note|notes|comment|comments)$/i, score: 100 },
  { field: "sno", re: /^(s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|serial|#|no\.?|item\s*no\.?)$/i, score: 100 },
];

/** Rows whose leading text marks them as totals/tax/summary, never products. */
const TOTAL_ROW =
  /^\s*(sub\s*-?\s*total|total|grand\s*total|net\s*total|net\s*payable|round\s*(ing)?\s*off|discount|less\b|add\b|freight|packing|transport(ation)?\s*charges|insurance|gst|igst|cgst|sgst|vat|tax|taxable|amount\s*(in\s*words|chargeable)|rupees\b|carried\s*(over|forward)|brought\s*forward|b\/f|c\/f|continued)\b/i;

/**
 * Payment-schedule and balance lines that sit in the totals block under their
 * own wording rather than under "Total". They carry an amount and no
 * quantity, so without naming them they read as a product priced at that
 * amount — e.g. "Due Amount Advance @50%" landing in the Sales Order.
 */
const SETTLEMENT_ROW =
  /^\s*(due\b|balance\b|advance\b|paid\b|payable\b|received\b|on\s*account|part\s*payment|retention|withheld|deduction|amount\s*due)/i;

/** Rows that are page/table furniture rather than data. */
const FURNITURE_ROW = /^\s*(page\s*\d|terms\s*(and|&)\s*conditions?|note\s*:|for\s+\S+|authoris?ed\s+signator|this\s+is\s+a\s+computer)/i;

export interface ExtractedRow {
  description: string;
  specification: string;
  make: string;
  code: string;
  unit: string;
  qty: number | null;
  rate: number | null;
  amount: number | null;
  discount: number | null;
  taxPct: number | null;
  remarks: string;
  /** Sheet the row came from, and its 1-based row number in that sheet. */
  sheet: string;
  sourceRow: number;
  /** Human-readable reasons this row could not be read with full confidence. */
  reviewReasons: string[];
  /** 0-1. Derived, never guessed: a fully-read row with matching arithmetic is 1. */
  confidence: number;
}

export interface TableExtractionResult {
  rows: ExtractedRow[];
  /** Tables found, for diagnostics and for the "no table found" message. */
  tableCount: number;
  /** Column headers as printed, per table — surfaced in warnings. */
  headers: string[][];
  warnings: string[];
}

type ColumnMap = Partial<Record<ItemField, number>>;

function cellText(cell: CellValue): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).replace(/\s+/g, " ").trim();
}

/**
 * Scores a candidate header row and returns its column map.
 *
 * A row qualifies as a header only when it names a description-like column
 * AND at least one of qty / rate / amount — anything looser matches a random
 * text row and would start a phantom table.
 */
function headerMapFor(row: CellValue[]): { map: ColumnMap; score: number } | null {
  const best = new Map<ItemField, { col: number; score: number }>();

  row.forEach((cell, col) => {
    const raw = cellText(cell);
    if (!raw || raw.length > 60) return;
    // A header cell is a label, not data: a purely numeric cell never is one.
    if (parseNumber(raw) !== null) return;
    const text = raw.replace(/[()\[\]]/g, " ").replace(/\s+/g, " ").trim();

    let winner: { field: ItemField; score: number } | null = null;
    for (const p of PATTERNS) {
      if (!p.re.test(text)) continue;
      if (!winner || p.score > winner.score) winner = { field: p.field, score: p.score };
    }
    if (!winner) return;
    const held = best.get(winner.field);
    if (!held || winner.score > held.score) best.set(winner.field, { col, score: winner.score });
  });

  const map: ColumnMap = {};
  let score = 0;
  for (const [field, { col, score: s }] of best) {
    map[field] = col;
    score += s;
  }

  const hasDescription = map.description !== undefined;
  const hasNumeric = map.qty !== undefined || map.rate !== undefined || map.amount !== undefined;
  if (!hasDescription || !hasNumeric) return null;
  return { map, score };
}

/**
 * A header may be split across two stacked rows ("Rate" over "(Rs.)", or a
 * merged "Quantity" group over "Qty | Unit"). Merging the pair before scoring
 * recovers the columns that neither row names on its own.
 */
function mergeRows(a: CellValue[], b: CellValue[]): CellValue[] {
  const width = Math.max(a.length, b.length);
  const out: CellValue[] = [];
  for (let i = 0; i < width; i++) {
    const top = cellText(a[i] ?? null);
    const bottom = cellText(b[i] ?? null);
    out.push([top, bottom].filter(Boolean).join(" ").trim() || null);
  }
  return out;
}

interface Table {
  map: ColumnMap;
  headers: string[];
  headerRow: number;
  /** Exclusive end index. */
  endRow: number;
}

/** Finds every table in a sheet by locating its header rows. */
function findTables(sheet: SheetGrid): Table[] {
  const tables: Table[] = [];
  const rows = sheet.rows;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    let found = headerMapFor(row);
    let consumed = 1;
    if (!found && rows[i + 1]) {
      // The two-row merge must not pre-empt a clean header on the next row.
      // A merged section title sitting above the real header ("PROJECT: ...
      // " over "S.no | Particulars | Unit | Qty | Rate | Amount") still
      // produces a *qualifying* map, because "... Particulars" and "... Qty"
      // match on a word boundary — but "... Rate" and "... Unit" do not match
      // their anchored patterns, so that map silently loses the rate and unit
      // columns and every row then looks like it has no printed rate.
      // Comparing scores keeps the better-formed header.
      const nextAlone = headerMapFor(rows[i + 1]!);
      const merged = headerMapFor(mergeRows(row, rows[i + 1]!));
      if (merged && (!nextAlone || merged.score > nextAlone.score)) {
        found = merged;
        consumed = 2;
      }
      // Otherwise leave `found` null: the loop reaches i + 1 next and uses
      // the clean single-row header there.
    }
    if (!found) continue;

    const headerRow = i;
    const headers = row.map((c) => cellText(c));
    // The table runs until the next header row or the end of the sheet;
    // trailing non-item rows are classified out per-row rather than by
    // guessing where the table stops, so a totals block between two page
    // headers cannot truncate the item list.
    let end = rows.length;
    for (let j = headerRow + consumed; j < rows.length; j++) {
      const next = rows[j];
      if (!next) continue;
      if (headerMapFor(next)) {
        end = j;
        break;
      }
    }
    tables.push({ map: found.map, headers, headerRow: headerRow + consumed - 1, endRow: end });
    i = end - 1;
  }
  return tables;
}

function textAt(row: CellValue[], col: number | undefined): string {
  return col === undefined ? "" : cellText(row[col] ?? null);
}

/**
 * A make written inside the description rather than in its own column —
 * "SS 316 Pipe 1 inch MAKE : JINDAL SAW", "Cable (Brand: Polycab)".
 *
 * This matters more here than it looks: `item + make` is the key into the
 * Items & Stocks master, so a make left behind in the description creates a
 * second stock line for a product that already exists.
 */
const INLINE_MAKE = /[([]?\s*\b(?:make|makes|brand|brands|mfr|manufacturer)\b\s*[:\-–]\s*([^,;)\]]{1,40})[)\]]?/i;

/** A row that only names a make, printed under the item it applies to. */
const MAKE_ONLY_ROW = /^\s*\b(?:make|makes|brand|brands|mfr|manufacturer)\b\s*[:\-–]\s*(.+)$/i;

/**
 * Normalises a make cell.
 *
 * Documents routinely list alternatives for one line ("Supreme / Finolex",
 * "Astral or equivalent"). The first named brand is taken — the same rule the
 * AI prompt follows, so both engines produce the same stock key for the same
 * document.
 */
export function normaliseMake(raw: string): string {
  const cleaned = raw
    .replace(/\b(or\s+)?(equivalent|equiv\.?|similar|approved\s+equal)\b.*$/i, "")
    .replace(/\b(any\s+of|either)\b/gi, "")
    .trim();
  const first = cleaned.split(/\s*[/|,]\s*|\s+\bor\b\s+/i)[0] ?? "";
  return first.replace(/^[-–:\s]+|[-–:\s.]+$/g, "").slice(0, 60);
}

/**
 * Splits an inline make out of a description, returning the description with
 * the make removed so the two are not stored twice.
 */
export function splitInlineMake(description: string): { description: string; make: string } {
  const m = INLINE_MAKE.exec(description);
  if (!m) return { description, make: "" };
  const make = normaliseMake(m[1] ?? "");
  if (!make) return { description, make: "" };
  const stripped = description
    .replace(INLINE_MAKE, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[,;:\-–]\s*$/, "")
    .trim();
  return { description: stripped || description, make };
}

function numAt(row: CellValue[], col: number | undefined): number | null {
  if (col === undefined) return null;
  return parseNumber(row[col] ?? null);
}

/**
 * Reads one data row into an item, or returns null when the row is not a
 * product row at all.
 *
 * The order of the checks is the contract: a row is discarded only when it is
 * positively identified as a non-product (blank, totals line, bare section
 * heading). Everything else is returned — flagged if incomplete — because a
 * silently dropped product is the failure this whole module exists to avoid.
 */
function readRow(row: CellValue[], table: Table, sheetName: string, index: number): ExtractedRow | null {
  const { map } = table;
  const description = textAt(row, map.description);
  const nonEmpty = row.filter((c) => c !== null && cellText(c) !== "").length;
  if (nonEmpty === 0) return null;

  const qty = numAt(row, map.qty);
  const rateRaw = numAt(row, map.rate);
  const amountRaw = numAt(row, map.amount);

  // Totals / tax / carry-forward lines: their figures belong to the document,
  // not to a product, and letting one through creates a phantom "Total" item.
  const leading = description || row.map((c) => cellText(c)).find((t) => t && parseNumber(t) === null) || "";
  if (TOTAL_ROW.test(leading) || FURNITURE_ROW.test(leading) || SETTLEMENT_ROW.test(leading)) return null;

  // A bare section heading: text, and no numbers anywhere in the row.
  const hasAnyNumber = qty !== null || rateRaw !== null || amountRaw !== null;
  if (!hasAnyNumber) return null;
  if (!description) return null;

  // A row carrying ONLY an amount — no quantity and no rate — is not a
  // product line. Every totals-block row has that shape (sub-totals, tax,
  // rounding, payment schedules), and so does nothing that is actually sold.
  // Accepting them is how "Due Amount Advance @50%" became a Sales Order item
  // priced at the advance. A product row must state how many, or what one
  // costs; if the table genuinely has no rate or amount column at all, the
  // check below reports that instead.
  if (qty === null && rateRaw === null && amountRaw !== null) return null;

  const reviewReasons: string[] = [];
  let rate = rateRaw;
  let amount = amountRaw;

  // Derivation is allowed ONLY between the three figures the row itself
  // prints, and every derived value says so. Nothing is derived from another
  // row, a running total, or a document-level figure.
  if (rate === null && qty !== null && qty !== 0 && amount !== null) {
    rate = round(amount / qty, 4);
    reviewReasons.push("Rate was not printed — computed as amount ÷ quantity.");
  } else if (amount === null && qty !== null && rate !== null) {
    amount = round(qty * rate, 2);
  }

  if (qty === null) reviewReasons.push("Quantity could not be read from this row.");
  else if (qty <= 0) reviewReasons.push("Quantity is zero or negative.");
  if (rate === null) reviewReasons.push("Rate could not be read from this row.");
  if (map.rate === undefined && map.amount === undefined) {
    reviewReasons.push("This table has no rate or amount column.");
  }

  // Arithmetic cross-check against the printed amount — reported, never used
  // to overwrite what the document prints.
  if (qty !== null && rate !== null && amountRaw !== null && amountRaw !== 0) {
    const computed = qty * rate;
    const tolerance = Math.max(1, Math.abs(amountRaw) * 0.01);
    if (Math.abs(computed - amountRaw) > tolerance) {
      reviewReasons.push(
        `Quantity × rate is ${round(computed, 2).toLocaleString("en-IN")} but the file prints ${amountRaw.toLocaleString("en-IN")}.`
      );
    }
  }

  const discountCell = textAt(row, map.discount);
  const discount = map.discount === undefined ? null : parseNumber(discountCell);
  const taxPct = numAt(row, map.taxPct);

  // The make column wins when the file has one; only if it is absent or empty
  // is the description searched for an inline "Make: X" — and when one is
  // found there, it is removed from the description so the same brand is not
  // stored in both fields.
  const columnMake = normaliseMake(textAt(row, map.make));
  const inline = columnMake ? { description, make: columnMake } : splitInlineMake(description);

  return {
    description: inline.description.slice(0, 300),
    specification: textAt(row, map.specification),
    make: inline.make,
    code: textAt(row, map.code),
    unit: textAt(row, map.unit),
    qty,
    rate,
    amount,
    discount,
    taxPct,
    remarks: textAt(row, map.remarks),
    sheet: sheetName,
    sourceRow: index + 1,
    reviewReasons,
    confidence: reviewReasons.length === 0 ? 1 : Math.max(0.3, 0.9 - 0.2 * reviewReasons.length),
  };
}

/** Extracts every product row from every table on every sheet. */
export function extractRowsFromWorkbook(workbook: WorkbookGrid): TableExtractionResult {
  const rows: ExtractedRow[] = [];
  const headers: string[][] = [];
  const warnings: string[] = [];
  let tableCount = 0;

  for (const sheet of workbook.sheets) {
    const tables = findTables(sheet);
    if (!tables.length) continue;
    for (const table of tables) {
      tableCount++;
      headers.push(table.headers.filter(Boolean));
      let previous: ExtractedRow | null = null;
      for (let i = table.headerRow + 1; i < table.endRow; i++) {
        const row = sheet.rows[i];
        if (!row) continue;

        // A "Make: Jindal" line printed on its own row beneath the item it
        // describes. It carries no quantity, so readRow() would discard it and
        // the brand would be lost — attach it to the item above instead.
        const continuation = MAKE_ONLY_ROW.exec(textAt(row, table.map.description));
        if (continuation && previous && !previous.make) {
          const make = normaliseMake(continuation[1] ?? "");
          if (make) {
            previous.make = make;
            continue;
          }
        }

        const item = readRow(row, table, sheet.name, i);
        if (item) {
          rows.push(item);
          previous = item;
        }
      }
    }
  }

  if (!tableCount) {
    warnings.push(
      "No product table could be identified in this file. A table needs a header row naming a description/product column and at least one of quantity, rate or amount."
    );
  } else if (workbook.sheets.length > 1) {
    warnings.push(
      `${tableCount} table(s) were read across ${workbook.sheets.length} sheet(s): ${workbook.sheets
        .map((s) => s.name)
        .join(", ")}.`
    );
  }

  return { rows, tableCount, headers, warnings };
}
