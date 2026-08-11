import { ExtractionStage, ExtractionJobStatus, ExtractionJobKind, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ingestDocument, type IngestedDocument } from "./ingest";
import {
  extractOrderWithFallback,
  extractOrderChunkWithFallback,
  extractChallanWithFallback,
  classifyWithFallback,
} from "./providers";
import { reconcileOrderTotals } from "./extract";
import { isAiConfigured } from "./config";
import {
  shouldChunk,
  splitPdf,
  planChunks,
  uploadChunks,
  downloadChunk,
  deleteChunks,
} from "./chunking";
import { mergeChunkResults, type ChunkResult } from "./mergeChunks";
import type { AiOrderResult } from "../../modules/ai/schema";
import { validateOrder, validateChallan } from "./validate";
import { toExtractedOrder, toMappedChallan } from "./mapper";
import { matchProject, matchChallanLines } from "./matching";
import { AiExtractionError } from "./client";
import { EncryptedPdfError, CorruptPdfError } from "../ocr/pdfText";

/**
 * Job engine.
 *
 * Extraction is slow (a 50-page BOQ is minutes, not seconds), so it does not
 * happen inside the request that starts it. The request creates a job row and
 * returns its id; work proceeds in the background and writes progress to that
 * row; the browser polls it.
 *
 * The row-as-progress-bar design is what makes the UI resilient: closing the
 * tab, navigating away or refreshing mid-extraction loses nothing, because no
 * state lives in the page. It also sidesteps serverless response timeouts,
 * which a streaming progress response would hit on a large document.
 */

/**
 * How long a chunked job may go without completing a page range before it is
 * treated as dead. Comfortably above one chunk's expected duration, so a merely
 * slow range is never killed, and far below the single-call window so a wedged
 * job surfaces as an error while the user is still watching.
 */
const CHUNK_HEARTBEAT_TIMEOUT_MINUTES = 5;

/** Stage -> percentage. Monotonic, so the bar can never move backwards. */
const STAGE_PROGRESS: Record<ExtractionStage, number> = {
  UPLOADING: 5,
  READING: 15,
  OCR: 30,
  EXTRACTING: 45,
  VALIDATING: 85,
  GENERATING: 95,
  COMPLETED: 100,
};

/** Human-readable labels; the UI shows these verbatim. */
export const STAGE_LABELS: Record<ExtractionStage, string> = {
  UPLOADING: "Uploading",
  READING: "Reading document",
  OCR: "Reading scanned pages",
  EXTRACTING: "Extracting data",
  VALIDATING: "Validating",
  GENERATING: "Generating sales order",
  COMPLETED: "Completed",
};

export interface CreateJobArgs {
  kind: ExtractionJobKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  projectId?: string | null;
  documentId?: string | null;
}

export async function createExtractionJob(args: CreateJobArgs) {
  return prisma.extractionJob.create({
    data: {
      kind: args.kind,
      status: ExtractionJobStatus.QUEUED,
      stage: ExtractionStage.UPLOADING,
      progressPct: STAGE_PROGRESS.UPLOADING,
      fileName: args.fileName,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      projectId: args.projectId ?? null,
      documentId: args.documentId ?? null,
    },
  });
}

async function setStage(jobId: string, stage: ExtractionStage, extra: Prisma.ExtractionJobUpdateInput = {}) {
  await prisma.extractionJob.update({
    where: { id: jobId },
    data: { stage, progressPct: STAGE_PROGRESS[stage], status: ExtractionJobStatus.RUNNING, ...extra },
  });
}

async function failJob(jobId: string, message: string) {
  await prisma.extractionJob.update({
    where: { id: jobId },
    data: {
      status: ExtractionJobStatus.FAILED,
      errorMessage: message,
      completedAt: new Date(),
    },
  });
}

/**
 * Turns any thrown value into a sentence the person who uploaded the file can
 * act on. Unexpected errors are logged server-side and reported generically —
 * a raw stack trace in the UI helps nobody and can leak internals.
 */
function toUserMessage(err: unknown): string {
  if (err instanceof AiExtractionError) return err.message;
  if (err instanceof EncryptedPdfError || err instanceof CorruptPdfError) return err.message;
  console.error("[ai] extraction job failed", err);
  return "Something went wrong while reading this document. Please try again, or enter the details manually.";
}

