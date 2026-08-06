import { AiExtractionError, type ExtractionUsage } from "./client";
import { extractOrderDocument, extractChallanDocument, classifyDocument, reconcileOrderTotals, type ExtractionOutcome } from "./extract";
import type { IngestedDocument } from "./ingest";
import { isAiConfigured } from "./config";
import { parseOrderFromBuffer } from "../import/orderParser";
import { getOcrProvider } from "../ocr";
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
 * Provider fallback chain for the document engine.
 *
 * Priority (per spec): Claude → OpenAI → Gemini → local OCR/heuristic parser.
 * A missing or failing AI key must NEVER surface as an error to the user —
 * the chain simply moves to the next engine, and the local engine always
 * produces a (best-effort, review-before-save) result.
 *
 * Every engine emits the SAME JSON envelope
 * `{ documentType, confidence, extractedData, validation, warnings }`
 * validated by the same Zod schemas, so everything downstream — validation,
 * mapping, review UI, database — is engine-agnostic.
 */

export type EngineName = "anthropic" | "openai" | "gemini" | "local";

function openAiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || undefined;
}
function geminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

export function engineChain(): EngineName[] {
  const chain: EngineName[] = [];
  if (isAiConfigured()) chain.push("anthropic");
  if (openAiKey()) chain.push("openai");
  if (geminiKey()) chain.push("gemini");
  chain.push("local"); // always present — the guarantee that extraction cannot 503
  return chain;
}

/** Zero-token usage stamp for non-Anthropic engines. */
function usageFor(model: string): ExtractionUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, model };
}

// ------------------------------------------------------------------ OpenAI

const OPENAI_MODEL = () => process.env.OPENAI_MODEL || "gpt-4o";

type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

function openAiParts(doc: IngestedDocument, fileName: string): OpenAiContentPart[] {
  const parts: OpenAiContentPart[] = [];
  for (const block of doc.blocks) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image" && block.source.type === "base64") {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
      });
    } else if (block.type === "document" && "source" in block && block.source.type === "base64") {
      parts.push({
        type: "file",
        file: { filename: fileName || "document.pdf", file_data: `data:application/pdf;base64,${block.source.data}` },
      });
    }
  }
  return parts;
}

async function callOpenAi<T>(args: {
  system: string;
  task: string;
  doc: IngestedDocument;
  fileName: string;
  schema: Record<string, unknown>;
  schemaName: string;
}): Promise<{ data: T; usage: ExtractionUsage }> {
  const key = openAiKey();
  if (!key) throw new AiExtractionError("OpenAI is not configured.");
  const model = OPENAI_MODEL();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: [...openAiParts(args.doc, args.fileName), { type: "text", text: args.task }] },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: args.schemaName, schema: args.schema, strict: false },
      },
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiExtractionError(`OpenAI extraction failed (${res.status}): ${body.slice(0, 200)}`, res.status >= 500);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = json.choices?.[0]?.message;
  if (!msg?.content) {
    throw new AiExtractionError(msg?.refusal ? `OpenAI declined: ${msg.refusal}` : "OpenAI returned an empty result.", true);
  }
  return {
    data: JSON.parse(msg.content) as T,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      model: `openai:${model}`,
    },
  };
}

// ------------------------------------------------------------------ Gemini

const GEMINI_MODEL = () => process.env.GEMINI_MODEL || "gemini-2.0-flash";

function geminiParts(doc: IngestedDocument): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [];
  for (const block of doc.blocks) {
    if (block.type === "text") {
      parts.push({ text: block.text });
    } else if (block.type === "image" && block.source.type === "base64") {
      parts.push({ inline_data: { mime_type: block.source.media_type, data: block.source.data } });
    } else if (block.type === "document" && "source" in block && block.source.type === "base64") {
      parts.push({ inline_data: { mime_type: "application/pdf", data: block.source.data } });
    }
  }
  return parts;
}

/** Strips markdown fences a JSON-mode reply may still carry. */
function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

