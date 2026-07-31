import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { attachChallanInputSchema, issueChallanInputSchema } from "../../../../../modules/challans/schema";
import { createAttachedChallan, createIssuedChallan, ValidationError } from "../../../../../services/challanService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await req.json();
    if (body.source === "ATTACHED_EXTERNAL") {
      const input = attachChallanInputSchema.parse(body);
      const challan = await createAttachedChallan(id, input);
      return NextResponse.json({ challan }, { status: 201 });
    }
    const input = issueChallanInputSchema.parse(body);
    const challan = await createIssuedChallan(id, input);
    return NextResponse.json({ challan }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Project not found", "Failed to create challan", "A challan with this number already exists on this project");
  }
}
