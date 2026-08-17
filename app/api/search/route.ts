import { NextRequest, NextResponse } from "next/server";
import { globalSearch } from "../../../services/searchService";
import { authErrorResponse, requireAuth } from "../../../lib/auth";

export async function GET(req: NextRequest) {
  try {
    // Search spans every module, so it requires a session but no single
    // module permission; it only ever returns records that already exist.
    await requireAuth();
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const results = await globalSearch(q);
    return NextResponse.json({ results });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error(err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
