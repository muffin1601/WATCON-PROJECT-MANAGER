import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { discountInputSchema } from "../../../../../modules/adjustments/schema";
import { addDiscount } from "../../../../../services/adjustmentService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await req.json();
    const input = discountInputSchema.parse(body);
    const discount = await addDiscount(id, input);
    return NextResponse.json({ discount }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    return apiErrorResponse(err, "Project not found", "Failed to add discount");
  }
}
