import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { transportUpdateSchema } from "../../../../modules/projects/schema";
import { deleteTransport, updateTransport } from "../../../../services/transportService";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

interface Params {
  params: Promise<{ transportId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { transportId } = await params;
  try {
    await requirePermission("transport", "amend");
    const input = transportUpdateSchema.parse(await req.json());
    const transport = await updateTransport(transportId, input);
    return NextResponse.json({ transport });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Transport bill not found", "Failed to update transport bill");
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { transportId } = await params;
  try {
    await requirePermission("transport", "delete");
    await deleteTransport(transportId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Transport bill not found", "Failed to delete transport bill");
  }
}
