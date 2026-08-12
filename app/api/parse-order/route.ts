import { NextRequest, NextResponse } from "next/server";
import { parseOrderFromBuffer } from "../../../services/import/orderParser";
import { EncryptedPdfError, CorruptPdfError } from "../../../services/ocr/pdfText";
import { MAX_FILE_SIZE_BYTES } from "../../../modules/documents/schema";
import { formatUploadLimit } from "../../../modules/documents/uploadLimits";

// Stateless auto-read used by the New Project form: takes the attached
// PO/BOQ file, returns best-effort extracted fields + items WITHOUT
// persisting anything (there is no project yet at form time). The form
// fills itself from the response; the user reviews/edits before saving.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: `File must be below ${formatUploadLimit(MAX_FILE_SIZE_BYTES)}.` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // The file name matters for spreadsheets: browsers frequently send .csv
    // and .xlsx as application/octet-stream, so the extension is what
    // identifies them.
    const extracted = await parseOrderFromBuffer(buffer, file.type, file.name);
    return NextResponse.json({ extracted });
  } catch (err) {
    if (err instanceof EncryptedPdfError || err instanceof CorruptPdfError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Failed to read the document";
    if (message.startsWith("Auto-read supports")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
