import { extractFromUnits } from "./extract.js";
import { fullText } from "./document.js";
import type { ParsedDocument } from "./document.js";
import type { Amount, DocUnit, Evidence, ExtractedTerms, TermKey } from "./types.js";

export interface ExtractionProvider {
  readonly name: string;
  extract(doc: ParsedDocument): Promise<ExtractedTerms>;
}

/** Default backend: deterministic rules, works fully offline. */
export class RuleProvider implements ExtractionProvider {
  readonly name = "rules";

  async extract(doc: ParsedDocument): Promise<ExtractedTerms> {
    return extractFromUnits(doc.units);
  }
}

const isAmount = (v: unknown): v is Amount =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Amount).amount === "number" &&
  typeof (v as Amount).currency === "string";

const VALIDATORS: Record<TermKey, (v: unknown) => boolean> = {
  vendor: (v) => typeof v === "string" && v.length > 0,
  amount: isAmount,
  termMonths: (v) => typeof v === "number",
  autoRenew: (v) => typeof v === "boolean",
  noticeDays: (v) => typeof v === "number",
  liabilityCap: (v) => v === "unlimited" || isAmount(v),
  dpaPresent: (v) => typeof v === "boolean",
  paymentTermsDays: (v) => typeof v === "number",
};

const SYSTEM_PROMPT = `You extract procurement terms from a vendor quote or contract.
Return one JSON object with exactly these keys: vendor, amount, termMonths, autoRenew, noticeDays,
liabilityCap, dpaPresent, paymentTermsDays. Each key maps to {"value": ..., "snippet": ...}.
"snippet" MUST be a verbatim copy of the sentence or line in the document that supports the value.
Use {"value": null, "snippet": null} when the document does not state the term.
amount: {"amount": number, "currency": "EUR"|"USD"|"GBP"}. liabilityCap: amount object or "unlimited".`;

type RawTerms = Record<string, { value?: unknown; snippet?: unknown } | undefined>;

/**
 * Optional OpenAI-compatible chat endpoint, enabled with TRIAGE_PROVIDER=llm.
 * Output is grounded: a value is kept only if its snippet appears verbatim in the document.
 * The HTTP call is injectable (`fetchImpl`) so request/response handling is tested against a stub;
 * it has not been run against a live model.
 */
export class OpenAICompatibleProvider implements ExtractionProvider {
  readonly name = "llm";

  constructor(
    private readonly cfg: { url: string; model: string; apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async extract(doc: ParsedDocument): Promise<ExtractedTerms> {
    const res = await this.fetchImpl(this.cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: fullText(doc.pages) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM provider returned HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM provider returned an empty response");
    return groundTerms(JSON.parse(content) as RawTerms, doc.units);
  }
}

/** Keeps a model-returned value only if its snippet is a verbatim part of a document unit; adds the page number. */
export function groundTerms(raw: RawTerms, units: DocUnit[]): ExtractedTerms {
  const out = {} as Record<TermKey, Evidence<unknown>>;
  for (const key of Object.keys(VALIDATORS) as TermKey[]) {
    const item = raw[key];
    const snippet = typeof item?.snippet === "string" && item.snippet.trim() ? item.snippet.trim() : null;
    const unit = snippet ? units.find((u) => u.text.includes(snippet)) : undefined;
    const valid = item?.value !== undefined && item.value !== null && VALIDATORS[key](item.value);
    out[key] = unit && valid ? { value: item!.value, snippet: snippet!, page: unit.page } : { value: null, snippet: null, page: null };
  }
  return out as unknown as ExtractedTerms;
}

export function createProvider(env: NodeJS.ProcessEnv = process.env): ExtractionProvider {
  const kind = env.TRIAGE_PROVIDER ?? "rules";
  if (kind === "rules") return new RuleProvider();
  if (kind === "llm") {
    const { TRIAGE_LLM_URL: url, TRIAGE_LLM_MODEL: model, TRIAGE_LLM_KEY: apiKey } = env;
    if (!url || !model || !apiKey) {
      throw new Error("TRIAGE_PROVIDER=llm needs TRIAGE_LLM_URL, TRIAGE_LLM_MODEL and TRIAGE_LLM_KEY");
    }
    return new OpenAICompatibleProvider({ url, model, apiKey });
  }
  throw new Error(`Unknown TRIAGE_PROVIDER "${kind}"`);
}
