import { AiExtractionError, type ExtractionUsage } from "./client";
import {
  extractOrderDocument,
  extractOrderChunkDocument,
  extractChallanDocument,
  classifyDocument,
  reconcileOrderTotals,
  type ExtractionOutcome,
} from "./extract";
import type { IngestedDocument } from "./ingest";
import { FAST_PDF_MODE, isAiConfigured } from "./config";
import { parseOrderFromBuffer } from "../import/orderParser";
import { buildOrderFromWorkbook } from "../import/spreadsheetOrder";
import { buildChallanFromWorkbook } from "../import/spreadsheetChallan";
import { readPdfAsGrid } from "../import/pdfTable";
import { getOcrProvider } from "../ocr";
import { ocrScannedPdf } from "../ocr/pdfRaster";
import { itemsFromOcrText } from "./ocrRows";
import {
  ORDER_SYSTEM_PROMPT,
  ORDER_TASK_TEXT,
  orderChunkTaskText,
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

/**
 * Local text for a document: embedded text layer if it has one, otherwise
 * OCR — Tesseract directly for images, page-by-page rasterisation for scanned
 * PDFs. Never throws; an unreadable document yields "".
 */
async function localTextFor(doc: IngestedDocument, buffer: Buffer, mimeType: string): Promise<string> {
  // A scanned PDF often still carries a few hundred characters of text (a
  // header stamp, a footer, an embedded logo's alt text). Trusting that
  // fragment would skip OCR and yield nothing usable, so the scanned branch
  // is checked BEFORE the text layer.
  if (doc.sourceKind === "pdf-scanned") {
    const ocr = await ocrScannedPdf(buffer);
    // Keep the fragment as context when OCR itself came back empty.
    return ocr.text.trim() ? ocr.text : doc.textLayer;
  }
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
  // Digital PDFs are read as a table first. The line-shaped heuristics below
  // remain as a fallback, but they cannot preserve which cells share a row,
  // so they are no longer the first thing tried on a document that has a real
  // text layer.
  if (mimeType === "application/pdf" && doc.sourceKind === "pdf-digital") {
    try {
      const grid = await readPdfAsGrid(buffer);
      const outcome = buildOrderFromWorkbook(grid, "document.pdf");
      if (outcome.usable) {
        outcome.result.warnings.unshift(LOCAL_WARNING);
        return outcome.result;
      }
    } catch (err) {
      console.warn("[ai] local PDF table read failed, falling back to line heuristics:", err);
    }
  }

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

  // Scanned PDFs / photos: no text layer, so rasterise + OCR, then read rows
  // out of the OCR text. This is what makes a scanned Work Order usable
  // without any AI key at all.
  let ocrPagesRead = 0;
  let ocrRejected = 0;
  let ocrTotalPages = 0;
  if (!items.length && (doc.sourceKind === "pdf-scanned" || doc.sourceKind === "image")) {
    const ocrText = await localTextFor(doc, buffer, mimeType);
    if (ocrText.trim()) {
      ocrPagesRead = (ocrText.match(/^----- PAGE /gm) ?? []).length;
      ocrTotalPages = doc.pageCount;
      const ocrRows = itemsFromOcrText(ocrText);
      ocrRejected = ocrRows.rejected;
      items = ocrRows.rows.map((it) => ({
        description: it.description,
        make: it.make,
        specification: "",
        code: "",
        unit: it.unit,
        qty: it.qty,
        rate: it.rate,
        amount: it.qty * it.rate,
        taxPct: 0,
        remarks: "",
        sourcePage: 0,
        confidence: it.confidence ?? 0.35,
      }));
    }
  }

  const warnings = [LOCAL_WARNING];
  if (ocrPagesRead > 0) {
    warnings.push(
      `Scanned document: ${ocrPagesRead} of ${ocrTotalPages} page(s) were read by local OCR. Only rows whose quantity x rate matched the printed amount were kept — check every figure against the original before saving.`
    );
    if (ocrRejected > 0) {
      warnings.push(
        `${ocrRejected} further row(s) were read but their numbers did not add up, so they were left out rather than guessed. Add them manually, or upload the BOQ as Excel/CSV for an exact read.`
      );
    }
  }
  if (!items.length) {
    warnings.push(
      doc.sourceKind === "pdf-scanned"
        ? "This scanned PDF could not be read well enough to recover item rows. Upload the BOQ as Excel/CSV if you have it, configure an AI key, or enter the items manually."
        : "No item rows could be detected automatically — enter the items manually."
    );
  }

  return {
    documentType: "PURCHASE_ORDER",
    confidence: items.length ? 0.5 : 0.1,
    extractedData: {
      projectName: parsed?.projectName || "",
      clientName: parsed?.clientName || "",
      vendorName: "",
      poNumber: parsed?.poNumber || "",
      poDate: parsed?.poDate || "",
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
      documentTotal: parsed?.documentTotal ?? 0,
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

/**
 * Is a table read good enough to be preferred over asking a model to read the
 * document?
 *
 * The geometric reader either recovers a table cleanly or it does not. A
 * partial read — rows without rates, a handful of lines out of a fifty-row BOQ
 * — means the layout defeated it, and there the AI chain does better. Demanding
 * that nearly every row carry a quantity and a rate is what keeps a half-read
 * table from displacing a good extraction.
 */
function isConfidentTableRead(result: AiOrderResult): boolean {
  const items = result.extractedData.items;
  if (items.length === 0) return false;
  const complete = items.filter((it) => it.qty > 0 && it.rate > 0).length;
  return complete / items.length >= 0.8;
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
  // Structured files are read structurally, ahead of every AI engine.
  //
  // A spreadsheet is not a document that needs interpreting — it already has
  // the table, the columns and the typed values. Asking a model to transcribe
  // it can only introduce error, and transcription is where mismatched
  // product/price pairs came from. The AI chain below is still reached when
  // the file contains no identifiable table (a scanned image pasted into a
  // sheet, a free-form quote), which is the only case where interpretation is
  // genuinely needed.
  if (doc.workbook) {
    const outcome = buildOrderFromWorkbook(doc.workbook, fileName);
    if (outcome.usable) {
      return { result: outcome.result, usage: usageFor("structured-spreadsheet") };
    }
  }

  // A digital PDF that draws a real table can sometimes be recovered by
  // geometry (services/import/pdfTable.ts) and read by the same column logic
  // as a spreadsheet. Unlike a spreadsheet, though, a PDF has no cells — the
  // reader infers them from glyph positions, and on a real Work Order that
  // inference goes wrong in ways it cannot detect: 15 pages of terms before
  // the BOQ starts, section headings and "Design Details" narrative that look
  // like rows, "RO" quantities, blank amount cells, and two annexures with
  // their own totals. Rows whose qty and rate happen to be populated still
  // pass the confidence gate, so a wrong read looks exactly like a right one.
  //
  // On Vercel, this path becomes a shortcut: a full AI pass over PDFs is the
  // common timeout culprit, so use the deterministic reader first and avoid
  // the slow model fallback when FAST_PDF_MODE is enabled.
  if ((!isAiConfigured() || FAST_PDF_MODE) && mimeType === "application/pdf" && doc.sourceKind === "pdf-digital") {
    try {
      const grid = await readPdfAsGrid(buffer);
      const outcome = buildOrderFromWorkbook(grid, fileName);
      if (isConfidentTableRead(outcome.result)) {
        return { result: outcome.result, usage: usageFor("structured-pdf-table") };
      }
    } catch (err) {
      console.warn("[ai] structured PDF table read failed, continuing to the AI chain:", err);
    }
    if (FAST_PDF_MODE) {
      return { result: await localOrderResult(doc, buffer, mimeType), usage: usageFor("local-parser-fast-pdf") };
    }
  }

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

/**
 * One page-range slice of a long order document, through the same engine
 * chain.
 *
 * The structured-table shortcuts used by `extractOrderWithFallback` are
 * deliberately absent: chunking only happens for long PDFs on the AI path, and
 * a slice that begins mid-table is precisely the case the geometric reader
 * handles worst — it has no header row to key its columns from.
 *
 * There is no local-engine entry either. A chunked read is only reached when
 * an AI engine is configured; if every engine fails on a slice, the job fails
 * with a clear message rather than silently returning a partial document
 * assembled from whatever the line heuristics could recover.
 */
export async function extractOrderChunkWithFallback(
  doc: IngestedDocument,
  range: { startPage: number; endPage: number; totalPages: number },
  fileName: string
): Promise<ExtractionOutcome<AiOrderResult>> {
  const task = orderChunkTaskText(range.startPage, range.endPage, range.totalPages);

  return withFallback<AiOrderResult>({
    anthropic: () => extractOrderChunkDocument(doc, range),
    openai: async () => {
      const { data, usage } = await callOpenAi<unknown>({
        system: ORDER_SYSTEM_PROMPT,
        task,
        doc,
        fileName,
        schema: ORDER_JSON_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "order_extraction",
      });
      return { result: validateAs(aiOrderResultSchema, data), usage };
    },
    gemini: async () => {
      const { data, usage } = await callGemini<unknown>({
        system: ORDER_SYSTEM_PROMPT,
        task,
        doc,
        schema: ORDER_JSON_SCHEMA as unknown as Record<string, unknown>,
      });
      return { result: validateAs(aiOrderResultSchema, data), usage };
    },
  });
}

export async function extractChallanWithFallback(
  doc: IngestedDocument,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<ExtractionOutcome<AiChallanResult>> {
  // Same rule as orders: a spreadsheet already holds the table, so it is read
  // structurally rather than transcribed by a model.
  if (doc.workbook) {
    const outcome = buildChallanFromWorkbook(doc.workbook, fileName);
    if (outcome.usable) {
      return { result: outcome.result, usage: usageFor("structured-spreadsheet") };
    }
  }

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
