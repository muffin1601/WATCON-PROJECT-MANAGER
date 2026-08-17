import { NextRequest, NextResponse } from "next/server";
import { duplicateQuotation, QuotationValidationError } from "../../../../../services/quotationService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

type Ctx = { params: Promise<{ quotationId: string }> };

// Copy a quotation into a new DRAFT with its own number — the safe way to
// revise something already sent to a client.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("quotes", "create");
    const { quotationId } = await params;
    const quotation = await duplicateQuotation(quotationId);
    return NextResponse.json({ quotation }, { status: 201 });
  } catch (err) {
    if (err instanceof QuotationValidationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return apiErrorResponse(err, "Quotation not found", "Failed to duplicate quotation");
  }
}
