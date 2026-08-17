import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { attachChallanInputSchema, issueChallanInputSchema } from "../../../../modules/challans/schema";
import {
  deleteChallan,
  updateAttachedChallan,
  updateIssuedChallan,
  ValidationError,
} from "../../../../services/challanService";
import { prisma } from "../../../../lib/prisma";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

interface Params {
  params: Promise<{ challanId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { challanId } = await params;
  try {
    await requirePermission("challans", "amend");
    const existing = await prisma.challan.findUnique({ where: { id: challanId }, select: { projectId: true, source: true } });
    if (!existing) return NextResponse.json({ error: "Challan not found" }, { status: 404 });

    const body = await req.json();
    if (existing.source === "ATTACHED_EXTERNAL") {
      const input = attachChallanInputSchema.parse(body);
      const challan = await updateAttachedChallan(challanId, input);
      return NextResponse.json({ challan });
    }
    const input = issueChallanInputSchema.parse(body);
    const challan = await updateIssuedChallan(challanId, existing.projectId, input);
    return NextResponse.json({ challan });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Challan not found", "Failed to update challan", "A challan with this number already exists on this project");
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { challanId } = await params;
  try {
    await requirePermission("challans", "delete");
    await deleteChallan(challanId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Challan not found", "Failed to delete challan");
  }
}
