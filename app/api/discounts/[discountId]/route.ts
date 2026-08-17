import { NextRequest, NextResponse } from "next/server";
import { deleteDiscount } from "../../../../services/adjustmentService";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

interface Params {
  params: Promise<{ discountId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { discountId } = await params;
  try {
    await requirePermission("adjust", "delete");
    await deleteDiscount(discountId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Discount not found", "Failed to delete discount");
  }
}
