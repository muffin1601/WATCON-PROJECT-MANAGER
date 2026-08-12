import { PDFDocument } from "pdf-lib";
import { DOCUMENTS_BUCKET, supabaseServer } from "../../lib/supabaseServer";
import { PDF_CHUNK_SIZE, PDF_CHUNK_OVERLAP, PDF_CHUNKING_THRESHOLD } from "./config";

/**
 * Page-range chunking for long PDFs.
 *
 * A single Claude call over a 40-page BOQ streams for several minutes —
 * mostly generating the item array, which no amount of input trimming makes
 * shorter. That is fine on a long-running server and fatal on a serverless
 * host with a per-invocation duration cap (Vercel Hobby: 60s), where the
 * function is killed mid-call and the job never lands in a terminal state.
 *
 * So a long document is sliced into page ranges, each read by its own
 * invocation and each comfortably inside the cap. The slices live in Supabase
 * Storage between invocations because the uploaded buffer does not survive the
 * request that carried it, and re-uploading a large PDF once per chunk would
 * push the cost onto the user's connection instead.
 */

/**
 * Pages per chunk.
 *
 * Chosen so the slowest part — generating the item rows for a dense BOQ page —
 * stays well inside a 60s invocation with room for a retry. Larger chunks mean
 * fewer boundaries to reconcile (see mergeChunkItems) but risk the timeout this
 * exists to avoid; the boundary handling is cheaper than the timeout.
 */
export const CHUNK_PAGE_SIZE = 8;

/**
 * Documents at or below this page count are read in one call, exactly as
 * before. Chunking a 3-page challan would add boundary risk and several extra
 * round trips to a document that was never near the cap.
 */
export const CHUNK_THRESHOLD_PAGES = 12;

export interface PdfChunk {
  index: number;
  chunkId: string;
  totalChunks: number;
  /** 1-based, inclusive — used to tell the model where it is in the document. */
  startPage: number;
  endPage: number;
  buffer: Buffer;
}

export function shouldChunk(pageCount: number): boolean {
  return pageCount > PDF_CHUNKING_THRESHOLD;
}

/** Page ranges a document of this length will be split into. */
export function planChunks(pageCount: number): { startPage: number; endPage: number }[] {
  const ranges: { startPage: number; endPage: number }[] = [];
  if (pageCount <= PDF_CHUNK_SIZE) {
    return [{ startPage: 1, endPage: pageCount }];
  }

  const overlap = Math.min(PDF_CHUNK_OVERLAP, PDF_CHUNK_SIZE - 1);
  let startPage = 1;

  while (startPage <= pageCount) {
    const endPage = Math.min(startPage + PDF_CHUNK_SIZE - 1, pageCount);
    ranges.push({ startPage, endPage });
    if (endPage === pageCount) break;
    startPage = endPage - overlap + 1;
  }

  return ranges;
}

/**
 * Slices a PDF into page-range documents.
 *
 * Each slice is a real, standalone PDF — `copyPages` carries the page's fonts
 * and resources across — so the extraction path treats it exactly like any
 * other uploaded document and needs no special case.
 */
export async function splitPdf(buffer: Buffer): Promise<PdfChunk[]> {
  // ignoreEncryption: an encrypted PDF is already rejected upstream by
  // assertPdfNotEncrypted; this stops pdf-lib throwing a second, worse-worded
  // error on files that merely carry permission flags.
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = source.getPageCount();
  const ranges = planChunks(pageCount);

  const chunks: PdfChunk[] = [];
  for (const [index, range] of ranges.entries()) {
    const slice = await PDFDocument.create();
    const indices = [];
    for (let p = range.startPage - 1; p <= range.endPage - 1; p++) indices.push(p);

    const copied = await slice.copyPages(source, indices);
    for (const page of copied) slice.addPage(page);

    chunks.push({
      index,
      chunkId: `${range.startPage}-${range.endPage}`,
      totalChunks: ranges.length,
      startPage: range.startPage,
      endPage: range.endPage,
      buffer: Buffer.from(await slice.save()),
    });
  }
  return chunks;
}

// ------------------------------------------------------------- slice storage

/**
 * Slices are namespaced by job id so cleanup is a single prefix delete and a
 * failed job can never leave slices that another job might pick up.
 */
function chunkPath(jobId: string, chunk: PdfChunk): string {
  return `extraction-chunks/${jobId}/${String(chunk.index).padStart(3, "0")}-${chunk.chunkId}.pdf`;
}

export async function uploadChunks(jobId: string, chunks: PdfChunk[]): Promise<string[]> {
  const supabase = supabaseServer();
  const paths: string[] = [];

  for (const chunk of chunks) {
    const path = chunkPath(jobId, chunk);
    const { error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, chunk.buffer, { contentType: "application/pdf", upsert: true });
    if (error) {
      throw new Error(`Could not stage page ${chunk.startPage}-${chunk.endPage} for reading: ${error.message}`);
    }
    paths.push(path);
  }
  return paths;
}

export async function downloadChunk(path: string): Promise<Buffer> {
  const supabase = supabaseServer();
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !data) {
    throw new Error(`Could not read the staged pages for this document: ${error?.message ?? "not found"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Best-effort cleanup. Never throws: a job that produced a correct result must
 * not be failed because its temporary slices could not be removed.
 */
export async function deleteChunks(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    await supabaseServer().storage.from(DOCUMENTS_BUCKET).remove(paths);
  } catch (err) {
    console.warn("[ai] could not remove staged extraction chunks:", err);
  }
}
