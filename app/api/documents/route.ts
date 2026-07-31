import { NextRequest, NextResponse } from "next/server";
import { DuplicateDocumentError, uploadDocument } from "../../../services/documentService";
import { EncryptedPdfError, CorruptPdfError } from "../../../services/ocr/pdfText";
import { DOCUMENT_KINDS, type DocumentKind } from "../../../modules/documents/schema";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const kind = form.get("kind");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (typeof kind !== "string" || !DOCUMENT_KINDS.includes(kind as DocumentKind)) {
      return NextResponse.json({ error: "Invalid document kind" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const document = await uploadDocument({
      kind: kind as DocumentKind,
      file: { name: file.name, type: file.type, size: file.size, buffer },
      projectId: strOrUndef(form.get("projectId")),
      challanId: strOrUndef(form.get("challanId")),
      paymentId: strOrUndef(form.get("paymentId")),
      amendmentId: strOrUndef(form.get("amendmentId")),
      purchaseOrderId: strOrUndef(form.get("purchaseOrderId")),
      allowDuplicate: form.get("allowDuplicate") === "true",
      replaceDocumentId: strOrUndef(form.get("replaceDocumentId")),
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateDocumentError) {
      return NextResponse.json({ error: err.message, existingDocumentId: err.existingDocumentId }, { status: 409 });
    }
    if (err instanceof EncryptedPdfError || err instanceof CorruptPdfError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    const status = message.startsWith("No such") ? 404 : message.startsWith("Unsupported") || message.includes("25 MB") ? 400 : 500;
    if (status === 500) console.error(err);
    return NextResponse.json({ error: message }, { status });
  }
}

function strOrUndef(v: FormDataEntryValue | null): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}
