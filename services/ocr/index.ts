import { prisma } from "../../lib/prisma";
import { supabaseServer } from "../../lib/supabaseServer";
import type { OcrProvider } from "./provider";
import { tesseractProvider } from "./providers/tesseract";
import { azureProvider, googleVisionProvider, textractProvider } from "./providers/unimplemented";
import { extractPdfText } from "./pdfText";

const PROVIDERS: Record<string, OcrProvider> = {
  tesseract: tesseractProvider,
  azure: azureProvider,
  "google-vision": googleVisionProvider,
  "aws-textract": textractProvider,
};

export function getOcrProvider(): OcrProvider {
  const name = process.env.OCR_PROVIDER || "tesseract";
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown OCR_PROVIDER "${name}"`);
  return provider;
}

// Extracts raw, per-page text from an already-uploaded Document and stores
// it in DocumentText — purely for full-text search (services/searchService.ts),
// never interpreted into structured fields. Digital PDFs use their embedded
// text layer (no OCR needed); PNG/JPEG images run through the configured
// OCR provider. Records the attempt (status/timestamps) on the Document's
// OcrResult row regardless of outcome.
export async function extractDocumentText(documentId: string) {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw new Error("Document not found");

  const startedAt = new Date();
  await prisma.ocrResult.upsert({
    where: { documentId },
    create: { documentId, provider: "text-extraction", status: "PROCESSING", startedAt },
    update: { provider: "text-extraction", status: "PROCESSING", startedAt, errorMessage: null },
  });

  try {
    const supabase = supabaseServer();
    const { data, error } = await supabase.storage.from(document.bucket).download(document.storagePath);
    if (error || !data) throw new Error(error?.message || "Failed to download file from storage");
    const buffer = Buffer.from(await data.arrayBuffer());

    let pages: { pageNumber: number; text: string }[];
    if (document.mimeType === "application/pdf") {
      pages = await extractPdfText(buffer);
    } else if (document.mimeType === "image/png" || document.mimeType === "image/jpeg") {
      const provider = getOcrProvider();
      const output = await provider.extract({ buffer, mimeType: document.mimeType, fileName: document.fileName });
      pages = [{ pageNumber: 1, text: output.rawText }];
    } else {
      throw new Error(`Text extraction is not supported for ${document.mimeType} files.`);
    }

    await prisma.$transaction([
      prisma.documentText.deleteMany({ where: { documentId } }),
      prisma.documentText.createMany({
        data: pages
          .filter((p) => p.text.trim().length > 0)
          .map((p) => ({ documentId, pageNumber: p.pageNumber, rawText: p.text })),
      }),
      prisma.ocrResult.update({
        where: { documentId },
        data: { status: "SUCCEEDED", completedAt: new Date(), rawResponse: { pageCount: pages.length } },
      }),
    ]);

    return { pageCount: pages.length, pagesWithText: pages.filter((p) => p.text.trim().length > 0).length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Text extraction failed";
    await prisma.ocrResult.update({
      where: { documentId },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
    });
    throw err;
  }
}
