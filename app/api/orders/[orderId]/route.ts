import { NextRequest, NextResponse } from "next/server";
import { deleteProjectOrder } from "../../../../services/projectService";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

interface Params {
  params: Promise<{ orderId: string }>;
}

// Deletes an additional order and all its Sales Order items (challan links
// to those items cascade away) — prototype's "Delete order" (password-gated
// in the UI, like challan edit/delete).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orderId } = await params;
  try {
    await requirePermission("salesorder", "delete");
    await deleteProjectOrder(orderId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Order not found", "Failed to delete order");
  }
}
