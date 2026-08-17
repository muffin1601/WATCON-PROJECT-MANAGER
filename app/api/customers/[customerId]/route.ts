import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { customerUpdateSchema } from "../../../../modules/customers/schema";
import {
  archiveCustomer,
  CustomerConflictError,
  CustomerValidationError,
  deleteCustomerIfUnused,
  getCustomerDetail,
  restoreCustomer,
  updateCustomer,
} from "../../../../services/customerService";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { getGstRatePct } from "../../../../lib/settings";
import { requirePermission } from "../../../../lib/auth";

type Ctx = { params: Promise<{ customerId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("customers", "view");
    const { customerId } = await params;
    const customer = await getCustomerDetail(customerId, await getGstRatePct());
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    return NextResponse.json({ customer });
  } catch (err) {
    return apiErrorResponse(err, "Customer not found", "Failed to load customer");
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("customers", "amend");
    const { customerId } = await params;
    const body = await req.json();

    // Archive/restore travel on the same endpoint as a deliberate state change
    // rather than a field edit, so the intent is explicit in the request.
    if (body?.action === "archive") {
      return NextResponse.json({ customer: await archiveCustomer(customerId) });
    }
    if (body?.action === "restore") {
      return NextResponse.json({ customer: await restoreCustomer(customerId) });
    }

    const input = customerUpdateSchema.parse(body);
    const customer = await updateCustomer(customerId, input);
    return NextResponse.json({ customer });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof CustomerConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof CustomerValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Customer not found", "Failed to update customer");
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("customers", "delete");
    const { customerId } = await params;
    await deleteCustomerIfUnused(customerId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CustomerValidationError) {
      // 409: the request is well-formed but conflicts with existing history —
      // the UI turns this into "Archive instead".
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return apiErrorResponse(err, "Customer not found", "Failed to delete customer");
  }
}
