import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { vendorUpdateSchema } from "../../../../modules/purchase/schema";
import { updateVendor, VendorValidationError } from "../../../../services/vendorService";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

type Ctx = { params: Promise<{ vendorId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("purchase", "amend");
    const { vendorId } = await params;
    const input = vendorUpdateSchema.parse(await req.json());
    return NextResponse.json({ vendor: await updateVendor(vendorId, input) });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof VendorValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Supplier not found", "Failed to update supplier");
  }
}
