import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "../../../../../lib/prisma";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

type Ctx = { params: Promise<{ quotationId: string }> };

const costingSchema = z.object({
  items: z.record(z.string(), z.object({ rate: z.union([z.number(), z.literal("")]).optional() })).default({}),
  installPct: z.union([z.number(), z.literal("")]).optional(),
  extras: z
    .array(z.object({ name: z.string().trim().max(300).default(""), amount: z.coerce.number().default(0) }))
    .max(200)
    .default([]),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    // The costing sheet is internal margin data, gated on the costing module
    // rather than on quotation rights — a salesperson may quote without being
    // allowed to see what the company pays.
    await requirePermission("costing", "amend");
    const { quotationId } = await params;
    const costing = costingSchema.parse(await req.json());
    await prisma.quotation.update({ where: { id: quotationId }, data: { costing } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Quotation not found", "Failed to save costing");
  }
}
