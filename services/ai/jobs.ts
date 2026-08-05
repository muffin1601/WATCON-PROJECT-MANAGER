import { ExtractionStage, ExtractionJobStatus, ExtractionJobKind, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ingestDocument, type IngestedDocument } from "./ingest";
import { extractOrderDocument, extractChallanDocument, classifyDocument } from "./extract";
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

    await setStage(jobId, ExtractionStage.EXTRACTING);
    const { result, usage } = await extractOrderDocument(ingested, "PURCHASE_ORDER");

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
      modelUsed: usage.model,
      usage: usage as unknown as Prisma.InputJsonValue,
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
  } catch (err) {
    await failJob(jobId, toUserMessage(err));
  }
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
    const { result, usage } = await extractChallanDocument(ingested);

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
    const { result, usage } = await classifyDocument(ingested);

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
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const { count } = await prisma.extractionJob.updateMany({
    where: {
      status: { in: [ExtractionJobStatus.QUEUED, ExtractionJobStatus.RUNNING] },
      createdAt: { lt: cutoff },
    },
    data: {
      status: ExtractionJobStatus.FAILED,
      errorMessage: "Reading this document timed out. Please try again with a smaller file.",
      completedAt: new Date(),
    },
  });
  return count;
}
