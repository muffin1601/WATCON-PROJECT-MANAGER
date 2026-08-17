import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "../../../../../lib/prisma";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

type Ctx = { params: Promise<{ id: string }> };

// Only per-project OVERRIDES are stored; the automatic cost rate is always
// derived from the item sheet at read time.
const costingSchema = z.object({
  items: z
    .record(
      z.string(),
      z.object({
        rate: z.union([z.number(), z.literal("")]).optional(),
        qty: z.union([z.number(), z.literal("")]).optional(),
      })
    )
    .default({}),
  extras: z
    .array(z.object({ name: z.string().trim().max(300).default(""), amount: z.coerce.number().default(0) }))
    .max(200)
    .default([]),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("costing", "amend");
    const { id } = await params;
    const costing = costingSchema.parse(await req.json());
    await prisma.project.update({ where: { id }, data: { costing } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Project not found", "Failed to save costing");
  }
}
