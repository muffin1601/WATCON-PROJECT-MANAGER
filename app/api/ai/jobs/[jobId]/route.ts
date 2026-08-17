import { NextRequest, NextResponse } from "next/server";
import { getJobView, reapStaleJobs } from "../../../../../services/ai/jobs";
import { authErrorResponse, requirePermission } from "../../../../../lib/auth";

/**
 * Poll endpoint for an extraction job.
 *
 * Stale-job reaping is triggered from here rather than from a scheduler: the
 * only moment anyone cares whether a job is wedged is when someone is waiting
 * on one, and this keeps the engine free of an external cron dependency.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requirePermission("salesorder", "view");
    const { jobId } = await params;

    await reapStaleJobs().catch(() => {
      // Best-effort housekeeping — never fail a poll because of it.
    });

    const job = await getJobView(jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    return NextResponse.json(
      { job },
      // Progress must never be served from a cache, or the bar freezes.
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error(err);
    return NextResponse.json({ error: "Failed to load job" }, { status: 500 });
  }
}
