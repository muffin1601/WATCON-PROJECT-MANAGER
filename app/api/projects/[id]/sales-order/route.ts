import { NextRequest, NextResponse } from "next/server";
import { deleteSalesOrder } from "../../../../../services/projectService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";

interface Params {
  params: Promise<{ id: string }>;
}

// Deletes the ENTIRE sales order (all orders and items). Challan quantity
// links to these items are lost; bills already generated remain as saved.
// Password-gated in the UI (prototype's soDelete → pwdModal → confirmModal).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await deleteSalesOrder(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Project not found", "Failed to delete sales order");
  }
}
