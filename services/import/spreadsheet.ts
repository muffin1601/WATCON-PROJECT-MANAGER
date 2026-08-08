import ExcelJS from "exceljs";

/**
 * Structured reader for .xlsx / .xls / .csv.
 *
 * The point of this module is that a spreadsheet is read as a **grid of typed
 * cells**, not as text. The previous pipeline flattened every sheet to CSV via
 * `cell.text`, which returns the *display* string — so a rate cell formatted
 * as currency arrived as `"₹ 1,25,000.50"`, a large number could arrive in
 * scientific notation, and a date-formatted numeric arrived as a date string.
 * Reading `cell.value` instead keeps the number the file actually stores, at
 * full precision, and resolves formulas to their cached result.
 *
 * Merged cells are filled across their span so a merged section heading or a
 * merged description does not leave holes the row reader has to guess at.
 */

export type CellValue = string | number | boolean | Date | null;

export interface SheetGrid {
  name: string;
  /** Row-major grid. Ragged rows are padded to the sheet's widest row. */
  rows: CellValue[][];
}

export interface WorkbookGrid {
  sheets: SheetGrid[];
  /** ".xlsx" | ".xls" | ".csv" — drives the messages shown on failure. */
  kind: "xlsx" | "csv";
}

export class SpreadsheetReadError extends Error {}

// ------------------------------------------------------------------ xlsx

type ExcelCellValue = ExcelJS.Cell["value"];

/** Unwraps ExcelJS's tagged cell values into a plain primitive. */
function normaliseCell(value: ExcelCellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;

  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    // Formula cells: use the cached calculated result. A file saved without
    // cached results has `result === undefined`; returning null (rather than
    // the formula text) means the row reader flags it for review instead of
    // treating "=D5*E5" as a description.
    if ("result" in v) return normaliseCell(v.result as ExcelCellValue);
    if ("richText" in v && Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    }
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("error" in v) return null;
    if ("hyperlink" in v && typeof v.hyperlink === "string") return v.hyperlink;
  }
  return null;
}

async function readXlsx(buffer: Buffer): Promise<WorkbookGrid> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS accepts a Node Buffer here; its typings ask for ArrayBuffer.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (err) {
    // The legacy BIFF .xls format is not an OOXML zip, so this is also the
    // path a genuine Excel 97-2003 file takes.
    const looksLegacyXls = buffer.length > 8 && buffer.readUInt32BE(0) === 0xd0cf11e0;
    throw new SpreadsheetReadError(
      looksLegacyXls
        ? "This is a legacy Excel 97-2003 (.xls) file, which cannot be read directly. Open it in Excel and save it as .xlsx or .csv, then upload it again."
        : `This spreadsheet could not be opened — it may be corrupted or password-protected. (${
            err instanceof Error ? err.message : "unknown error"
          })`
    );
  }

  const sheets: SheetGrid[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state === "veryHidden") continue;

    const rows: CellValue[][] = [];
    // Which rows carry content of their own, i.e. in a cell that is not
    // covered by a merge anchored on an earlier row. This is what tells a
    // genuine second data row apart from the blank continuation rows of a
    // tall merged cell — see fillMergedCells().
    const ownContent: boolean[] = [];
    let width = 0;

    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: CellValue[] = [];
      // `row.cellCount` excludes trailing empties; iterate by column index so
      // a blank cell in the middle of a row keeps its position and the column
      // mapping cannot shift left.
      const last = Math.max(row.cellCount, row.actualCellCount, sheet.columnCount);
      for (let c = 1; c <= last; c++) {
        const cell = sheet.getCell(rowNumber, c);
        // ExcelJS resolves a merged *covered* cell to its master's value, so
        // reading naively makes a cell merged down two rows look like the
        // same value typed twice — which becomes a duplicated product line.
        // Covered cells are read as empty here and re-filled deliberately
        // below.
        const covered = cell.isMerged && cell.master !== cell;
        const value = covered ? null : normaliseCell(cell.value);
        if (value !== null && value !== "") ownContent[rowNumber - 1] = true;
        cells.push(value);
      }
      while (cells.length && cells[cells.length - 1] === null) cells.pop();
      width = Math.max(width, cells.length);
      rows[rowNumber - 1] = cells;
    });

    // eachRow skips fully empty rows entirely, leaving holes in the array —
    // fill them so row indexes still line up with the file.
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    for (const r of rows) while (r.length < width) r.push(null);

    fillMergedCells(sheet, rows, ownContent);
    if (rows.some((r) => r.some((c) => c !== null && c !== ""))) {
      sheets.push({ name: sheet.name, rows });
    }
  }

  if (!sheets.length) throw new SpreadsheetReadError("This spreadsheet has no readable rows.");
  return { sheets, kind: "xlsx" };
}

/**
 * Copies each merged range's anchor value into the cells it covers.
 *
 * Horizontally this is always right: a description merged across two columns
 * should read as that description, not as one value plus a blank.
 *
 * Vertically it is only right when the covered row is a real row of its own.
 * A BOQ prints a tall item by merging its description, unit, qty and rate
 * down over two or three spreadsheet rows; filling those blindly turns one
 * product into two or three identical products, each with the same qty and
 * rate, and doubles or triples the order value. So a vertical fill is applied
 * only to rows that carry content of their own — which is exactly the case
 * where the merge is a shared label over genuinely distinct rows (a section
 * name beside per-row quantities) rather than one tall cell.
 */
