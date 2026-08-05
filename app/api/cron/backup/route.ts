import { NextRequest, NextResponse } from "next/server";
import { runBackupWithRetry, isBackupDue } from "../../../../services/backup/run";

/**
 * Weekly backup trigger.
 *
 * The rest of the app is deliberately public and unauthenticated, but this
 * endpoint is not: it reads every project, challan and payment in the
 * database and ships them off-site. So it requires a shared secret, compared
 * in constant time, and refuses to run at all if that secret has not been
 * configured — failing closed rather than exposing a full data export.
 *
 * Point any scheduler at it weekly (Vercel Cron, GitHub Actions, cron-job.org):
 *
 *   Vercel — vercel.json:
 *     { "crons": [{ "path": "/api/cron/backup", "schedule": "0 19 * * 0" }] }
 *     (19:00 UTC Sunday = 00:30 IST Monday)
 *
 * `?force=1` skips the due check for a manual test run.
 */
export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorised(req: NextRequest): boolean {
  const expected = process.env.BACKUP_CRON_SECRET;
  if (!expected) return false;

  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = req.nextUrl.searchParams.get("secret") ?? "";

  return timingSafeEqual(bearer, expected) || timingSafeEqual(query, expected);
}

export async function GET(req: NextRequest) {
  if (!process.env.BACKUP_CRON_SECRET) {
    return NextResponse.json(
      { error: "Backup trigger is disabled: BACKUP_CRON_SECRET is not set on this server." },
      { status: 503 }
    );
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !(await isBackupDue())) {
    return NextResponse.json({ skipped: true, reason: "A successful backup ran within the last 7 days." });
  }

  const outcome = await runBackupWithRetry();
  return NextResponse.json(outcome, { status: outcome.status === "SUCCEEDED" ? 200 : 500 });
}

/** POST behaves identically — some schedulers only issue POST. */
export const POST = GET;
