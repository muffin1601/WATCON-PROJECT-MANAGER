import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { quotationInputSchema, quotationListQuerySchema } from "../../../modules/quotations/schema";
import {
  createQuotation,
  listQuotations,
  QuotationConflictError,
  QuotationValidationError,
} from "../../../services/quotationService";
import { apiErrorResponse } from "../../../lib/apiErrors";
import { requirePermission } from "../../../lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("quotes", "view");
    const sp = req.nextUrl.searchParams;
    const query = quotationListQuerySchema.parse({
      q: sp.get("q") ?? undefined,
      status: sp.get("status") || undefined,
      customerId: sp.get("customerId") || undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      includeArchived: sp.get("includeArchived") ?? undefined,
      sort: sp.get("sort") ?? undefined,
      page: sp.get("page") ?? undefined,
      pageSize: sp.get("pageSize") ?? undefined,
    });
    return NextResponse.json(await listQuotations(query));
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid query", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Not found", "Failed to load quotations");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("quotes", "create");
    const input = quotationInputSchema.parse(await req.json());
    const quotation = await createQuotation(input);
    return NextResponse.json({ quotation }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof QuotationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof QuotationValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Not found", "Failed to create quotation", "That quotation number is already in use.");
  }
}
