import { NextRequest, NextResponse } from "next/server";
import { deleteItemMaster } from "../../../../services/stockService";
import { apiErrorResponse } from "../../../../lib/apiErrors";

interface Params {
  params: Promise<{ itemId: string }>;
}

// Deletes a master item. It reappears automatically (via syncItemsMaster)
// if the item is still on any project's sales order — same as the prototype.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { itemId } = await params;
  try {
    await deleteItemMaster(itemId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Item not found", "Failed to delete item");
  }
}
