import "../ocr/domPolyfill";
import { PDFParse, PasswordException, InvalidPDFException } from "pdf-parse";
import { getOcrProvider } from "../ocr";
import { EncryptedPdfError, CorruptPdfError } from "../ocr/pdfText";
import { EMPTY_EXTRACTED_ORDER, type ExtractedOrderInput } from "../../modules/import/schema";
import { isSpreadsheetFile, readWorkbook } from "./spreadsheet";
import { buildOrderFromWorkbook } from "./spreadsheetOrder";

// Local (no cloud AI) auto-read of a PO/BOQ/quotation into the same shape
// the prototype's Claude-vision extractOrder() produced. Two strategies:
//   1. Table extraction (digital PDFs with drawn table lines) — pdf-parse's
//      getTable() analyses vector operators; rows are mapped to items by
//      column heuristics (description = longest text cell, qty/rate = the
//      numeric cells).
//   2. Line heuristics on raw text — fallback for tables it can't detect,
//      and the only strategy for OCR'd images.
// Header fields (PO no., date, vendor, GST terms) come from labeled-line
// regexes. Everything is best-effort by design: the result always lands in
// the editable New Project form for review before anything is saved.

const UNIT_WORDS = new Set(["nos", "no", "pcs", "pc", "set", "sets", "sqft", "sqm", "mtr", "m", "rmt", "kg", "ltr", "lot", "ls", "each", "unit", "bag", "box"]);

