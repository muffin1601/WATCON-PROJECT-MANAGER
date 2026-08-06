import "../ocr/domPolyfill";
import { PDFParse, PasswordException, InvalidPDFException } from "pdf-parse";
import ExcelJS from "exceljs";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { EncryptedPdfError, CorruptPdfError } from "../ocr/pdfText";
import { MAX_DOCUMENT_PAGES, MAX_AI_FILE_BYTES } from "./config";
import { AiExtractionError } from "./client";

/**
 * Ingestion turns an uploaded file into the content blocks Claude reads.
 *
 * The important architectural point: **there is no separate OCR step for
 * PDFs or images.** Claude reads a scanned page directly from the document /
 * image block — rotation, skew, noise, stamps and signatures included. That
 * removes the prototype-era constraint recorded in KNOWN_LIMITATIONS.md
 * ("PDF OCR is NOT supported... rasterizing a PDF needs node-canvas"), which
 * existed only because Tesseract cannot accept a PDF.
 *
 * Tesseract is therefore no longer on the extraction path at all. It stays
 * wired into services/ocr/ for the search-indexing flow, which is unchanged.
 */

export type SourceKind = "pdf-digital" | "pdf-scanned" | "image" | "spreadsheet";

export interface IngestedDocument {
  blocks: ContentBlockParam[];
  sourceKind: SourceKind;
  /** Page count for PDFs, sheet count for spreadsheets, 1 for images. */
  pageCount: number;
  /** True when the file has no usable text layer, so Claude must read pixels. */
  requiresVisualReading: boolean;
  /** Digital-PDF/spreadsheet text, kept for validation cross-checks. */
  textLayer: string;
}

const SPREADSHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
]);

export function isSupportedForAi(mimeType: string, fileName: string): boolean {
  if (mimeType === "application/pdf") return true;
  if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/jpg") return true;
  if (SPREADSHEET_MIMES.has(mimeType)) return true;
  // Browsers frequently send CSV/XLSX as application/octet-stream, so fall
  // back to the extension rather than rejecting a valid file.
  return /\.(csv|xlsx|xls)$/i.test(fileName);
}

function assertSize(buffer: Buffer) {
  if (buffer.byteLength > MAX_AI_FILE_BYTES) {
    throw new AiExtractionError(
      `This file is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB. The AI reader accepts up to ${
        MAX_AI_FILE_BYTES / 1024 / 1024
      } MB — please compress it or split it.`
    );
  }
}

async function ingestPdf(buffer: Buffer): Promise<IngestedDocument> {
  const parser = new PDFParse({ data: buffer });
  let pageCount = 0;
  let textLayer = "";

  try {
    const info = await parser.getInfo();
    pageCount = info.total ?? 0;

    if (pageCount > MAX_DOCUMENT_PAGES) {
      throw new AiExtractionError(
        `This PDF has ${pageCount} pages. The limit is ${MAX_DOCUMENT_PAGES} pages per document — please split it and upload each part as a separate order.`
      );
    }

    // Read the embedded text layer. Its presence decides digital vs scanned,
    // which only affects which progress stage the user sees and whether we
    // can cross-check totals locally — Claude reads both the same way.
    try {
      const result = await parser.getText();
      textLayer = result.text ?? "";
    } catch {
      textLayer = "";
    }
  } catch (err) {
    if (err instanceof AiExtractionError) throw err;
    if (err instanceof PasswordException) {
      throw new EncryptedPdfError(
        "This PDF is password-protected. Remove the password and upload it again."
      );
    }
    if (err instanceof InvalidPDFException) {
      throw new CorruptPdfError("This PDF appears to be corrupted or is not a valid PDF file.");
    }
    throw err;
  } finally {
    await parser.destroy();
  }

  // A digital PDF carries a meaningful amount of text per page. Well under
  // that means a scan (or an image-only export) and the pages must be read
  // visually.
  const meaningfulText = textLayer.replace(/\s+/g, "").length;
  const scanned = pageCount > 0 && meaningfulText / pageCount < 40;

  return {
    blocks: [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
      },
    ],
    sourceKind: scanned ? "pdf-scanned" : "pdf-digital",
    pageCount,
    requiresVisualReading: scanned,
    textLayer,
  };
}

function ingestImage(buffer: Buffer, mimeType: string): IngestedDocument {
  const mediaType = mimeType === "image/png" ? "image/png" : "image/jpeg";
  return {
    blocks: [
      {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") },
      },
    ],
    sourceKind: "image",
    pageCount: 1,
    requiresVisualReading: true,
    textLayer: "",
  };
}

/**
 * Spreadsheets are converted to CSV text server-side rather than sent as a
 * file: Claude has no spreadsheet reader, and CSV text is both far cheaper in
 * tokens and lossless for the values that matter. Merged cells are unmerged
 * by repeating the anchor value so a merged "Section" header does not leave
 * blank cells the model has to guess at.
 */
async function ingestSpreadsheet(buffer: Buffer, fileName: string): Promise<IngestedDocument> {
  const workbook = new ExcelJS.Workbook();

  if (/\.csv$/i.test(fileName)) {
    const text = buffer.toString("utf8");
    return {
      blocks: [{ type: "text", text: `----- CSV: ${fileName} -----\n${text}` }],
      sourceKind: "spreadsheet",
      pageCount: 1,
      requiresVisualReading: false,
      textLayer: text,
    };
  }

  try {
    // ExcelJS accepts a Node Buffer here; its typings ask for ArrayBuffer.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new AiExtractionError("This spreadsheet could not be opened — it may be corrupted or password-protected.");
  }

  const parts: string[] = [];
  for (const sheet of workbook.worksheets) {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        // `cell.text` resolves formulas to their cached result and returns
        // the merged-anchor value for covered cells.
        const value = (cell.text ?? "").toString().replace(/\s+/g, " ").trim();
        cells.push(value.includes(",") ? `"${value.replace(/"/g, '""')}"` : value);
      });
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (cells.length) rows.push(cells.join(","));
    });
    if (rows.length) parts.push(`===== SHEET: ${sheet.name} =====\n${rows.join("\n")}`);
  }

  if (!parts.length) {
    throw new AiExtractionError("This spreadsheet has no readable rows.");
  }

  const text = parts.join("\n\n");
  return {
    blocks: [{ type: "text", text: `----- SPREADSHEET: ${fileName} -----\n${text}` }],
    sourceKind: "spreadsheet",
    pageCount: workbook.worksheets.length,
    requiresVisualReading: false,
    textLayer: text,
  };
}

export async function ingestDocument(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<IngestedDocument> {
  assertSize(buffer);

  if (mimeType === "application/pdf") return ingestPdf(buffer);
  if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return ingestImage(buffer, mimeType);
  }
  if (SPREADSHEET_MIMES.has(mimeType) || /\.(csv|xlsx|xls)$/i.test(fileName)) {
    return ingestSpreadsheet(buffer, fileName);
  }

  throw new AiExtractionError(
    "Unsupported file type. Upload a PDF, scanned PDF, Excel (.xlsx/.xls), CSV, JPG, JPEG or PNG."
  );
}
