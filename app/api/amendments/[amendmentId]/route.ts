import { NextRequest, NextResponse } from "next/server";
import { deleteAmendment } from "../../../../services/adjustmentService";
import { apiErrorResponse } from "../../../../lib/apiErrors";

interface Params {
  params: Promise<{ amendmentId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { amendmentId } = await params;
  try {
    await deleteAmendment(amendmentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Amendment not found", "Failed to delete amendment");
  }
}
