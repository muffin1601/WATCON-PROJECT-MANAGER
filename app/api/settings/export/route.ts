import { NextResponse } from "next/server";
import { exportAllData } from "../../../../services/settingsService";
import { authErrorResponse, requirePermission } from "../../../../lib/auth";

export async function GET() {
  try {
    // A full data dump — gated on Settings view rights, not merely a session.
    await requirePermission("settings", "view");
    const data = await exportAllData();
    return NextResponse.json(data, {
      headers: {
        "Content-Disposition": `attachment; filename="watcon-pm-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error(err);
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}
