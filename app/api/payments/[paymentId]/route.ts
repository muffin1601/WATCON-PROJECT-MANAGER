import { NextRequest, NextResponse } from "next/server";
import { deletePayment } from "../../../../services/projectService";
import { apiErrorResponse } from "../../../../lib/apiErrors";

interface Params {
  params: Promise<{ paymentId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { paymentId } = await params;
  try {
    await deletePayment(paymentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Payment not found", "Failed to delete payment");
  }
}
