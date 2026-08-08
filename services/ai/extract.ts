import { runExtraction, AiExtractionError, type ExtractionUsage } from "./client";
import { MODEL_HAIKU, modelForDocument, effortForDocument } from "./config";
import type { IngestedDocument } from "./ingest";
import {
  ORDER_SYSTEM_PROMPT,
  ORDER_TASK_TEXT,
  CHALLAN_SYSTEM_PROMPT,
  CHALLAN_TASK_TEXT,
  CLASSIFY_SYSTEM_PROMPT,
  CLASSIFY_TASK_TEXT,
} from "./prompts";
import {
  ORDER_JSON_SCHEMA,
  CHALLAN_JSON_SCHEMA,
  CLASSIFY_JSON_SCHEMA,
  aiOrderResultSchema,
  aiChallanResultSchema,
  aiClassificationSchema,
  type AiOrderResult,
  type AiChallanResult,
  type AiClassification,
} from "../../modules/ai/schema";

/**
 * The AI extraction layer. Each function is one Claude call: ingested
 * document blocks in, schema-validated structured data out.
 *
 * Nothing here touches the database or the UI — that separation is what lets
 * the mapper layer decide how a result becomes a Sales Order without the
 * extractor knowing anything about Prisma.
 */

export interface ExtractionOutcome<T> {
  result: T;
  usage: ExtractionUsage;
}

function parseOrThrow<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || !parsed.data) {
    // Structured outputs should make this unreachable; if it fires, this
    // file and modules/ai/schema.ts have drifted apart.
    throw new AiExtractionError("The AI returned data in an unexpected shape. Please try again.", true);
  }
  return parsed.data;
}

/**
 * Cheap document-type detection, used when the upload context does not
 * already imply a type (e.g. a general upload on the Documents tab).
 *
 * Runs on Haiku with a three-field output schema, so the cost is essentially
 * the input tokens alone. Callers that already know the type from context —
 * the New Project order field, the Attach Challan modal — skip this entirely
 * rather than pay for a call whose answer they have.
 */
export async function classifyDocument(doc: IngestedDocument): Promise<ExtractionOutcome<AiClassification>> {
  const { data, usage } = await runExtraction<unknown>({
    system: CLASSIFY_SYSTEM_PROMPT,
    content: [...doc.blocks, { type: "text", text: CLASSIFY_TASK_TEXT }],
    schema: CLASSIFY_JSON_SCHEMA as unknown as Record<string, unknown>,
    model: MODEL_HAIKU,
    effort: "low",
    maxTokens: 1_000,
  });
  return { result: parseOrThrow(aiClassificationSchema, data), usage };
}

/** Full extraction of a Purchase Order / BOQ / approved quotation. */
export async function extractOrderDocument(
  doc: IngestedDocument,
  documentClass: "BOQ" | "PURCHASE_ORDER" = "PURCHASE_ORDER"
): Promise<ExtractionOutcome<AiOrderResult>> {
  const { data, usage } = await runExtraction<unknown>({
    system: ORDER_SYSTEM_PROMPT,
    content: [...doc.blocks, { type: "text", text: ORDER_TASK_TEXT }],
    schema: ORDER_JSON_SCHEMA as unknown as Record<string, unknown>,
    model: modelForDocument(documentClass),
    effort: effortForDocument(documentClass),
  });

  const result = parseOrThrow<AiOrderResult>(aiOrderResultSchema, data);
  return { result: reconcileOrderTotals(result), usage };
}

/** Full extraction of a delivery challan. */
export async function extractChallanDocument(
  doc: IngestedDocument
): Promise<ExtractionOutcome<AiChallanResult>> {
  const { data, usage } = await runExtraction<unknown>({
    system: CHALLAN_SYSTEM_PROMPT,
    content: [...doc.blocks, { type: "text", text: CHALLAN_TASK_TEXT }],
    schema: CHALLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
    model: MODEL_HAIKU,
    effort: "low",
    maxTokens: 8_000,
  });
  return { result: parseOrThrow<AiChallanResult>(aiChallanResultSchema, data), usage };
}

/**
 * Cross-checks the item rows against the document's own stated total.
 *
 * This function used to *scale every rate* by `statedTotal / sum(qty x rate)`
 * whenever the two disagreed by more than 0.5%. That silently rewrote prices
 * the client had signed for: a PO whose printed total happens to include GST,
 * freight or a rounding line — which is most of them — would come out with
 * every single rate multiplied by a factor of its own, and the Sales Order
 * would then carry rates that appear on no document anywhere.
 *
 * The document is the source of truth. Rates are now reported, never
 * adjusted; a mismatch becomes a validation message for the human reviewer,
 * who can see the document and decide what the difference actually is.
 */
export function reconcileOrderTotals(result: AiOrderResult): AiOrderResult {
  const items = result.extractedData.items;
  const computed = items.reduce((sum, it) => sum + it.qty * it.rate, 0);
  const stated = result.extractedData.documentTotal;

  if (stated <= 0 || computed <= 0) return result;

  const drift = Math.abs(computed - stated) / stated;
  if (drift <= 0.005) return result;

  result.validation.push(
    `The item rows total ${Math.round(computed).toLocaleString("en-IN")} against the document's stated total of ${Math.round(
      stated
    ).toLocaleString("en-IN")} (${(drift * 100).toFixed(1)}% apart). Every rate is exactly as the document prints it — the difference is usually GST, freight, a discount line or a missing row. Please check before saving.`
  );
  return result;
}
