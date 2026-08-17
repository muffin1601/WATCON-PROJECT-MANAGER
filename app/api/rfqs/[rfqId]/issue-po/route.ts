import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { issuePoFromRfq, RfqConflictError, RfqValidationError } from "../../../../../services/rfqService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

type Ctx = { params: Promise<{ rfqId: string }> };

const schema = z.object({ vendorId: z.string().uuid() });

// Issues one purchase order for every line whose chosen supplier is this
// vendor. The whole thing is a transaction inside the service, so a failure
// leaves no half-created PO and the inquiry stays issuable.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("purchase", "create");
    const { rfqId } = await params;
    const { vendorId } = schema.parse(await req.json());
    const po = await issuePoFromRfq(rfqId, vendorId);
    return NextResponse.json({ po }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof RfqConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof RfqValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Rate inquiry not found", "Failed to issue the purchase order");
  }
}