async function callGemini<T>(args: {
  system: string;
  task: string;
  doc: IngestedDocument;
  schema: Record<string, unknown>;
}): Promise<{ data: T; usage: ExtractionUsage }> {
  const key = geminiKey();
  if (!key) throw new AiExtractionError("Gemini is not configured.");
  const model = GEMINI_MODEL();

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: args.system }] },
        contents: [
          {
            role: "user",
            parts: [
              ...geminiParts(args.doc),
              {
                text: `${args.task}\n\nRespond ONLY with a single JSON object matching this JSON Schema exactly (no markdown fences, no commentary):\n${JSON.stringify(args.schema)}`,
              },
            ],
          },
        ],
        generationConfig: { response_mime_type: "application/json", temperature: 0 },
      }),
      signal: AbortSignal.timeout(240_000),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiExtractionError(`Gemini extraction failed (${res.status}): ${body.slice(0, 200)}`, res.status >= 500);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text.trim()) throw new AiExtractionError("Gemini returned an empty result.", true);
  return {
    data: parseJsonLoose(text) as T,
    usage: {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      model: `gemini:${model}`,
    },
  };
}

// ------------------------------------------------------------- local engine

const LOCAL_WARNING =
  "Read with the built-in local parser (no AI key configured or all AI engines failed). Values are best-effort — please review every row before saving.";

