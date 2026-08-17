import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { rfqInputSchema } from "../../../modules/purchase/schema";
import { createRfq, listRfqs, rfqCandidates, RfqValidationError } from "../../../services/rfqService";
import { apiErrorResponse } from "../../../lib/apiErrors";
import { requirePermission } from "../../../lib/auth";

const candidatesSchema = z.object({ projectIds: z.array(z.string().uuid()).min(1) });

export async function GET(req: NextRequest) {
  try {
    await requirePermission("purchase", "view");
    // ?candidates=<projectId,projectId> powers step 2 of the wizard.
    const raw = req.nextUrl.searchParams.get("candidates");
    if (raw !== null) {
      const { projectIds } = candidatesSchema.parse({ projectIds: raw.split(",").filter(Boolean) });
      return NextResponse.json({ candidates: await rfqCandidates(projectIds) });
    }
    return NextResponse.json({ rfqs: await listRfqs() });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Select at least one project" }, { status: 400 });
    }
    return apiErrorResponse(err, "Not found", "Failed to load rate inquiries");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("purchase", "create");
    const input = rfqInputSchema.parse(await req.json());
    return NextResponse.json({ rfq: await createRfq(input) }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof RfqValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Not found", "Failed to create the rate inquiry");
  }
}
