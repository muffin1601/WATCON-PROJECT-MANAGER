import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "../../../../../lib/prisma";
import { rfqReplyFileSchema, rfqResponseInputSchema } from "../../../../../modules/purchase/schema";
import { deleteRfqResponse, RfqValidationError, saveRfqResponse } from "../../../../../services/rfqService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

type Ctx = { params: Promise<{ rfqId: string }> };

const importSchema = z.object({ action: z.literal("import"), file: rfqReplyFileSchema });

/**
 * Stores one supplier's reply — either typed in by hand (manualReplyModal) or
 * imported from the file their reply form produced (importRfqReplies).
 *
 * The import path validates that the file belongs to THIS inquiry and resolves
 * the supplier by id, falling back to an exact name match the way the prototype
 * does, so a file whose vendorId came from another deployment still lands on
 * the right supplier instead of being silently dropped.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("purchase", "create");
    const { rfqId } = await params;
    const body = await req.json();

    if (body?.action === "import") {
      const { file } = importSchema.parse(body);

      const rfq = await prisma.rfq.findUnique({
        where: { id: rfqId },
        select: { id: true, no: true, lines: { select: { id: true } } },
      });
      if (!rfq) return NextResponse.json({ error: "Rate inquiry not found" }, { status: 404 });

      // Wrong-inquiry guard: the file must name this inquiry by id or number.
      const belongs = file.rfqId === rfq.id || (file.rfqNo && file.rfqNo === rfq.no);
      if (!belongs) {
        return NextResponse.json(
          { error: `This reply is for ${file.rfqNo || "another inquiry"}, not ${rfq.no}.` },
          { status: 422 }
        );
      }

      let vendorId: string | null = null;
      if (file.vendorId) {
        const byId = await prisma.vendor.findUnique({ where: { id: file.vendorId }, select: { id: true } });
        vendorId = byId?.id ?? null;
      }
      if (!vendorId && file.vendor) {
        const byName = await prisma.vendor.findFirst({
          where: { name: { equals: file.vendor.trim(), mode: "insensitive" } },
          select: { id: true },
        });
        vendorId = byName?.id ?? null;
      }
      if (!vendorId) {
        return NextResponse.json({ error: "The reply names a supplier that does not exist here." }, { status: 422 });
      }

      const validLineIds = new Set(rfq.lines.map((l) => l.id));
      const items = file.items
        .filter((i) => validLineIds.has(i.id))
        .map((i) => ({
          lineId: i.id,
          rate: i.rate === null || i.rate === undefined || i.rate === "" ? null : Number(i.rate),
          gst: Number(i.gst ?? 0) || 0,
          remark: i.remark ?? "",
        }));

      await saveRfqResponse(rfqId, {
        vendorId,
        quotedBy: file.quotedBy ?? "",
        contact: file.contact ?? "",
        ref: file.ref ?? "",
        validity: file.validity === undefined ? null : Number(file.validity) || null,
        transport: Number(file.transport ?? 0) || 0,
        transportGst: Number(file.transportGst ?? 0) || 0,
        transportNote: file.transportNote ?? "",
        delivery: file.delivery ?? "",
        payment: file.payment ?? "",
        remarks: file.remarks ?? "",
        manual: false,
        filledAt: file.filledAt ?? "",
        items,
      });

      return NextResponse.json({ ok: true, vendorId, matched: items.filter((i) => i.rate !== null).length });
    }

    // Manual entry.
    const input = rfqResponseInputSchema.parse(body);
    await saveRfqResponse(rfqId, input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "The reply file is not in the expected format." }, { status: 400 });
    }
    if (err instanceof RfqValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Rate inquiry not found", "Failed to save the supplier reply");
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("purchase", "delete");
    const { rfqId } = await params;
    const vendorId = req.nextUrl.searchParams.get("vendorId");
    if (!vendorId) return NextResponse.json({ error: "vendorId is required" }, { status: 400 });
    await deleteRfqResponse(rfqId, vendorId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Rate inquiry not found", "Failed to remove the supplier reply");
  }
}
