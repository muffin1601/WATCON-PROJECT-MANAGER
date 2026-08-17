import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { splitItemInputSchema } from "../../../../../../../modules/projects/schema";
import { ProjectValidationError, splitProjectItem } from "../../../../../../../services/projectService";
import { apiErrorResponse } from "../../../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../../../lib/auth";

interface Params {
  params: Promise<{ id: string; itemId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id, itemId } = await params;
  try {
    await requirePermission("salesorder", "amend");
    const input = splitItemInputSchema.parse(await req.json());
    const items = await splitProjectItem(id, itemId, input);
    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof ProjectValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Sales order item not found", "Failed to split item");
  }
}
