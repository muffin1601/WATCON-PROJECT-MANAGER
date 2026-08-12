import "../ocr/domPolyfill";
import { PDFParse, PasswordException, InvalidPDFException } from "pdf-parse";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { EncryptedPdfError, CorruptPdfError } from "../ocr/pdfText";
import { MAX_DOCUMENT_PAGES, MAX_AI_FILE_BYTES, MAX_VISUAL_PDF_PAGES } from "./config";
import { AiExtractionError } from "./client";
import {
  readWorkbook,
  gridToText,
  isSpreadsheetFile,
  SpreadsheetReadError,
  type WorkbookGrid,
} from "../import/spreadsheet";

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
  /**
   * Parsed cell grid, present only for spreadsheets/CSV. Its presence is what
   * lets the extraction layer read the file deterministically instead of
   * asking a model to transcribe it — see services/import/spreadsheetOrder.ts.
   */
  workbook?: WorkbookGrid;
}

export function isSupportedForAi(mimeType: string, fileName: string): boolean {
  if (mimeType === "application/pdf") return true;
  if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/jpg") return true;
  // Browsers frequently send CSV/XLSX as application/octet-stream, so the
  // extension is checked alongside the MIME type rather than instead of it.
  return isSpreadsheetFile(mimeType, fileName);
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
  if (scanned && pageCount > MAX_VISUAL_PDF_PAGES) {
    throw new AiExtractionError(
      `This scanned PDF has ${pageCount} pages. Scanned PDFs are limited to ${MAX_VISUAL_PDF_PAGES} page(s) on this deployment because visual PDF reading takes too long. Upload Excel/CSV if available, split the PDF, or enter the items manually.`
    );
  }

  const blocks: ContentBlockParam[] = [
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
    },
  ];

  // For a digital PDF, hand over the embedded text layer alongside the
  // rendered pages. The page image is what preserves the table *layout*; the
  // text layer is what preserves the exact digits. Reading "1,25,000.50" off
  // a rendered glyph run is where transcription errors in rates come from,
  // and having both lets the model cross-check a figure it is unsure of
  // instead of committing to a reading of the pixels.
  if (!scanned && textLayer.trim()) {
    blocks.push({
      type: "text",
      text: `----- EMBEDDED TEXT LAYER (exact characters, layout not preserved) -----\n${textLayer.slice(0, 400_000)}`,
    });
  }

  return {
    blocks,
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
 * Spreadsheets are parsed into a typed cell grid, not flattened to display
 * text.
 *
 * The grid is the authoritative source for extraction (see
 * services/import/spreadsheetOrder.ts). The text rendering produced here is
 * only ever *context* for a model — used when no table could be identified —
 * so the fact that rendering to text loses type information no longer matters
 * to the values that reach the Sales Order.
 */
async function ingestSpreadsheet(buffer: Buffer, fileName: string): Promise<IngestedDocument> {
  let workbook: WorkbookGrid;
  try {
    workbook = await readWorkbook(buffer, fileName);
  } catch (err) {
    if (err instanceof SpreadsheetReadError) throw new AiExtractionError(err.message);
    throw err;
  }

  const text = gridToText(workbook);
  return {
    blocks: [{ type: "text", text: `----- SPREADSHEET: ${fileName} -----\n${text}` }],
    sourceKind: "spreadsheet",
    pageCount: workbook.sheets.length,
    requiresVisualReading: false,
    textLayer: text,
    workbook,
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
  if (isSpreadsheetFile(mimeType, fileName)) {
    return ingestSpreadsheet(buffer, fileName);
  }

  throw new AiExtractionError(
    "Unsupported file type. Upload a PDF, scanned PDF, Excel (.xlsx/.xls), CSV, JPG, JPEG or PNG."
  );
}