function fillMergedCells(sheet: ExcelJS.Worksheet, rows: CellValue[][], ownContent: boolean[]): void {
  // ExcelJS exposes merges as "A1:C1" strings on the worksheet model.
  const merges: string[] = ((sheet as unknown as { model?: { merges?: string[] } }).model?.merges ?? []) as string[];
  for (const range of merges) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
    if (!m) continue;
    const [, c1, r1, c2, r2] = m;
    const colStart = colToIndex(c1!);
    const colEnd = colToIndex(c2!);
    const rowStart = Number(r1) - 1;
    const rowEnd = Number(r2) - 1;
    const anchor = rows[rowStart]?.[colStart] ?? null;
    if (anchor === null || anchor === "") continue;
    for (let r = rowStart; r <= rowEnd; r++) {
      // A row below the anchor only receives the value if it is a row in its
      // own right; a purely-covered continuation row stays empty and is
      // classified as blank rather than becoming a duplicate item.
      if (r !== rowStart && !ownContent[r]) continue;
      const row = rows[r];
      if (!row) continue;
      while (row.length <= colEnd) row.push(null);
      for (let c = colStart; c <= colEnd; c++) {
        if (row[c] === null || row[c] === "") row[c] = anchor;
      }
    }
  }
}

function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ------------------------------------------------------------------- csv

const DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Picks the delimiter by consistency, not by raw frequency.
 *
 * Frequency alone picks the wrong character constantly: a semicolon-delimited
 * BOQ whose descriptions contain commas has more commas than semicolons. The
 * delimiter that yields the same field count on most lines is the real one.
 */
export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 50);
  if (!sample.length) return ",";

  let best = ",";
  let bestScore = -1;
  for (const delim of DELIMITERS) {
    const counts = sample.map((line) => splitCsvLine(line, delim).length);
    const mode = counts.reduce((acc, n) => acc.set(n, (acc.get(n) ?? 0) + 1), new Map<number, number>());
    let modeCount = 0;
    let modeFields = 1;
    for (const [fields, count] of mode) {
      if (fields > 1 && count > modeCount) {
        modeCount = count;
        modeFields = fields;
      }
    }
    // Consistency first, then prefer the delimiter that finds more columns.
    const score = modeCount * 10 + Math.min(modeFields, 20);
    if (modeFields > 1 && score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return best;
}

/** Splits a single already-unquoted-newline line. Used only for sniffing. */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/**
 * RFC 4180 parser: honours quoted fields containing the delimiter, embedded
 * newlines and doubled quotes, so a quoted multi-line product description
 * stays one cell instead of splitting into phantom rows.
 */
export function parseCsv(text: string, delimiter?: string): CellValue[][] {
  // Strip a UTF-8 BOM — left in place it becomes part of the first header
  // cell ("﻿Description"), which silently breaks column matching.
  const body = text.replace(/^﻿/, "");
  const delim = delimiter ?? sniffDelimiter(body);

  const rows: CellValue[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row.map((c) => c.trim()));
    row = [];
  };

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      endField();
    } else if (ch === "\r") {
      if (body[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) endRow();

  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => {
    const padded: CellValue[] = r.map((c) => (c === "" ? null : c));
    while (padded.length < width) padded.push(null);
    return padded;
  });
}

function readCsv(buffer: Buffer, fileName: string): WorkbookGrid {
  const text = buffer.toString("utf8");
  const rows = parseCsv(text);
  if (!rows.some((r) => r.some((c) => c !== null && c !== ""))) {
    throw new SpreadsheetReadError("This CSV file has no readable rows.");
  }
  return { sheets: [{ name: fileName || "CSV", rows }], kind: "csv" };
}

// ---------------------------------------------------------------- entry

export function isSpreadsheetFile(mimeType: string, fileName: string): boolean {
  return (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "text/csv" ||
    mimeType === "application/csv" ||
    /\.(csv|xlsx|xls)$/i.test(fileName)
  );
}

export async function readWorkbook(buffer: Buffer, fileName: string): Promise<WorkbookGrid> {
  if (/\.csv$/i.test(fileName)) return readCsv(buffer, fileName);
  // A file named .xls(x) that is really a CSV/TSV is common enough (Tally and
  // several ERPs export that way) that sniffing the zip magic is worth it.
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (!isZip && buffer.length > 8 && buffer.readUInt32BE(0) !== 0xd0cf11e0) {
    try {
      return readCsv(buffer, fileName);
    } catch {
      /* fall through to the xlsx reader for its clearer error message */
    }
  }
  return readXlsx(buffer);
}

/**
 * Human-readable rendering of a grid, used only as context for the AI layer
 * and for the search text index — never as the source of extracted values.
 */
export function gridToText(workbook: WorkbookGrid): string {
  return workbook.sheets
    .map((sheet) => {
      const body = sheet.rows
        .map((row) =>
          row
            .map((cell) => {
              if (cell === null) return "";
              if (cell instanceof Date) return cell.toISOString().slice(0, 10);
              const s = String(cell).replace(/\s+/g, " ").trim();
              return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
            })
            .join(",")
        )
        .filter((line) => line.replace(/,/g, "").trim())
        .join("\n");
      return `===== SHEET: ${sheet.name} =====\n${body}`;
    })
    .join("\n\n");
}
