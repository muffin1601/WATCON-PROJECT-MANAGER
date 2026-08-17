import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { poReceiptSchema, poUpdateSchema } from "../../../../modules/purchase/schema";
import { getPurchaseOrder, postPoReceipt, PoValidationError, updatePurchaseOrder } from "../../../../services/purchaseOrderService";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

type Ctx = { params: Promise<{ poId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("purchase", "view");
    const { poId } = await params;
    const po = await getPurchaseOrder(poId);
    if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    return NextResponse.json({ po });
  } catch (err) {
    return apiErrorResponse(err, "Purchase order not found", "Failed to load the purchase order");
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("purchase", "amend");
    const { poId } = await params;
    const body = await req.json();

    // Receipts travel as an explicit action: they move stock, so they must not
    // be reachable by accident through an ordinary field edit.
    if (body?.action === "receipt") {
      const { lineId, receivedQty } = poReceiptSchema.parse(body);
      const result = await postPoReceipt(poId, lineId, receivedQty);
      return NextResponse.json({ ok: true, ...result });
    }

    const input = poUpdateSchema.parse(body);
    return NextResponse.json({ po: await updatePurchaseOrder(poId, input) });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof PoValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Purchase order not found", "Failed to update the purchase order");
  }
}
