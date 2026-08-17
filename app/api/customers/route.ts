import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { customerInputSchema, customerListQuerySchema } from "../../../modules/customers/schema";
import {
  createCustomer,
  CustomerConflictError,
  CustomerValidationError,
  listCustomerOptions,
  listCustomers,
} from "../../../services/customerService";
import { apiErrorResponse } from "../../../lib/apiErrors";
import { getGstRatePct } from "../../../lib/settings";
import { requirePermission } from "../../../lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("customers", "view");
    const sp = req.nextUrl.searchParams;
    // ?options=1 returns the slim picker payload used by the project and
    // quotation forms; the default returns the paginated Customers screen.
    if (sp.get("options") === "1") {
      return NextResponse.json({ customers: await listCustomerOptions((sp.get("q") || "").trim()) });
    }
    const query = customerListQuerySchema.parse({
      q: sp.get("q") ?? undefined,
      includeArchived: sp.get("includeArchived") ?? undefined,
      sort: sp.get("sort") ?? undefined,
      page: sp.get("page") ?? undefined,
      pageSize: sp.get("pageSize") ?? undefined,
    });
    const result = await listCustomers(query, await getGstRatePct());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid query", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Not found", "Failed to load customers");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("customers", "create");
    const input = customerInputSchema.parse(await req.json());
    const customer = await createCustomer(input);
    return NextResponse.json({ customer }, { status: 201 });
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
    return apiErrorResponse(err, "Not found", "Failed to create customer", "A customer with this name already exists.");
  }
}
