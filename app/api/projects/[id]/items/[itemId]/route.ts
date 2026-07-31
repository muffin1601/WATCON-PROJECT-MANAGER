import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { poItemInputSchema } from "../../../../../../modules/projects/schema";
import { deleteProjectItem, updateProjectItem } from "../../../../../../services/projectService";
import { apiErrorResponse } from "../../../../../../lib/apiErrors";

interface Params {
  params: Promise<{ id: string; itemId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { itemId } = await params;
  try {
    const body = await req.json();
    const input = poItemInputSchema.partial().parse(body);
    const item = await updateProjectItem(itemId, input);
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Sales order item not found", "Failed to update item");
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { itemId } = await params;
  try {
    await deleteProjectItem(itemId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Sales order item not found", "Failed to delete item");
  }
}
