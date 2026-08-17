import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { catalogItemInputSchema, catalogListQuerySchema } from "../../../modules/catalog/schema";
import {
  CatalogConflictError,
  CatalogValidationError,
  createCatalogItem,
  listCatalogItems,
  listCatalogOptions,
  seedCatalogFromUsage,
} from "../../../services/catalogService";
import { apiErrorResponse } from "../../../lib/apiErrors";
import { requirePermission } from "../../../lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("items", "view");
    const sp = req.nextUrl.searchParams;
    if (sp.get("options") === "1") {
      return NextResponse.json({ items: await listCatalogOptions((sp.get("q") || "").trim()) });
    }
    const query = catalogListQuerySchema.parse({
      q: sp.get("q") ?? undefined,
      category: sp.get("category") ?? undefined,
      includeArchived: sp.get("includeArchived") ?? undefined,
      page: sp.get("page") ?? undefined,
      pageSize: sp.get("pageSize") ?? undefined,
    });
    return NextResponse.json(await listCatalogItems(query));
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid query", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Not found", "Failed to load the item sheet");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("items", "create");
    const body = await req.json();

    // One-shot seeding of the sheet from item names already used elsewhere.
    if (body?.action === "seedFromUsage") {
      const created = await seedCatalogFromUsage();
      return NextResponse.json({ created });
    }

    const input = catalogItemInputSchema.parse(body);
    const item = await createCatalogItem(input);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof CatalogConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof CatalogValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Not found", "Failed to save item", "An item with this name already exists.");
  }
}
