import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { quotationUpdateSchema } from "../../../../modules/quotations/schema";
import {
  archiveQuotation,
  deleteQuotation,
  getQuotation,
  QuotationConflictError,
  QuotationValidationError,
  restoreQuotation,
  updateQuotation,
} from "../../../../services/quotationService";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

type Ctx = { params: Promise<{ quotationId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("quotes", "view");
    const { quotationId } = await params;
    const quotation = await getQuotation(quotationId);
    if (!quotation) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    return NextResponse.json({ quotation });
  } catch (err) {
    return apiErrorResponse(err, "Quotation not found", "Failed to load quotation");
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("quotes", "amend");
    const { quotationId } = await params;
    const body = await req.json();
    if (body?.action === "archive") return NextResponse.json({ quotation: await archiveQuotation(quotationId) });
    if (body?.action === "restore") return NextResponse.json({ quotation: await restoreQuotation(quotationId) });

    const input = quotationUpdateSchema.parse(body);
    return NextResponse.json({ quotation: await updateQuotation(quotationId, input) });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof QuotationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof QuotationValidationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return apiErrorResponse(err, "Quotation not found", "Failed to update quotation");
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("quotes", "delete");
    const { quotationId } = await params;
    await deleteQuotation(quotationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof QuotationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof QuotationValidationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return apiErrorResponse(err, "Quotation not found", "Failed to delete quotation");
  }
}
