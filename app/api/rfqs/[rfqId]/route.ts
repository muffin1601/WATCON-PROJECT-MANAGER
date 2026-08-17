import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  addRfqVendors,
  getRfqDetail,
  RfqValidationError,
  selectLowestForAll,
  setRfqSelection,
} from "../../../../services/rfqService";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

type Ctx = { params: Promise<{ rfqId: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("select"),
    lineId: z.string().uuid(),
    vendorId: z.string().uuid().nullable(),
  }),
  z.object({ action: z.literal("selectLowest") }),
  z.object({ action: z.literal("addVendors"), vendorIds: z.array(z.string().uuid()).min(1) }),
]);

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("purchase", "view");
    const { rfqId } = await params;
    const rfq = await getRfqDetail(rfqId);
    if (!rfq) return NextResponse.json({ error: "Rate inquiry not found" }, { status: 404 });
    return NextResponse.json({ rfq });
  } catch (err) {
    return apiErrorResponse(err, "Rate inquiry not found", "Failed to load the rate inquiry");
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("purchase", "amend");
    const { rfqId } = await params;
    const body = actionSchema.parse(await req.json());

    if (body.action === "select") {
      await setRfqSelection(rfqId, body.lineId, body.vendorId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "selectLowest") {
      const count = await selectLowestForAll(rfqId);
      return NextResponse.json({ ok: true, count });
    }
    await addRfqVendors(rfqId, body.vendorIds);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof RfqValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Rate inquiry not found", "Failed to update the rate inquiry");
  }
}
