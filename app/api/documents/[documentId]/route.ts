import { NextRequest, NextResponse } from "next/server";
import { deleteDocument } from "../../../../services/documentService";

interface Params {
  params: Promise<{ documentId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { documentId } = await params;
  try {
    await deleteDocument(documentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete document";
    if (message === "Document not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
