import { NextRequest, NextResponse } from "next/server";
import { extractDocumentText } from "../../../../../services/ocr";
import { requirePermission } from "../../../../../lib/auth";

interface Params {
  params: Promise<{ documentId: string }>;
}

// Extracts raw per-page text for search only — never interpreted into
// structured fields. See services/ocr/index.ts.
export async function POST(_req: NextRequest, { params }: Params) {
  const { documentId } = await params;
  try {
    await requirePermission("documents", "amend");
    const result = await extractDocumentText(documentId);
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Text extraction failed";
    if (message === "Document not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
