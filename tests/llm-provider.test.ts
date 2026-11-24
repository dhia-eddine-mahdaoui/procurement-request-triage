import { describe, expect, it, vi } from "vitest";
import { parseText } from "../src/document.js";
import { createProvider, OpenAICompatibleProvider } from "../src/provider.js";

const doc = parseText("Vendor: Acme Test Ltd\nTotal: EUR 5,000.00\f\nTerm: 12 months");

function stub(content: unknown, ok = true) {
  return vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) }) as unknown as Response);
}

describe("OpenAI-compatible provider (stubbed HTTP)", () => {
  const cfg = { url: "http://localhost/v1/chat/completions", model: "m", apiKey: "test-token" };

  it("sends the document and grounds the reply against it, including page numbers", async () => {
    const fetchImpl = stub({
      vendor: { value: "Acme Test Ltd", snippet: "Vendor: Acme Test Ltd" },
      termMonths: { value: 12, snippet: "Term: 12 months" },
      amount: { value: { amount: 6000, currency: "EUR" }, snippet: "Total: EUR 6,000.00" }, // invented snippet
    });
    const terms = await new OpenAICompatibleProvider(cfg, fetchImpl as unknown as typeof fetch).extract(doc);
    expect(terms.vendor).toEqual({ value: "Acme Test Ltd", snippet: "Vendor: Acme Test Ltd", page: 1 });
    expect(terms.termMonths.page).toBe(2);
    expect(terms.amount.value).toBeNull();
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(JSON.parse(init.body).messages[1].content).toContain("Total: EUR 5,000.00");
    expect(init.headers.authorization).toBe("Bearer test-token");
  });

  it("fails loudly on HTTP errors and selects providers from the environment", async () => {
    await expect(new OpenAICompatibleProvider(cfg, stub({}, false) as unknown as typeof fetch).extract(doc)).rejects.toThrow(/HTTP 500/);
    expect(createProvider({}).name).toBe("rules");
    expect(() => createProvider({ TRIAGE_PROVIDER: "llm" })).toThrow(/TRIAGE_LLM_URL/);
    expect(() => createProvider({ TRIAGE_PROVIDER: "other" })).toThrow(/Unknown/);
  });
});
