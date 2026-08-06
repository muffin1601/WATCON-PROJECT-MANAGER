import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../lib/prisma";
import { DOCUMENTS_BUCKET, supabaseServer } from "../lib/supabaseServer";
import { assertValidUpload, type DocumentKind } from "../modules/documents/schema";
import { assertPdfNotEncrypted } from "./ocr/pdfText";

export class DuplicateDocumentError extends Error {
  existingDocumentId: string;
  constructor(existingDocumentId: string) {
    super("A document with identical content already exists on this project");
    this.existingDocumentId = existingDocumentId;
  }
}

export interface UploadDocumentInput {
  kind: DocumentKind;
  file: { name: string; type: string; size: number; buffer: Buffer };
  projectId?: string;
  challanId?: string;
  paymentId?: string;
  amendmentId?: string;
  purchaseOrderId?: string;
  transportId?: string;
  projectOrderId?: string;
  // Part 18 (duplicate detection): if a document with the same content
  // checksum already exists on this project, uploadDocument() throws
  // DuplicateDocumentError instead of uploading — set true to upload anyway.
  allowDuplicate?: boolean;
  // Part 13 (version history): replaces an existing document with a new
  // version rather than creating an unrelated row. The new row becomes
  // versionNumber = previous + 1, chained to the same rootDocumentId — the
  // old version's storage object and DB row are left untouched (nothing is
  // ever overwritten in place).
  replaceDocumentId?: string;
}

// The client-supplied file name is untrusted input — it comes straight
// through multipart form data and can be anything the caller puts there
// (e.g. "../../other-project/secret.pdf"). Strip path separators and
// traversal sequences before it ever touches a storage path, keeping only
// characters safe for a Storage object key.
function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(-200) || "file";
}

// Storage path convention: <kind>/<projectId or "misc">/<uuid>-<sanitized filename>
export async function uploadDocument(input: UploadDocumentInput) {
  assertValidUpload(input.file);

  // Part 19: reject encrypted/password-protected/corrupted PDFs up front
  // with a clean error, instead of accepting them and failing on first use.
  if (input.file.type === "application/pdf") {
    await assertPdfNotEncrypted(input.file.buffer);
  }

  // Fail fast with a clean error instead of a raw Prisma FK-violation 500 if
  // the caller passed an id that doesn't correspond to a real row. The file
  // hasn't been uploaded yet at this point, so there's nothing to clean up.
  async function assertExists(label: string, id: string | undefined, exists: (id: string) => Promise<unknown>) {
    if (!id) return;
    try {
      await exists(id);
    } catch {
      throw new Error(`No such ${label} to attach this document to`);
    }
  }
  await assertExists("project", input.projectId, (id) => prisma.project.findUniqueOrThrow({ where: { id } }));
  await assertExists("challan", input.challanId, (id) => prisma.challan.findUniqueOrThrow({ where: { id } }));
  await assertExists("payment", input.paymentId, (id) => prisma.payment.findUniqueOrThrow({ where: { id } }));
  await assertExists("amendment", input.amendmentId, (id) => prisma.amendment.findUniqueOrThrow({ where: { id } }));
  await assertExists("purchase order", input.purchaseOrderId, (id) => prisma.purchaseOrder.findUniqueOrThrow({ where: { id } }));
  await assertExists("transport bill", input.transportId, (id) => prisma.transport.findUniqueOrThrow({ where: { id } }));
  await assertExists("order", input.projectOrderId, (id) => prisma.projectOrder.findUniqueOrThrow({ where: { id } }));

  const checksum = createHash("sha256").update(input.file.buffer).digest("hex");

  // Part 18: same-content duplicate detection, scoped to the project (the
  // same file legitimately attached to two different projects isn't a
  // mistake worth blocking).
  if (input.projectId && !input.allowDuplicate) {
    const existing = await prisma.document.findFirst({
      where: { projectId: input.projectId, checksum },
      select: { id: true },
    });
    if (existing) throw new DuplicateDocumentError(existing.id);
  }

  let rootDocumentId: string | null = null;
  let versionNumber = 1;
  if (input.replaceDocumentId) {
    const replacing = await prisma.document.findUnique({ where: { id: input.replaceDocumentId } });
    if (!replacing) throw new Error("Document to replace not found");
    rootDocumentId = replacing.rootDocumentId ?? replacing.id;
    const latest = await prisma.document.aggregate({
      where: { OR: [{ id: rootDocumentId }, { rootDocumentId }] },
      _max: { versionNumber: true },
    });
    versionNumber = (latest._max.versionNumber ?? 1) + 1;
  }

  const safeName = sanitizeFileName(input.file.name);
  const storagePath = `${input.kind.toLowerCase()}/${input.projectId ?? "misc"}/${randomUUID()}-${safeName}`;
  const supabase = supabaseServer();

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, input.file.buffer, { contentType: input.file.type, upsert: false });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  try {
    return await prisma.document.create({
      data: {
        kind: input.kind,
        projectId: input.projectId ?? null,
        challanId: input.challanId ?? null,
        paymentId: input.paymentId ?? null,
        amendmentId: input.amendmentId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        transportId: input.transportId ?? null,
        projectOrderId: input.projectOrderId ?? null,
        fileName: input.file.name,
        mimeType: input.file.type,
        sizeBytes: input.file.size,
        storagePath,
        bucket: DOCUMENTS_BUCKET,
        checksum,
        rootDocumentId,
        versionNumber,
      },
    });
  } catch (err) {
    // DB write failed after a successful storage upload — clean up the
    // orphaned object rather than leaking storage with no metadata row.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    throw err;
  }
}

export function getPublicUrl(storagePath: string): string {
  const supabase = supabaseServer();
  return supabase.storage.from(DOCUMENTS_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

export async function deleteDocument(documentId: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Document not found");

  const supabase = supabaseServer();
  const { error } = await supabase.storage.from(doc.bucket).remove([doc.storagePath]);
  if (error) throw new Error(`Failed to delete file from storage: ${error.message}`);

  return prisma.document.delete({ where: { id: documentId } });
}

// All versions of a document, oldest first, given any version's id.
export async function listDocumentVersions(documentId: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Document not found");
  const rootId = doc.rootDocumentId ?? doc.id;
  return prisma.document.findMany({
    where: { OR: [{ id: rootId }, { rootDocumentId: rootId }] },
    orderBy: { versionNumber: "asc" },
  });
}
