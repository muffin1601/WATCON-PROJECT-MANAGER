import { createWorker } from "tesseract.js";
import type { OcrInput, OcrOutput, OcrProvider } from "../provider";

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

// Free, no external credentials, runs entirely server-side via WASM.
// Deliberately scoped to image input only — PDF rasterization would need a
// native canvas dependency (node-canvas) that isn't safe to assume works in
// every deployment target (e.g. Vercel serverless) without verification.
// Digital PDF text extraction is handled separately (services/ocr/pdfText.ts,
// no OCR needed there); scanned/photographed PDFs remain a documented gap —
// see KNOWN_LIMITATIONS.md.
export const tesseractProvider: OcrProvider = {
  name: "tesseract",
  async extract(input: OcrInput): Promise<OcrOutput> {
    if (!IMAGE_MIME_TYPES.has(input.mimeType)) {
      throw new Error(
        "The Tesseract OCR provider only supports PNG/JPEG images. For scanned PDFs, convert pages to images first or configure a paid vision provider."
      );
    }
    const worker = await createWorker("eng");
    try {
      const {
        data: { text },
      } = await worker.recognize(input.buffer);
      return { rawText: text };
    } finally {
      await worker.terminate();
    }
  },
};
