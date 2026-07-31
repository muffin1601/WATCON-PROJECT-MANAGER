import { NextRequest, NextResponse } from "next/server";
import { deleteBill } from "../../../../services/runningBillService";
import { apiErrorResponse } from "../../../../lib/apiErrors";

interface Params {
  params: Promise<{ billId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { billId } = await params;
  try {
    await deleteBill(billId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Bill not found", "Failed to delete bill");
  }
}