/** Best-effort item rows out of CSV/spreadsheet text: description, [unit], qty, rate. */
function itemsFromCsvText(text: string): { description: string; unit: string; qty: number; rate: number }[] {
  const items: { description: string; unit: string; qty: number; rate: number }[] = [];
  const unitWords = new Set(["nos", "no", "pcs", "set", "sets", "mtr", "mtrs", "m", "rm", "sqft", "sqm", "kg", "kgs", "ltr", "ltrs", "lot", "ls", "job", "each", "bag", "bags"]);
  for (const line of text.split(/\r?\n/)) {
    // Split respecting simple quoted cells.
    const cells = (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [])
      .map((c) => c.replace(/,$/, "").trim().replace(/^"|"$/g, "").replace(/""/g, '"'))
      .filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));
    if (cells.length < 3) continue;
    const descIdx = cells.findIndex((c) => c && Number.isNaN(Number(c.replace(/,/g, ""))));
    const description = descIdx >= 0 ? cells[descIdx]! : "";
    if (!description || /^(s\.?\s?no|total|sub\s*total|grand\s*total|description|particulars)/i.test(description)) continue;
    // Numbers strictly AFTER the description cell — a leading serial-number
    // column ("1, Sand Filter, ...") must never be mistaken for the qty.
    const numbers = cells
      .slice(descIdx + 1)
      .map((c) => Number(c.replace(/[,₹\s]/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (numbers.length < 2) continue;
    const unit = cells.map((c) => c.toLowerCase()).find((c) => unitWords.has(c)) ?? "Nos";
    // Convention across BOQs: qty appears before rate; amount (largest) last.
    const [qty, rate] = numbers;
    if (!qty || rate === undefined) continue;
    items.push({ description: description.slice(0, 120), unit, qty, rate });
  }
  return items;
}

/** OCR text for images via the local provider (Tesseract). Never throws. */
async function localTextFor(doc: IngestedDocument, buffer: Buffer, mimeType: string): Promise<string> {
  if (doc.textLayer.trim()) return doc.textLayer;
  if (doc.sourceKind === "image") {
    try {
      const out = await getOcrProvider().extract({ buffer, mimeType, fileName: "upload" });
      return out.rawText;
    } catch {
      return "";
    }
  }
  return "";
}

async function localOrderResult(
  doc: IngestedDocument,
  buffer: Buffer,
  mimeType: string
): Promise<AiOrderResult> {
  let parsed: Awaited<ReturnType<typeof parseOrderFromBuffer>> | null = null;
  if (mimeType === "application/pdf" || mimeType === "image/png" || mimeType === "image/jpeg") {
    try {
      parsed = await parseOrderFromBuffer(buffer, mimeType);
    } catch {
      parsed = null;
    }
  }

  let items = (parsed?.items ?? []).map((it) => ({
    description: it.description,
    make: it.make ?? "",
    specification: it.specification ?? "",
    code: it.code ?? "",
    unit: it.unit ?? "Nos",
    qty: it.qty ?? 0,
    rate: it.rate ?? 0,
    amount: (it.qty ?? 0) * (it.rate ?? 0),
    taxPct: it.taxPct ?? 0,
    remarks: "",
    sourcePage: 0,
    confidence: 0.5,
  }));

  // Spreadsheets never reach parseOrderFromBuffer — parse the CSV text here.
  if (!items.length && doc.sourceKind === "spreadsheet") {
    items = itemsFromCsvText(doc.textLayer).map((it) => ({
      description: it.description,
      make: "",
      specification: "",
      code: "",
      unit: it.unit,
      qty: it.qty,
      rate: it.rate,
      amount: it.qty * it.rate,
      taxPct: 0,
      remarks: "",
      sourcePage: 0,
      confidence: 0.5,
    }));
  }

  const warnings = [LOCAL_WARNING];
  if (!items.length) {
    warnings.push(
      doc.sourceKind === "pdf-scanned"
        ? "This looks like a scanned PDF; the local parser cannot read scanned pages. Configure an AI key for scanned documents, or enter items manually."
        : "No item rows could be detected automatically — enter the items manually."
    );
  }

  return {
    documentType: "PURCHASE_ORDER",
    confidence: items.length ? 0.5 : 0.1,
    extractedData: {
      projectName: parsed?.projectName ?? "",
      clientName: parsed?.clientName ?? "",
      vendorName: "",
      poNumber: parsed?.poNumber ?? "",
      poDate: parsed?.poDate ?? "",
      siteAddress: parsed?.siteAddress ?? "",
      deliveryAddress: "",
      gstin: "",
      terms: {
        gst: parsed?.terms?.gst ?? "unknown",
        transport: parsed?.terms?.transport ?? "unknown",
        payment: parsed?.terms?.payment ?? "",
      },
      gstRatePct: parsed?.gstRatePct ?? 0,
      discountPct: parsed?.discountPct ?? 0,
      discountAmount: parsed?.discountAmount ?? 0,
      discountNote: "",
      ratesAreGstInclusive: false,
      documentTotal: 0,
      remarks: "",
      items,
    },
    validation: [],
    warnings,
  };
}

async function localChallanResult(
  doc: IngestedDocument,
  buffer: Buffer,
  mimeType: string
): Promise<AiChallanResult> {
  const text = await localTextFor(doc, buffer, mimeType);

  const pick = (re: RegExp): string => text.match(re)?.[1]?.trim() ?? "";
  const challanNo = pick(/challan\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9/\-]+)/i);
  const poNumber = pick(/(?:against\s*po|po\s*(?:no\.?|number|#)|ref)\s*[:\-]?\s*([A-Za-z0-9/\-]+)/i);
  const vehicle = pick(/vehicle\s*(?:no\.?)?\s*[:\-]?\s*([A-Za-z0-9\- ]{4,15})/i);
  // dd/mm/yyyy or dd-mm-yyyy → ISO; else empty.
  let date = "";
  const dm = text.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
  if (dm) {
    const [, d, m, y] = dm;
    const yyyy = y!.length === 2 ? `20${y}` : y!;
    date = `${yyyy}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }

  // Item rows: "<description> [unit] <qty>" lines.
  const items: AiChallanResult["extractedData"]["items"] = [];
  const linePattern = /^(.{3,80}?)\s+(?:([A-Za-z]{1,5})\s+)?(\d+(?:\.\d+)?)\s*$/;
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(linePattern);
    if (!m) continue;
    const [, description, unit, qtyStr] = m;
    const qty = Number(qtyStr);
    if (!description || !Number.isFinite(qty) || qty <= 0) continue;
    if (/^(total|challan|date|vehicle|driver|remarks|page)/i.test(description)) continue;
    items.push({ description: description.trim(), unit: unit || "Nos", qty, code: "", remarks: "", confidence: 0.4 });
  }

  const warnings = [LOCAL_WARNING];
  if (!text.trim()) {
    warnings.push("No readable text was found in this document — enter the challan details manually.");
  }

  return {
    documentType: "CHALLAN",
    confidence: items.length ? 0.4 : 0.1,
    extractedData: {
      challanNo,
      date,
      vehicle,
      driver: "",
      clientName: "",
      projectName: "",
      siteAddress: "",
      poNumber,
      remarks: "",
      totalValue: 0,
      items,
    },
    validation: [],
    warnings,
  };
}

function localClassification(doc: IngestedDocument, fileName: string): AiClassification {
  const hay = (doc.textLayer + " " + fileName).toLowerCase();
  let documentType: AiClassification["documentType"] = "UNKNOWN";
  if (/challan/.test(hay)) documentType = "CHALLAN";
  else if (/bill of quantities|boq/.test(hay)) documentType = "BOQ";
  else if (/purchase order|work order|\bpo\b|\bwo\b/.test(hay)) documentType = "PURCHASE_ORDER";
  return {
    documentType,
    confidence: documentType === "UNKNOWN" ? 0.1 : 0.5,
    reason: "Classified by keyword heuristics (local engine — no AI key configured).",
  };
}

// ------------------------------------------------------------- fallback core

function validateAs<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || !parsed.data) {
    throw new AiExtractionError("The AI returned data in an unexpected shape.", true);
  }
  return parsed.data;
}

async function withFallback<T>(
  runners: Partial<Record<EngineName, () => Promise<ExtractionOutcome<T>>>>
): Promise<ExtractionOutcome<T>> {
  let lastError: unknown = null;
  for (const engine of engineChain()) {
    const run = runners[engine];
    if (!run) continue;
    try {
      return await run();
    } catch (err) {
      lastError = err;
      console.warn(`[ai] engine "${engine}" failed, falling back:`, err instanceof Error ? err.message : err);
    }
  }
  // Unreachable when a "local" runner is supplied (it never throws), but keep
  // a real error path for the classify chain if the local guess were removed.
  throw lastError ?? new AiExtractionError("No extraction engine is available.");
}

export async function extractOrderWithFallback(
  doc: IngestedDocument,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<ExtractionOutcome<AiOrderResult>> {
  return withFallback<AiOrderResult>({
    anthropic: () => extractOrderDocument(doc, "PURCHASE_ORDER"),
    openai: async () => {
      const { data, usage } = await callOpenAi<unknown>({
        system: ORDER_SYSTEM_PROMPT,
        task: ORDER_TASK_TEXT,
        doc,
        fileName,
        schema: ORDER_JSON_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "order_extraction",
      });
      return { result: reconcileOrderTotals(validateAs(aiOrderResultSchema, data)), usage };
    },
    gemini: async () => {
      const { data, usage } = await callGemini<unknown>({
        system: ORDER_SYSTEM_PROMPT,
        task: ORDER_TASK_TEXT,
        doc,
        schema: ORDER_JSON_SCHEMA as unknown as Record<string, unknown>,
      });
      return { result: reconcileOrderTotals(validateAs(aiOrderResultSchema, data)), usage };
    },
    local: async () => ({ result: await localOrderResult(doc, buffer, mimeType), usage: usageFor("local-parser") }),
  });
}

export async function extractChallanWithFallback(
  doc: IngestedDocument,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<ExtractionOutcome<AiChallanResult>> {
  return withFallback<AiChallanResult>({
    anthropic: () => extractChallanDocument(doc),
    openai: async () => {
      const { data, usage } = await callOpenAi<unknown>({
        system: CHALLAN_SYSTEM_PROMPT,
        task: CHALLAN_TASK_TEXT,
        doc,
        fileName,
        schema: CHALLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "challan_extraction",
      });
      return { result: validateAs(aiChallanResultSchema, data), usage };
    },
    gemini: async () => {
      const { data, usage } = await callGemini<unknown>({
        system: CHALLAN_SYSTEM_PROMPT,
        task: CHALLAN_TASK_TEXT,
        doc,
        schema: CHALLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
      });
      return { result: validateAs(aiChallanResultSchema, data), usage };
    },
    local: async () => ({ result: await localChallanResult(doc, buffer, mimeType), usage: usageFor("local-parser") }),
  });
}

export async function classifyWithFallback(
  doc: IngestedDocument,
  fileName: string
): Promise<ExtractionOutcome<AiClassification>> {
  return withFallback<AiClassification>({
    anthropic: () => classifyDocument(doc),
    openai: async () => {
      const { data, usage } = await callOpenAi<unknown>({
        system: CLASSIFY_SYSTEM_PROMPT,
        task: CLASSIFY_TASK_TEXT,
        doc,
        fileName,
        schema: CLASSIFY_JSON_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "document_classification",
      });
      return { result: validateAs(aiClassificationSchema, data), usage };
    },
    gemini: async () => {
      const { data, usage } = await callGemini<unknown>({
        system: CLASSIFY_SYSTEM_PROMPT,
        task: CLASSIFY_TASK_TEXT,
        doc,
        schema: CLASSIFY_JSON_SCHEMA as unknown as Record<string, unknown>,
      });
      return { result: validateAs(aiClassificationSchema, data), usage };
    },
    local: async () => ({ result: localClassification(doc, fileName), usage: usageFor("local-parser") }),
  });
}
