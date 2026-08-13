import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { MAX_OUTPUT_TOKENS } from "./config";

/**
 * Thrown when extraction fails for a reason the user can act on (no API key,
 * document rejected, rate limited). API routes surface `.message` directly;
 * anything else is logged and reported generically.
 */
export class AiExtractionError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "AiExtractionError";
    this.retryable = retryable;
  }
}

let cached: Anthropic | null = null;

/**
 * The API key is read from the environment on the server only — it is never
 * sent to, or stored by, the browser. This is the deliberate difference from
 * the HTML prototype, which put the key in localStorage and called
 * api.anthropic.com directly from the page (readable by anyone with the URL).
 */
function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiExtractionError(
      "AI document reading is not configured — set ANTHROPIC_API_KEY on the server."
    );
  }
  if (!cached) cached = new Anthropic({ apiKey, maxRetries: 3 });
  return cached;
}

export interface ExtractionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  model: string;
}

export interface RunExtractionArgs {
  /** Stable, cacheable instructions. Kept byte-identical across calls. */
  system: string;
  /** Document + task blocks. The document block goes first. */
  content: ContentBlockParam[];
  /** JSON Schema the reply is constrained to. Guarantees parseable output. */
  schema: Record<string, unknown>;
  model: string;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
}

export interface RunExtractionResult<T> {
  data: T;
  usage: ExtractionUsage;
}

/**
 * One structured extraction call.
 *
 * Two deliberate choices here, both fixing real failure modes the prototype
 * had:
 *
 *  - **Structured outputs** (`output_config.format`) constrain the reply to
 *    the supplied JSON Schema. The prototype asked for JSON in prose and then
 *    hand-repaired truncated replies (`parseLooseJSON` guessed where to close
 *    the array). That guessing is gone: malformed JSON is no longer possible.
 *  - **Streaming.** `max_tokens` here is large, and on Sonnet 5 it bounds
 *    thinking plus text. A non-streaming request that size risks an HTTP
 *    timeout well before the model is finished.
 */
export async function runExtraction<T>(args: RunExtractionArgs): Promise<RunExtractionResult<T>> {
  const { system, content, schema, model, effort, maxTokens = MAX_OUTPUT_TOKENS } = args;

  const messages: MessageParam[] = [{ role: "user", content }];

  try {
    const stream = client().messages.stream({
      model,
      max_tokens: maxTokens,
      // Cache the instruction block: it is identical on every call for a
      // given document type, so repeat extractions read it at ~10% of input
      // price instead of paying full rate each time.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort, format: { type: "json_schema", schema } },
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new AiExtractionError(
        "The AI declined to read this document. If it is a legitimate business document, please report it."
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new AiExtractionError(
        "This document produced more data than one pass allows. Split it into smaller files and upload them as separate orders.",
        true
      );
    }

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (!text.trim()) {
      throw new AiExtractionError("The AI returned an empty result for this document.", true);
    }

    return {
      // Safe without repair: structured outputs guarantees schema-valid JSON.
      // The caller still runs the payload through Zod as a second net.
      data: JSON.parse(text) as T,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
        model: message.model,
      },
    };
  } catch (err) {
    if (err instanceof AiExtractionError) throw err;
    // Typed SDK exceptions, most specific first — the status code carries the
    // information needed to decide whether a retry could ever succeed.
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AiExtractionError("The Anthropic API key is invalid or expired.");
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      throw new AiExtractionError("This Anthropic API key does not have access to the required model.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AiExtractionError("Anthropic rate limit reached. The job will retry shortly.", true);
    }
    if (err instanceof Anthropic.BadRequestError) {
      // An exhausted credit balance arrives as a 400, not a 402 — it is an
      // account problem rather than anything wrong with the document, so say
      // so plainly instead of blaming the upload the user just made.
      if (/credit balance is too low/i.test(err.message)) {
        throw new AiExtractionError(
          "Automatic reading is unavailable: the Anthropic API credit balance is exhausted. Ask an administrator to top it up in the Anthropic console, then re-upload — you can add the items manually in the meantime."
        );
      }
      throw new AiExtractionError(`The document was rejected by the AI service: ${err.message}`);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new AiExtractionError("Could not reach the Anthropic API. Check the server's network.", true);
    }
    if (err instanceof Anthropic.APIError) {
      throw new AiExtractionError(`AI service error (${err.status ?? "unknown"}). Please try again.`, true);
    }
    throw err;
  }
}