/** Shared front half of every pipeline: read the file and report the stages. */
async function ingestForJob(
  jobId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<IngestedDocument> {
  await setStage(jobId, ExtractionStage.READING, { startedAt: new Date(), attempts: { increment: 1 } });

  const ingested = await ingestDocument(buffer, mimeType, fileName);

  await prisma.extractionJob.update({
    where: { id: jobId },
    data: { pageCount: ingested.pageCount, sourceKind: ingested.sourceKind },
  });

  // Only surface the OCR stage when pixels genuinely have to be read — on a
  // digital PDF it would be a lie, and a stage that never applies makes the
  // progress bar less trustworthy, not more informative.
  if (ingested.requiresVisualReading) {
    await setStage(jobId, ExtractionStage.OCR);
  }

  return ingested;
}

/**
 * BOQ / Purchase Order -> a reviewable Sales Order draft.
 *
 * `projectId` is optional: the New Project flow runs this before any project
 * exists, exactly as the stateless /api/parse-order endpoint did.
 */
export async function runOrderExtraction(
  jobId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<void> {
  try {
    const ingested = await ingestForJob(jobId, buffer, mimeType, fileName);

    // A long PDF cannot be read in one serverless invocation (see
    // services/ai/chunking.ts). Stage its pages and read the first range; the
    // rest are driven one invocation at a time by /api/ai/extract/continue.
    //
    // Only on the AI path: the local engines read the whole buffer at once and
    // are fast enough not to need this, and slicing would only rob them of the
    // table headers they depend on.
    if (mimeType === "application/pdf" && isAiConfigured() && shouldChunk(ingested.pageCount)) {
      await startChunkedOrderExtraction(jobId, buffer, fileName, ingested.pageCount);
      return;
    }

    await setStage(jobId, ExtractionStage.EXTRACTING);
    const { result, usage } = await extractOrderWithFallback(ingested, buffer, mimeType, fileName);

    await finaliseOrderJob(jobId, result, usage.model, usage as unknown as Prisma.InputJsonValue);
  } catch (err) {
    await failJob(jobId, toUserMessage(err));
  }
}

/**
 * Completes an order job from a finished (whole-document) result.
 *
 * Shared by the single-call path and the chunked path so that validation,
 * mapping and the challan misroute check cannot drift apart between them —
 * the chunked path differs only in how the result was assembled.
 */
async function finaliseOrderJob(
  jobId: string,
  result: AiOrderResult,
  modelUsed: string,
  usage: Prisma.InputJsonValue
): Promise<void> {
  // The document may not be what the upload context assumed. Rather than
  // extract a challan into a Sales Order draft, stop and say so — the user
  // can re-upload it in the right place.
  if (result.documentType === "CHALLAN") {
    await failJob(
      jobId,
      "This looks like a delivery challan, not a purchase order or BOQ. Upload it from the project's Challans tab instead."
    );
    return;
  }

  await setStage(jobId, ExtractionStage.VALIDATING, {
    detectedType: result.documentType,
    modelUsed,
    usage,
  });
  const report = validateOrder(result);

  await setStage(jobId, ExtractionStage.GENERATING);
  const mapped = toExtractedOrder(result, report);

  await prisma.extractionJob.update({
    where: { id: jobId },
    data: {
      status: ExtractionJobStatus.SUCCEEDED,
      stage: ExtractionStage.COMPLETED,
      progressPct: STAGE_PROGRESS.COMPLETED,
      result: mapped as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

// ------------------------------------------------------------ chunked orders

/**
 * Progress while chunks are being read, mapped into the span between the
 * EXTRACTING and VALIDATING stages so the bar stays monotonic.
 */
function chunkProgress(done: number, total: number): number {
  if (total <= 0) return STAGE_PROGRESS.EXTRACTING;
  const span = STAGE_PROGRESS.VALIDATING - STAGE_PROGRESS.EXTRACTING;
  return STAGE_PROGRESS.EXTRACTING + Math.round((done / total) * span);
}

/** Slices the document, stages the slices, and reads the first range. */
async function startChunkedOrderExtraction(
  jobId: string,
  buffer: Buffer,
  fileName: string,
  pageCount: number
): Promise<void> {
  await setStage(jobId, ExtractionStage.EXTRACTING);

  const chunks = await splitPdf(buffer);
  const paths = await uploadChunks(jobId, chunks);

  await prisma.extractionJob.update({
    where: { id: jobId },
    data: {
      totalChunks: chunks.length,
      chunksDone: 0,
      chunkPaths: paths as unknown as Prisma.InputJsonValue,
      chunkResults: [] as unknown as Prisma.InputJsonValue,
      pageCount,
      heartbeatAt: new Date(),
    },
  });

  await runNextOrderChunk(jobId, fileName);
}

/**
 * Reads exactly one pending page range, then returns.
 *
 * One chunk per invocation is the whole point: each call has to fit inside the
 * host's function duration cap, so this must never loop over the remaining
 * chunks. The caller (the continue endpoint) is re-entered by the browser for
 * each subsequent range.
 */
export async function runNextOrderChunk(jobId: string, fileName: string): Promise<void> {
  const job = await prisma.extractionJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.status === ExtractionJobStatus.SUCCEEDED || job.status === ExtractionJobStatus.FAILED) return;

  const paths = (job.chunkPaths as string[] | null) ?? [];
  const done = (job.chunkResults as unknown as ChunkResult[] | null) ?? [];

  // Index by chunk, not by count, so a retried or out-of-order call re-reads
  // the range that is actually missing rather than skipping it.
  const completed = new Set(done.map((c) => c.index));
  const nextIndex = paths.findIndex((_, i) => !completed.has(i));
  if (nextIndex < 0) {
    await finishChunkedOrder(jobId, done, paths, job.modelUsed ?? "");
    return;
  }

  try {
    const slice = await downloadChunk(paths[nextIndex]!);
    const ranges = planChunks(job.pageCount);
    const range = ranges[nextIndex]!;

    const ingested = await ingestDocument(slice, "application/pdf", fileName);
    const { result, usage } = await extractOrderChunkWithFallback(
      ingested,
      { startPage: range.startPage, endPage: range.endPage, totalPages: job.pageCount },
      fileName
    );

    const appended: ChunkResult[] = [
      ...done,
      { index: nextIndex, startPage: range.startPage, endPage: range.endPage, result },
    ];
    const chunksDone = appended.length;

    await prisma.extractionJob.update({
      where: { id: jobId },
      data: {
        status: ExtractionJobStatus.RUNNING,
        stage: ExtractionStage.EXTRACTING,
        progressPct: chunkProgress(chunksDone, paths.length),
        chunksDone,
        chunkResults: appended as unknown as Prisma.InputJsonValue,
        modelUsed: usage.model,
        heartbeatAt: new Date(),
      },
    });

    if (chunksDone === paths.length) {
      await finishChunkedOrder(jobId, appended, paths, usage.model);
    }
  } catch (err) {
    await deleteChunks(paths);
    await failJob(jobId, toUserMessage(err));
  }
}

/** Merges every chunk into one document and runs the normal finalisation. */
async function finishChunkedOrder(
  jobId: string,
  chunks: ChunkResult[],
  paths: string[],
  modelUsed: string
): Promise<void> {
  const merged = mergeChunkResults(chunks);

  // Reconcile once, against the whole document. Doing this per chunk would
  // compare a page range's rows to the contract value and flag every chunk.
  const reconciled = reconcileOrderTotals(merged);

  await finaliseOrderJob(jobId, reconciled, modelUsed, {
    chunks: chunks.length,
    model: modelUsed,
  } as unknown as Prisma.InputJsonValue);

  // Only after the result is safely written: a failed cleanup must not cost
  // the user an extraction that succeeded.
  await deleteChunks(paths);
}

/**
 * Delivery challan -> matched quantities against an existing project.
 *
 * When the caller already knows the project (the upload came from that
 * project's Challans tab) the project match is skipped; otherwise the
 * document's own references are used to propose one.
 */
export async function runChallanExtraction(
  jobId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  knownProjectId?: string | null
): Promise<void> {
  try {
    const ingested = await ingestForJob(jobId, buffer, mimeType, fileName);

    await setStage(jobId, ExtractionStage.EXTRACTING);
    const { result, usage } = await extractChallanWithFallback(ingested, buffer, mimeType, fileName);

    await setStage(jobId, ExtractionStage.VALIDATING, {
      detectedType: result.documentType,
      modelUsed: usage.model,
      usage: usage as unknown as Prisma.InputJsonValue,
    });
    const report = validateChallan(result);
    const mapped = toMappedChallan(result, report);

    await setStage(jobId, ExtractionStage.GENERATING);

    const projectCandidates = knownProjectId
      ? []
      : await matchProject({
          poNumber: mapped.poNumber,
          projectName: mapped.projectName,
          clientName: mapped.clientName,
          siteAddress: mapped.siteAddress,
        });

    const resolvedProjectId =
      knownProjectId ??
      (projectCandidates.length && projectCandidates[0]!.confident ? projectCandidates[0]!.value.id : null);

    const lineMatches = resolvedProjectId
      ? await matchChallanLines(resolvedProjectId, mapped.items)
      : [];

    // A duplicate challan number on the same project is a hard stop — the
    // schema enforces @@unique([projectId, no]), so saving would fail anyway,
    // and silently renumbering someone's challan would be worse.
    let duplicateOf: string | null = null;
    if (resolvedProjectId && mapped.no) {
      const existing = await prisma.challan.findFirst({
        where: { projectId: resolvedProjectId, no: mapped.no },
        select: { id: true },
      });
      duplicateOf = existing?.id ?? null;
    }

    await prisma.extractionJob.update({
      where: { id: jobId },
      data: {
        status: ExtractionJobStatus.SUCCEEDED,
        stage: ExtractionStage.COMPLETED,
        progressPct: STAGE_PROGRESS.COMPLETED,
        projectId: resolvedProjectId,
        result: {
          ...mapped,
          projectCandidates,
          resolvedProjectId,
          lineMatches,
          duplicateOf,
        } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    await failJob(jobId, toUserMessage(err));
  }
}

/** Document-type detection only, for uploads with no implied type. */
export async function runClassification(
  jobId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<void> {
  try {
    const ingested = await ingestForJob(jobId, buffer, mimeType, fileName);
    await setStage(jobId, ExtractionStage.EXTRACTING);
    const { result, usage } = await classifyWithFallback(ingested, fileName);

    await prisma.extractionJob.update({
      where: { id: jobId },
      data: {
        status: ExtractionJobStatus.SUCCEEDED,
        stage: ExtractionStage.COMPLETED,
        progressPct: STAGE_PROGRESS.COMPLETED,
        detectedType: result.documentType,
        modelUsed: usage.model,
        usage: usage as unknown as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    await failJob(jobId, toUserMessage(err));
  }
}

export interface JobView {
  id: string;
  kind: ExtractionJobKind;
  status: ExtractionJobStatus;
  stage: ExtractionStage;
  stageLabel: string;
  progressPct: number;
  fileName: string;
  pageCount: number;
  detectedType: string | null;
  errorMessage: string | null;
  result: unknown;
  /** 0 on the single-call path; the browser reads these to drive each range. */
  totalChunks: number;
  chunksDone: number;
}

export async function getJobView(jobId: string): Promise<JobView | null> {
  const job = await prisma.extractionJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    stage: job.stage,
    stageLabel: STAGE_LABELS[job.stage],
    progressPct: job.progressPct,
    fileName: job.fileName,
    pageCount: job.pageCount,
    detectedType: job.detectedType,
    errorMessage: job.errorMessage,
    result: job.result ?? null,
    // Chunked reads need the browser to drive the next range; these tell it
    // whether there is one and how far along the document is. Both are 0 on
    // the single-call path, which the client reads as "nothing to drive".
    totalChunks: job.totalChunks,
    chunksDone: job.chunksDone,
  };
}

/**
 * Marks jobs abandoned mid-flight as failed.
 *
 * A serverless instance can be frozen or recycled while a job is RUNNING, and
 * that job would otherwise poll forever at 45%. Called opportunistically when
 * a job is polled, so it needs no scheduler of its own.
 */
export async function reapStaleJobs(olderThanMinutes = 20): Promise<number> {
  const now = Date.now();
  const cutoff = new Date(now - olderThanMinutes * 60_000);
  // A chunked read reports in after every page range, so silence means the
  // invocation died rather than that the document is long. Waiting the full
  // twenty minutes to say so leaves the user watching a progress bar that is
  // never going to move.
  const heartbeatCutoff = new Date(now - CHUNK_HEARTBEAT_TIMEOUT_MINUTES * 60_000);

  const { count } = await prisma.extractionJob.updateMany({
    where: {
      status: { in: [ExtractionJobStatus.QUEUED, ExtractionJobStatus.RUNNING] },
      OR: [
        // Single-call reads have no heartbeat to judge them by, so they keep
        // the original generous window.
        { totalChunks: 0, createdAt: { lt: cutoff } },
        { totalChunks: { gt: 0 }, heartbeatAt: { lt: heartbeatCutoff } },
        // Chunked but never reached its first heartbeat: the invocation died
        // during the split or the first range.
        { totalChunks: { gt: 0 }, heartbeatAt: null, createdAt: { lt: heartbeatCutoff } },
      ],
    },
    data: {
      status: ExtractionJobStatus.FAILED,
      errorMessage:
        "Reading this document stopped partway through. Please try again — if it keeps happening, upload the BOQ as Excel/CSV, which is read directly and does not time out.",
      completedAt: new Date(),
    },
  });
  return count;
}
