import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { amendmentInputSchema } from "../../../../../modules/adjustments/schema";
import { addAmendment } from "../../../../../services/adjustmentService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await requirePermission("adjust", "create");
    const body = await req.json();
    const input = amendmentInputSchema.parse(body);
    const amendment = await addAmendment(id, input);
    return NextResponse.json({ amendment }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    return apiErrorResponse(err, "Project not found", "Failed to add amendment");
  }
}
