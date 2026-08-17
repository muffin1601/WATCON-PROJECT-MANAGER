import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { vendorInputSchema } from "../../../modules/purchase/schema";
import { createVendor, listVendors, VendorValidationError } from "../../../services/vendorService";
import { apiErrorResponse } from "../../../lib/apiErrors";
import { requirePermission } from "../../../lib/auth";

export async function GET() {
  try {
    await requirePermission("purchase", "view");
    return NextResponse.json({ vendors: await listVendors() });
  } catch (err) {
    return apiErrorResponse(err, "Not found", "Failed to load suppliers");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("purchase", "create");
    const input = vendorInputSchema.parse(await req.json());
    return NextResponse.json({ vendor: await createVendor(input) }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof VendorValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Not found", "Failed to create supplier");
  }
}
