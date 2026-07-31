export interface OcrInput {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

export interface OcrOutput {
  rawText: string;
}

// Provider abstraction — swap implementations via OCR_PROVIDER without
// touching any calling code. Only `tesseract` is implemented (free, works
// without external credentials); azure/google-vision/textract are stubs so
// the interface and factory shape are proven out ahead of a real key being
// available.
//
// Deliberately returns raw text only — nothing in this app interprets OCR
// output into structured fields (no vendor/PO-number/item guessing). Text
// is stored per-page for search only; see services/ocr/index.ts and
// prisma/schema.prisma's DocumentText model.
export interface OcrProvider {
  readonly name: string;
  extract(input: OcrInput): Promise<OcrOutput>;
}
