import "./domPolyfill";
import { PDFParse } from "pdf-parse";
import { getOcrProvider } from "./index";

/**
 * Scanned-PDF OCR for the local (no-AI-key) engine.
 *
 * Tesseract cannot open a PDF, which is why the engine previously returned
 * nothing at all for scanned documents. pdf-parse can rasterise a page to a
 * PNG, so each page is rendered and handed to the OCR provider one at a time.
 *
 * Rendering at scale 2 (≈150 DPI equivalent) is the point where BOQ table
 * digits stop being ambiguous to Tesseract without making each page so large
 * that OCR time explodes. Pages are capped because a 40-page scan is already
 * minutes of CPU-bound OCR; the caller reports how many pages were read so the
 * reviewer knows whether anything was skipped.
 */

export const MAX_OCR_PAGES = 40;
const RENDER_SCALE = 2;

export interface PdfOcrResult {
  text: string;
  pagesRead: number;
  totalPages: number;
}

/** Never throws — a failed page yields no text rather than failing the upload. */
export async function ocrScannedPdf(buffer: Buffer, maxPages = MAX_OCR_PAGES): Promise<PdfOcrResult> {
  const parser = new PDFParse({ data: buffer });
  const provider = getOcrProvider();
  let totalPages = 0;
  let pagesRead = 0;
  const parts: string[] = [];

  try {
    const info = await parser.getInfo();
    totalPages = info.total ?? 0;
    const limit = Math.min(totalPages, maxPages);

    for (let page = 1; page <= limit; page++) {
      try {
        // One page per call: the whole document at once would hold every
        // rendered bitmap in memory simultaneously.
        const shot = (await parser.getScreenshot({
          first: page,
          last: page,
          scale: RENDER_SCALE,
        } as never)) as { pages?: { data?: unknown; dataUrl?: string }[] };

        const rendered = shot.pages?.[0];
        if (!rendered) continue;

        const png = Buffer.isBuffer(rendered.data)
          ? rendered.data
          : typeof rendered.dataUrl === "string"
            ? Buffer.from(rendered.dataUrl.split(",")[1] ?? "", "base64")
            : null;
        if (!png || !png.length) continue;

        const out = await provider.extract({ buffer: png, mimeType: "image/png", fileName: `page-${page}.png` });
        if (out.rawText.trim()) {
          parts.push(`----- PAGE ${page} -----\n${out.rawText}`);
          pagesRead++;
        }
      } catch {
        // Skip unreadable pages; the rest of the document still contributes.
      }
    }
  } catch {
    // Info/render unavailable — fall through with whatever was collected.
  } finally {
    await parser.destroy().catch(() => {});
  }

  return { text: parts.join("\n\n"), pagesRead, totalPages };
}
