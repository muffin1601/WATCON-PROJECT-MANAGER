import { NextResponse } from "next/server";
import { exportAllData } from "../../../../services/settingsService";

export async function GET() {
  const data = await exportAllData();
  return NextResponse.json(data, {
    headers: {
      "Content-Disposition": `attachment; filename="watcon-pm-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
