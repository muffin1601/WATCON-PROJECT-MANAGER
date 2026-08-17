import { NextRequest, NextResponse } from "next/server";
import {
  convertToProject,
  QuotationConflictError,
  QuotationValidationError,
} from "../../../../../services/quotationService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

type Ctx = { params: Promise<{ quotationId: string }> };

// Convert an accepted quotation into a live project. The whole conversion is
// one database transaction inside the service, so a failure leaves no
// half-created project behind and the quotation stays convertible.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("quotes", "create");
    const { quotationId } = await params;
    const { projectId } = await convertToProject(quotationId);
    return NextResponse.json({ projectId }, { status: 201 });
  } catch (err) {
    if (err instanceof QuotationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof QuotationValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Quotation not found", "Failed to convert quotation to a project");
  }
}
