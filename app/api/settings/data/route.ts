import { NextRequest, NextResponse } from "next/server";
import { BackupImportError, clearAllData, importBackup } from "../../../../services/backupService";
import { verifyDeletePassword, DeleteAuthorisationError } from "../../../../lib/deletePassword";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

// Import backup and Clear all data. Both wipe live business data, so both need
// Settings DELETE rights AND the full-project deletion password — the same
// credential the prototype demanded before clearing everything, verified
// server-side so hiding the button is never the only protection.
export async function POST(req: NextRequest) {
  try {
    await requirePermission("settings", "delete");
    const body = await req.json();

    if (!(await verifyDeletePassword(body?.password))) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 403 });
    }

    if (body?.action === "clear") {
      const counts = await clearAllData();
      return NextResponse.json({ ok: true, counts });
    }

    if (body?.action === "import") {
      const result = await importBackup(body.backup);
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof BackupImportError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof DeleteAuthorisationError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return apiErrorResponse(err, "Not found", "The operation failed — nothing was changed.");
  }
}
