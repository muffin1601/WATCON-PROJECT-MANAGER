import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../../../lib/prisma";
import { DOCUMENTS_BUCKET, supabaseServer } from "../../../../../lib/supabaseServer";
import { setCatalogImage } from "../../../../../services/catalogService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

type Ctx = { params: Promise<{ itemId: string }> };

// Product photos live in the same Supabase bucket as documents, under an
// items/ prefix.
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

// Magic-byte signatures. The declared MIME type is attacker-controlled, so the
// file's actual header is checked before anything is stored.
function sniff(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP")
    return "image/webp";
  return null;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("items", "amend");
    const { itemId } = await params;

    const item = await prisma.catalogItem.findUnique({ where: { id: itemId }, select: { id: true, imagePath: true } });
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No image was uploaded" }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image is larger than 5 MB — choose a smaller picture." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const actual = sniff(buffer);
    if (!actual || !ALLOWED.includes(actual)) {
      return NextResponse.json({ error: "Only JPG, PNG or WebP images are accepted." }, { status: 415 });
    }

    const ext = actual === "image/png" ? "png" : actual === "image/webp" ? "webp" : "jpg";
    const path = `items/${itemId}/${randomUUID()}.${ext}`;

    const supabase = supabaseServer();
    const { error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, buffer, { contentType: actual, upsert: false });
    if (error) return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 502 });

    await setCatalogImage(itemId, { path, mime: actual });

    // Remove the previous picture only after the new one is safely stored.
    if (item.imagePath) {
      await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove([item.imagePath])
        .catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Item not found", "Failed to upload the image");
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("items", "amend");
    const { itemId } = await params;
    const item = await prisma.catalogItem.findUnique({ where: { id: itemId }, select: { imagePath: true } });
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

    await setCatalogImage(itemId, null);
    if (item.imagePath) {
      await supabaseServer()
        .storage.from(DOCUMENTS_BUCKET)
        .remove([item.imagePath])
        .catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Item not found", "Failed to remove the image");
  }
}
