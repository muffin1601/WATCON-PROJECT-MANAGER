import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { catalogItemUpdateSchema } from "../../../../modules/catalog/schema";
import {
  archiveCatalogItem,
  CatalogConflictError,
  CatalogValidationError,
  deleteCatalogItemIfUnused,
  getCatalogItem,
  restoreCatalogItem,
  updateCatalogItem,
} from "../../../../services/catalogService";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

type Ctx = { params: Promise<{ itemId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("items", "view");
    const { itemId } = await params;
    const item = await getCatalogItem(itemId);
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (err) {
    return apiErrorResponse(err, "Item not found", "Failed to load item");
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("items", "amend");
    const { itemId } = await params;
    const body = await req.json();
    if (body?.action === "archive") return NextResponse.json({ item: await archiveCatalogItem(itemId) });
    if (body?.action === "restore") return NextResponse.json({ item: await restoreCatalogItem(itemId) });

    const input = catalogItemUpdateSchema.parse(body);
    return NextResponse.json({ item: await updateCatalogItem(itemId, input) });
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
    return apiErrorResponse(err, "Item not found", "Failed to update item");
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePermission("items", "delete");
    const { itemId } = await params;
    await deleteCatalogItemIfUnused(itemId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CatalogValidationError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return apiErrorResponse(err, "Item not found", "Failed to delete item");
  }
}
