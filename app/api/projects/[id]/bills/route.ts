import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { generateBillInputSchema } from "../../../../../modules/challans/schema";
import { generateRunningBill } from "../../../../../services/runningBillService";
import { ValidationError } from "../../../../../services/challanService";
import { requirePermission } from "../../../../../lib/auth";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await requirePermission("bills", "create");
    const body = await req.json();
    const input = generateBillInputSchema.parse(body);
    const bill = await generateRunningBill(id, input);
    return NextResponse.json({ bill }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to generate bill" }, { status: 500 });
  }
}
