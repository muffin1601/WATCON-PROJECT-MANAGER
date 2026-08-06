import "./domPolyfill";
import { PDFParse, PasswordException, InvalidPDFException } from "pdf-parse";

export class EncryptedPdfError extends Error {}
export class CorruptPdfError extends Error {}

// Digital-PDF text extraction using the PDF's own embedded text layer — no
// OCR needed here (this is why the app can support PDFs at all despite
// Tesseract being image-only). Scanned/photographed PDFs with no text
// layer will return empty/near-empty pages; there is no OCR fallback for
// that yet (would need page rasterization — see KNOWN_LIMITATIONS.md).
export async function extractPdfText(buffer: Buffer): Promise<{ pageNumber: number; text: string }[]> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => ({ pageNumber: p.num, text: p.text }));
  } catch (err) {
    if (err instanceof PasswordException) {
      throw new EncryptedPdfError("This PDF is password-protected or encrypted — please remove the password before uploading.");
    }
    if (err instanceof InvalidPDFException) {
      throw new CorruptPdfError("This PDF file appears to be corrupted or invalid.");
    }
    throw err;
  } finally {
    await parser.destroy();
  }
}

// Lightweight validation used at upload time (Part 19: reject encrypted/
// corrupted PDFs gracefully instead of accepting them and failing later).
export async function assertPdfNotEncrypted(buffer: Buffer): Promise<void> {
  const parser = new PDFParse({ data: buffer });
  try {
    await parser.getInfo();
  } catch (err) {
    if (err instanceof PasswordException) {
      throw new EncryptedPdfError("This PDF is password-protected or encrypted — please remove the password before uploading.");
    }
    if (err instanceof InvalidPDFException) {
      throw new CorruptPdfError("This PDF file appears to be corrupted or invalid.");
    }
    throw err;
  } finally {
    await parser.destroy();
  }
}
