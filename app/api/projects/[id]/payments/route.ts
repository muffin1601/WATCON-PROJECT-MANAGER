import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { paymentInputSchema } from "../../../../../modules/projects/schema";
import { recordPayment } from "../../../../../services/projectService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await requirePermission("payments", "create");
    const body = await req.json();
    const input = paymentInputSchema.parse(body);
    const payment = await recordPayment(id, input);
    return NextResponse.json({ payment }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Project not found", "Failed to record payment");
  }
}
