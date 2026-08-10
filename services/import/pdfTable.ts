import "../ocr/domPolyfill";
import type { CellValue, SheetGrid, WorkbookGrid } from "./spreadsheet";

/**
 * Table-aware reading of a digital PDF's text layer.
 *
 * A PDF has no notion of a table — it has glyph runs at coordinates. The
 * previous local parser tried to recover rows with line-shaped regular
 * expressions, which is why an ordinary BOQ came back with zero items: as
 * soon as a description contained a number, or a column was blank, the
 * pattern stopped matching, and a row that did match could pick up its
 * neighbour's figures.
 *
 * So the geometry is reconstructed instead:
 *
 *   1. every text run is read with its (x, y) position and width;
 *   2. runs sharing a baseline become a **row**;
 *   3. run start positions are clustered across the whole page into
 *      **columns**, so a blank cell leaves a hole instead of shifting every
 *      later value one column to the left — the exact mechanism by which a
 *      rate ends up attached to the wrong product.
 *
 * The result is the same grid shape a spreadsheet produces, so the tested
 * header-detection and row-classification logic in tableExtract.ts reads a
 * PDF table by the identical code path as an .xlsx table.
 */

interface Run {
  text: string;
  x: number;
  y: number;
  width: number;
}

/** Runs on the same baseline belong to the same row (PDF points). */
const ROW_TOLERANCE = 3;
/** Horizontal gap that separates two cells rather than two words. */
const CELL_GAP = 6;
/** Start positions within this distance are the same column. */
const COLUMN_TOLERANCE = 12;

type PdfTextItem = { str?: string; transform?: number[]; width?: number; hasEOL?: boolean };

async function readRuns(buffer: Buffer): Promise<Run[][]> {
  // The legacy build is the one that runs under Node without a DOM; it is
  // already a declared runtime dependency (see next.config.ts, which forces
  // it into the serverless bundle for the OCR rasteriser).
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
    getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDocument> };
    GlobalWorkerOptions: { workerSrc: string };
  };
  // pdf-parse imports the same pdfjs module and knows where its bundled
  // worker file lives, including inside the serverless bundle. Reusing that
  // resolution avoids duplicating the path logic — and without a workerSrc,
  // pdfjs refuses to set up even its fake in-process worker.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const { PDFParse } = await import("pdf-parse");
    PDFParse.setWorker();
  }

  interface PdfPage {
    getTextContent: () => Promise<{ items: PdfTextItem[] }>;
  }
  interface PdfDocument {
    numPages: number;
    getPage: (n: number) => Promise<PdfPage>;
    destroy: () => Promise<void>;
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  const pages: Run[][] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const runs: Run[] = [];
      for (const item of content.items) {
        const text = (item.str ?? "").replace(/\s+/g, " ");
        if (!text.trim()) continue;
        const t = item.transform;
        if (!t || t.length < 6) continue;
        runs.push({ text, x: t[4]!, y: t[5]!, width: item.width ?? 0 });
      }
      pages.push(runs);
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

/** Groups runs into rows by baseline, top of page first. */
function toRows(runs: Run[]): Run[][] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Run[][] = [];
  for (const run of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0]!.y - run.y) <= ROW_TOLERANCE) last.push(run);
    else rows.push([run]);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

interface Cell {
  text: string;
  x: number;
  /** Right edge — right-aligned columns cluster on this, not on `x`. */
  end: number;
}

/** Merges runs separated by less than a cell gap back into one cell. */
function toCells(row: Run[]): Cell[] {
  const cells: Cell[] = [];
  let current: { parts: string[]; x: number; end: number } | null = null;
  for (const run of row) {
    if (current && run.x - current.end < CELL_GAP) {
      // Re-insert the space the PDF encoded as positioning rather than as a
      // space glyph, but only when there genuinely was a gap.
      current.parts.push(run.x - current.end > 0.5 ? ` ${run.text}` : run.text);
      current.end = run.x + run.width;
      continue;
    }
    if (current) cells.push({ text: current.parts.join("").replace(/\s+/g, " ").trim(), x: current.x, end: current.end });
    current = { parts: [run.text], x: run.x, end: run.x + run.width };
  }
  if (current) cells.push({ text: current.parts.join("").replace(/\s+/g, " ").trim(), x: current.x, end: current.end });
  return cells.filter((c) => c.text);
}

interface Column {
  /** Representative left edge, and right edge, in PDF points. */
  start: number;
  end: number;
}

/**
 * Derives the page's columns from where cells actually sit.
 *
 * Clustering on the left edge alone — which this did — is correct for text and
 * wrong for money. Amount, rate and quantity columns are **right-aligned**, so
 * "6.10" and "335.50" begin at different x positions and were filed as two
 * different columns; the header "Qty" then matched only whichever rows happened
 * to start where it did, and every other row reached the Sales Order with a
 * quantity of zero. That is the single biggest cause of wrong figures from a
 * PDF.
 *
 * A cell therefore joins a column when EITHER edge lines up with it, which is
 * what makes a left-aligned and a right-aligned column each cluster correctly
 * on the same page.
 */
function columnsFor(rows: Cell[][]): Column[] {
  const cells = rows.flat().sort((a, b) => a.x - b.x);
  const clusters: { start: number; end: number; members: Cell[] }[] = [];

  for (const cell of cells) {
    const match = clusters.find(
      (c) => Math.abs(c.start - cell.x) <= COLUMN_TOLERANCE || Math.abs(c.end - cell.end) <= COLUMN_TOLERANCE
    );
    if (match) {
      // The extremes are kept for matching, so a wider value later on the page
      // still lands in the column it belongs to.
      match.start = Math.min(match.start, cell.x);
      match.end = Math.max(match.end, cell.end);
      match.members.push(cell);
      continue;
    }
    clusters.push({ start: cell.x, end: cell.end, members: [cell] });
  }

  // Order and match on the MEDIAN edges, not the extremes. A page title or a
  // date that happens to end level with the Amount column joins it — harmless
  // in itself, but it drags that column's leftmost edge across the Qty and
  // Rate columns, and ordering by the extreme then puts Amount *before* Qty.
  // The columns come out shuffled, the header row no longer lines up with its
  // own figures, and quantities land under "Amount". A median ignores those
  // few outliers.
  return clusters
    .map((c) => ({ start: median(c.members.map((m) => m.x)), end: median(c.members.map((m) => m.end)) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function assignColumns(cells: Cell[], columns: Column[]): CellValue[] {
  const out: CellValue[] = new Array(columns.length).fill(null);
  for (const cell of cells) {
    // Best match on either edge — the same rule the columns were built with.
    let index = 0;
    let bestDistance = Infinity;
    columns.forEach((column, i) => {
      const distance = Math.min(Math.abs(column.start - cell.x), Math.abs(column.end - cell.end));
      if (distance < bestDistance) {
        bestDistance = distance;
        index = i;
      }
    });
    // A column that already holds text means two runs landed in one slot —
    // keep both rather than dropping one.
    out[index] = out[index] ? `${out[index]} ${cell.text}` : cell.text;
  }
  return out;
}

export async function readPdfAsGrid(buffer: Buffer): Promise<WorkbookGrid> {
  const pages = await readRuns(buffer);
  const sheets: SheetGrid[] = [];

  pages.forEach((runs, i) => {
    if (!runs.length) return;
    const cellRows = toRows(runs).map(toCells);
    const columns = columnsFor(cellRows);
    const rows = cellRows.map((cells) => assignColumns(cells, columns));
    if (rows.length) sheets.push({ name: `Page ${i + 1}`, rows });
  });

  return { sheets, kind: "pdf" };
}
