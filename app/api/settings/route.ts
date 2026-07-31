import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { settingsInputSchema } from "../../../modules/settings/schema";
import { updateSettings } from "../../../services/settingsService";

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const input = settingsInputSchema.parse(body);
    const settings = await updateSettings(input);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    console.error(err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