function toNumber(s: string): number | null {
  const cleaned = s.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeDateGuess(raw: string): string {
  const parts = raw.split(/[-/.]/);
  if (parts.length === 3 && /^\d{4}$/.test(parts[2] ?? "")) {
    const [d, m, y] = parts;
    if (/^\d{1,2}$/.test(d ?? "") && /^\d{1,2}$/.test(m ?? "")) {
      return `${y}-${(m ?? "").padStart(2, "0")}-${(d ?? "").padStart(2, "0")}`;
    }
  }
  if (parts.length === 3 && /^\d{4}$/.test(parts[0] ?? "")) {
    const [y, m, d] = parts;
    if (/^\d{1,2}$/.test(m ?? "") && /^\d{1,2}$/.test(d ?? "")) {
      return `${y}-${(m ?? "").padStart(2, "0")}-${(d ?? "").padStart(2, "0")}`;
    }
  }
  return "";
}

function parseHeaderFields(rawText: string, result: ExtractedOrderInput): void {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // "PO-00551"-style token anywhere (Zoho prints "# PO-00551" with no
  // label); fall back to a labeled "P.O. No: XYZ" pattern.
  const poToken = rawText.match(/\b(PO[-/][A-Z0-9][A-Z0-9/\-]*)\b/i);
  const poLabeled = rawText.match(/P\.?\s?O\.?\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{3,})/i);
  result.poNumber = poToken?.[1] ?? poLabeled?.[1] ?? "";

  const dateMatch = rawText.match(/\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/);
  if (dateMatch) result.poDate = normalizeDateGuess(dateMatch[1] ?? "");

  // "GST Extra", "GST excl" — or a "GST@ 18%" line in the totals block,
  // which means GST is charged on top (i.e. extra). Capture the rate too.
  const gstRateMatch = rawText.match(/GST\s*@?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (gstRateMatch) result.gstRatePct = Number(gstRateMatch[1]);
  if (/gst\s*(?:@?\s*\d+%?\s*)?(extra|excl)/i.test(rawText) || gstRateMatch) result.terms.gst = "extra";
  else if (/gst\s*(incl|included)/i.test(rawText) || /\bincl(?:usive)?\s*(?:of)?\s*gst/i.test(rawText)) result.terms.gst = "included";

  // Discount line in the totals block: "Discount(4.00%) (-) 3,44,251.50",
  // "Discount (-) 5,000.00", "Special Discount: 2%".
  for (const l of lines) {
    const m = l.match(/discount\s*\(?\s*(?:(\d+(?:\.\d+)?)\s*%)?\s*\)?\s*(?:\(-\)|[-–])?\s*([\d,]+(?:\.\d+)?)?\s*$/i);
    if (!m || (!m[1] && !m[2])) continue;
    if (m[1]) result.discountPct = Number(m[1]);
    if (m[2]) {
      const amt = toNumber(m[2]);
      if (amt !== null && amt > 0) result.discountAmount = amt;
    }
    break;
  }

  // The document's own grand total, from its totals block. Without this the
  // form had nothing to cross-check the drafted items against, and the
  // "documentTotal" it reported for a PDF was always zero.
  const TOTAL_LINE = [
    /^(?:grand\s*total|net\s*payable|total\s*payable)\b[^\d-]*([\d,]+(?:\.\d+)?)/i,
    /^(?:total\s*amount|net\s*amount|order\s*value)\b[^\d-]*([\d,]+(?:\.\d+)?)/i,
    /^total\b[^\d-]*([\d,]+(?:\.\d+)?)/i,
  ];
  for (const pattern of TOTAL_LINE) {
    const line = lines.find((l) => pattern.test(l) && !/in\s*words|sub\s*total/i.test(l));
    const amount = line ? toNumber(line.match(pattern)![1] ?? "") : null;
    if (amount !== null && amount > 0) {
      result.documentTotal = amount;
      break;
    }
  }

  if (/transport\s*(extra|at actuals)/i.test(rawText)) result.terms.transport = "extra";
  else if (/transport\s*(incl|included|free)/i.test(rawText)) result.terms.transport = "included";

  const paymentLine = lines.find((l) => /^payment\s*(terms)?\s*[:\-]/i.test(l));
  if (paymentLine) result.terms.payment = paymentLine.replace(/^payment\s*(terms)?\s*[:\-]\s*/i, "");

  // Same-line "Vendor: X" — or Zoho's label-on-its-own-line layout
  // ("Vendor Address" / "Vendor" with the name on the NEXT line).
  const vendorInline = lines.find((l) => /^(vendor|supplier|from|client|customer|m\/s\.?)\s*[:\-]\s*\S/i.test(l));
  if (vendorInline) {
    result.clientName = vendorInline.replace(/^(vendor|supplier|from|client|customer|m\/s\.?)\s*[:\-]\s*/i, "");
  } else {
    const labelIdx = lines.findIndex((l) => /^(vendor\s*(address)?|supplier|bill\s*from)$/i.test(l));
    const next = labelIdx >= 0 ? lines[labelIdx + 1] : undefined;
    if (next && !/^(deliver|ship|address)/i.test(next)) result.clientName = next;
  }

  // Zoho's "Ref# : <project reference>" — this is the project name.
  const refMatch = rawText.match(/Ref\s*#?\s*[:\-]\s*(.+)/i);
  if (refMatch) result.projectName = (refMatch[1] ?? "").trim().slice(0, 120);

  // Same-line "Site: X" — or Zoho's "Deliver To" label with the address on
  // the following line(s).
  const siteLine = lines.find((l) => /^(site|delivery address|ship\s*to|project site)\s*[:\-]\s*\S/i.test(l));
  if (siteLine) {
    result.siteAddress = siteLine.replace(/^(site|delivery address|ship\s*to|project site)\s*[:\-]\s*/i, "");
  } else {
    const deliverIdx = lines.findIndex((l) => /^(deliver\s*to|ship\s*to|delivery\s*address)$/i.test(l));
    const next = deliverIdx >= 0 ? lines[deliverIdx + 1] : undefined;
    if (next && !/^(vendor|www\.|#)/i.test(next)) result.siteAddress = next;
  }
}

// Map one detected table row to an item. A usable row has at least one
// meaty text cell and at least two numbers (qty, rate — where an extra
// number that equals qty×rate is treated as the amount column and ignored).
function tableRowToItem(row: string[]): NonNullable<ExtractedOrderInput["items"]>[number] | null {
  const cells = row.map((c) => c.trim()).filter((c) => c.length > 0);
  if (cells.length < 3) return null;

  const numbers: number[] = [];
  let unit = "Nos";
  const textCells: string[] = [];
  for (const cell of cells) {
    const n = toNumber(cell);
    if (n !== null) {
      numbers.push(n);
    } else if (UNIT_WORDS.has(cell.toLowerCase().replace(/\.$/, ""))) {
      unit = cell.replace(/\.$/, "");
    } else {
      textCells.push(cell);
    }
  }
  if (numbers.length < 2 || textCells.length === 0) return null;

  const description = textCells.reduce((a, b) => (b.length > a.length ? b : a), "");
  if (description.length < 3 || /^(total|sub\s*total|grand\s*total|amount|s\.?\s*no\.?)$/i.test(description)) return null;

  // Prefer the (qty, rate) pair whose product matches another number in the
  // row (that third number is the amount column); otherwise first two.
  for (let i = 0; i < numbers.length; i++) {
    for (let j = 0; j < numbers.length; j++) {
      if (i === j) continue;
      const product = numbers[i]! * numbers[j]!;
      if (numbers.some((n, k) => k !== i && k !== j && Math.abs(n - product) < 0.51)) {
        return { description, unit, qty: numbers[i]!, rate: numbers[j]! };
      }
    }
  }
  return { description, unit, qty: numbers[0]!, rate: numbers[1]! };
}

function itemsFromTables(tables: string[][][]): NonNullable<ExtractedOrderInput["items"]> {
  const items: NonNullable<ExtractedOrderInput["items"]> = [];
  for (const table of tables) {
    for (const row of table) {
      const item = tableRowToItem(row);
      if (item) items.push(item);
    }
  }
  return items;
}

// Indian-format number token, incl. lakh grouping: 1,046.00 / 46,35,939.00
const NUMBER_TOKEN = /^-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?$/;

function lineNumbers(line: string): number[] | null {
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return null;
  const nums: number[] = [];
  for (const t of tokens) {
    if (!NUMBER_TOKEN.test(t)) return null;
    const n = toNumber(t);
    if (n === null) return null;
    nums.push(n);
  }
  return nums;
}

const BLOCK_STOP = /^(sub\s*total|discount|gst\s*@|total|round\s*off|grand\s*total)/i;
const PAGE_NOISE = /^(--\s*\d+\s*of\s*\d+\s*--|powered by|#?\s*item\s*&\s*description|purchase\s*order|www\.|authori[sz]ed|signature|notes?$|terms)/i;

interface ItemBlock {
  descriptionParts: string[];
  numbers: number[];
  unit: string;
}

// Primary strategy for Zoho-style POs (the format this business's real
// documents use — verified against an actual PO-00551): each item starts
// with its serial number ("1 SS 316 PIPE 1'' MAKE : JINDAL"), continues
// over description lines ("SCH. 10", "MAKE : JINDAL SAW"), then qty / unit
// ("6.10" / "MTR") and "rate amount" ("1,046.00 6,380.60") lines — with
// qty+rate+amount sometimes collapsed onto one line. Tracking the expected
// serial (1, 2, 3…) is what makes "10" inside "SCH. 10" or a stray number
// never get mistaken for the start of a new item; blocks survive page
// breaks and interleaved totals blocks (Zoho prints Sub Total/GST between
// pages while items continue).
function itemsFromSerialBlocks(rawText: string): NonNullable<ExtractedOrderInput["items"]> {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim());
  const items: NonNullable<ExtractedOrderInput["items"]> = [];
  let expected = 1;
  let current: ItemBlock | null = null;

  const finalize = () => {
    if (!current) return;
    const { descriptionParts, numbers, unit } = current;
    current = null;
    const description = descriptionParts.join(" ").replace(/\s+/g, " ").trim().slice(0, 160);
    if (description.length < 3 || numbers.length < 2) return;
    let qty = numbers[0]!;
    let rate = numbers[1]!;
    // With 3+ numbers, pick the (qty, rate) pair whose product matches a
    // third number (the amount column).
    if (numbers.length >= 3) {
      outer: for (let i = 0; i < numbers.length; i++) {
        for (let j = 0; j < numbers.length; j++) {
          if (i === j) continue;
          const product = numbers[i]! * numbers[j]!;
          if (numbers.some((n, k) => k !== i && k !== j && Math.abs(n - product) < 0.6)) {
            qty = numbers[i]!;
            rate = numbers[j]!;
            break outer;
          }
        }
      }
    }
    if (qty <= 0 || rate < 0) return;
    items.push({ description, unit, qty, rate });
  };

  for (const line of lines) {
    if (!line || PAGE_NOISE.test(line)) continue;

    const serialMatch = line.match(/^(\d{1,3})\s+(.*[A-Za-z]{2}.*)$/);
    if (serialMatch && Number(serialMatch[1]) === expected) {
      finalize();
      current = { descriptionParts: [serialMatch[2] ?? ""], numbers: [], unit: "Nos" };
      expected += 1;
      continue;
    }

    if (!current) continue;

    if (BLOCK_STOP.test(line)) {
      finalize();
      continue; // keep `expected` — items resume across Zoho page-break totals
    }

    const nums = lineNumbers(line);
    if (nums) {
      current.numbers.push(...nums);
      continue;
    }
    if (UNIT_WORDS.has(line.toLowerCase().replace(/\.$/, ""))) {
      current.unit = line.replace(/\.$/, "");
      continue;
    }
    // Description continuation — only before quantities start appearing.
    if (current.numbers.length === 0) current.descriptionParts.push(line);
  }
  finalize();
  return items;
}

// Fallback: a text line shaped like "<description> [unit] <qty> <rate> [amount]".
function itemsFromLines(rawText: string): NonNullable<ExtractedOrderInput["items"]> {
  const items: NonNullable<ExtractedOrderInput["items"]> = [];
  const linePattern = /^(.{3,80}?)\s+(?:([A-Za-z]{1,5})\s+)?(\d+(?:\.\d+)?)\s+(\d+(?:[.,]\d+)?)(?:\s+\d+(?:[.,]\d+)?)?\s*$/;
  for (const line of rawText.split(/\r?\n/)) {
    const m = line.trim().match(linePattern);
    if (!m) continue;
    const [, description, unitRaw, qtyStr, rateStr] = m;
    const qty = Number(qtyStr);
    const rate = Number((rateStr ?? "0").replace(/,/g, ""));
    if (!description || Number.isNaN(qty) || Number.isNaN(rate) || qty <= 0) continue;
    if (/^(total|sub\s*total|grand\s*total)/i.test(description)) continue;
    const unit = unitRaw && UNIT_WORDS.has(unitRaw.toLowerCase()) ? unitRaw : "Nos";
    items.push({ description: description.trim(), unit, qty, rate });
  }
  return items;
}

export async function parseOrderFromBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName = ""
): Promise<ExtractedOrderInput> {
  const result: ExtractedOrderInput = structuredClone(EMPTY_EXTRACTED_ORDER);

  // Spreadsheets used to be rejected outright here ("Auto-read supports PDF,
  // PNG and JPEG files"), which meant this endpoint could not read the very
  // file format that is easiest to read exactly. They now go through the same
  // structured reader the AI pipeline uses, so a .xlsx or .csv gets identical
  // items, makes, quantities and rates whichever route it arrives by.
  if (isSpreadsheetFile(mimeType, fileName)) {
    const workbook = await readWorkbook(buffer, fileName);
    const { result: order } = buildOrderFromWorkbook(workbook, fileName);
    const d = order.extractedData;
    return {
      projectName: d.projectName,
      clientName: d.clientName,
      poNumber: d.poNumber,
      poDate: d.poDate,
      siteAddress: d.siteAddress,
      terms: d.terms,
      gstRatePct: d.gstRatePct || null,
      discountAmount: d.discountAmount || null,
      discountPct: d.discountPct || null,
      documentTotal: d.documentTotal,
      items: d.items,
    };
  }

  let rawText = "";
  let tableItems: NonNullable<ExtractedOrderInput["items"]> = [];

  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const textResult = await parser.getText();
      rawText = textResult.text;
      try {
        const tableResult = await parser.getTable();
        tableItems = itemsFromTables(tableResult.pages.flatMap((p) => p.tables));
      } catch {
        // Table detection is best-effort — fall through to line heuristics.
      }
    } catch (err) {
      if (err instanceof PasswordException) throw new EncryptedPdfError("This PDF is password-protected — remove the password and try again.");
      if (err instanceof InvalidPDFException) throw new CorruptPdfError("This PDF appears to be corrupted or invalid.");
      throw err;
    } finally {
      await parser.destroy();
    }
  } else if (mimeType === "image/png" || mimeType === "image/jpeg") {
    const provider = getOcrProvider();
    const output = await provider.extract({ buffer, mimeType, fileName: "upload" });
    rawText = output.rawText;
  } else {
    throw new Error("Auto-read supports PDF, PNG and JPEG files.");
  }

  parseHeaderFields(rawText, result);
  // Three strategies, best one wins by item count: detected vector tables,
  // the Zoho-style serial-block walker, and the single-line fallback.
  const serialItems = itemsFromSerialBlocks(rawText);
  const lineItems = itemsFromLines(rawText);
  result.items = [tableItems, serialItems, lineItems].reduce((best, cand) => (cand.length > best.length ? cand : best));
  return result;
}
