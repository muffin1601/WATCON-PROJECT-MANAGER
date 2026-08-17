import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { ExtractionJobKind } from "@prisma/client";
import {
  createExtractionJob,
  runOrderExtraction,
  runChallanExtraction,
  runClassification,
} from "../../../../services/ai/jobs";
import { isSupportedForAi } from "../../../../services/ai/ingest";
import { MAX_AI_FILE_BYTES } from "../../../../services/ai/config";
import { formatUploadLimit } from "../../../../modules/documents/uploadLimits";
import { requirePermission } from "../../../../lib/auth";

/**
 * Starts an AI extraction and returns immediately with a job id.
 *
 * The heavy work runs in `after()`, which Next runs once the response has
 * been flushed but while the invocation is still alive. That gives real
 * background processing without a queue service, and the client never holds a
 * connection open for a multi-minute extraction.
 *
 * `maxDuration` must comfortably exceed the slowest expected extraction: a
 * 50-page scanned BOQ read visually is the worst case. On Vercel this needs a
 * plan that permits it (Hobby caps at 60s); on a long-running Node host it is
 * simply ignored. See AI_DOCUMENT_ENGINE.md.
 */
export const maxDuration = 300;
export const runtime = "nodejs";

const KINDS: Record<string, ExtractionJobKind> = {
  order: ExtractionJobKind.ORDER,
  challan: ExtractionJobKind.CHALLAN,
  classify: ExtractionJobKind.CLASSIFY,
};

function startupErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/extraction_jobs|ExtractionJob|relation .*does not exist|table .*does not exist|does not exist/i.test(message)) {
    return "AI extraction is not ready in production because the database migration for extraction jobs has not been applied. Run `npx prisma migrate deploy` against the production database, then try again.";
  }

  if (/DATABASE_URL|Can't reach database server|Timed out fetching a new connection|PrismaClientInitializationError/i.test(message)) {
    return "Could not connect to the production database to start the document reader. Check DATABASE_URL and the Supabase connection, then try again.";
  }

  return "Could not start reading this document. Please try again, or enter the items manually.";
}

export async function POST(req: NextRequest) {
  // No key gate here: extraction runs a provider fallback chain
  // (Claude -> OpenAI -> Gemini -> local parser), so a missing AI key
  // degrades to the local engine instead of failing the upload.
  let form: FormData;
  try {
    await requirePermission("salesorder", "create");
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was provided." }, { status: 400 });
  }

  const kind = KINDS[String(form.get("kind") ?? "order")];
  if (!kind) {
    return NextResponse.json({ error: "Unknown extraction kind." }, { status: 400 });
  }

  if (!isSupportedForAi(file.type, file.name)) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a PDF, scanned PDF, Excel (.xlsx/.xls), CSV, JPG, JPEG or PNG." },
      { status: 400 }
    );
  }
  if (file.size > MAX_AI_FILE_BYTES) {
    return NextResponse.json(
      { error: `File must be below ${formatUploadLimit(MAX_AI_FILE_BYTES)}.` },
      { status: 400 }
    );
  }

  const projectId = (form.get("projectId") as string | null)?.trim() || null;
  const documentId = (form.get("documentId") as string | null)?.trim() || null;

  // Read the file into memory before responding: the request body is not
  // available once `after()` runs.
  const buffer = Buffer.from(await file.arrayBuffer());

  let job: Awaited<ReturnType<typeof createExtractionJob>>;
  try {
    job = await createExtractionJob({
      kind,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      projectId,
      documentId,
    });
  } catch (err) {
    console.error("[ai] could not create extraction job", err);
    return NextResponse.json({ error: startupErrorMessage(err) }, { status: 500 });
  }

  after(async () => {
    // Each runner owns its own error handling and always lands the job in a
    // terminal state, so nothing here can leave a job polling forever.
    if (kind === ExtractionJobKind.ORDER) {
      await runOrderExtraction(job.id, buffer, file.type, file.name);
    } else if (kind === ExtractionJobKind.CHALLAN) {
      await runChallanExtraction(job.id, buffer, file.type, file.name, projectId);
    } else {
      await runClassification(job.id, buffer, file.type, file.name);
    }
  });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
