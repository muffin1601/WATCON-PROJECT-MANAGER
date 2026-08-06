import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { amendSalesOrderInputSchema } from "../../../../../modules/projects/schema";
import { amendSalesOrder, ProjectValidationError } from "../../../../../services/projectService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const input = amendSalesOrderInputSchema.parse(await req.json());
    const amendment = await amendSalesOrder(id, input);
    return NextResponse.json({ amendment }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof ProjectValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Project not found", "Failed to amend sales order");
  }
}
