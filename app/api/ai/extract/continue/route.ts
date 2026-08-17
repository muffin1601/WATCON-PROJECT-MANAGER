import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { ExtractionJobStatus } from "@prisma/client";
import { prisma } from "../../../../../lib/prisma";
import { runNextOrderChunk } from "../../../../../services/ai/jobs";
import { requirePermission } from "../../../../../lib/auth";

/**
 * Reads the next page range of a chunked extraction.
 *
 * A long PDF is split into page ranges (services/ai/chunking.ts) because no
 * single invocation can read the whole document inside the host's function
 * duration cap. Each call here reads exactly ONE range and returns; the
 * browser calls it again for the next, driven by the poll response's
 * `chunksDone` / `totalChunks`.
 *
 * The browser drives this rather than the server chaining to itself: a
 * self-invoking chain has no backpressure, retries badly, and leaves no trace
 * when a link in it dies. A visible per-chunk request can be retried, and a
 * stalled one is obvious.
 */
export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let jobId: string;
  try {
    await requirePermission("salesorder", "create");
    const body = (await req.json()) as { jobId?: string };
    jobId = (body.jobId ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!jobId) return NextResponse.json({ error: "No job id was provided." }, { status: 400 });

  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, fileName: true, totalChunks: true, chunksDone: true },
  });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  // Already finished, or never chunked in the first place: nothing to drive.
  // Answering 200 rather than an error keeps a duplicate call from the client
  // (a double-render, a retry after a slow response) harmless.
  if (
    job.status === ExtractionJobStatus.SUCCEEDED ||
    job.status === ExtractionJobStatus.FAILED ||
    job.totalChunks === 0 ||
    job.chunksDone >= job.totalChunks
  ) {
    return NextResponse.json({ ok: true, done: true }, { status: 200 });
  }

  after(async () => {
    // Owns its error handling and always lands the job in a terminal state on
    // failure, so a dead chunk cannot leave the browser polling forever.
    await runNextOrderChunk(job.id, job.fileName);
  });

  return NextResponse.json({ ok: true, done: false }, { status: 202 });
}
