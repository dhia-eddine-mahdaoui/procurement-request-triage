import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtractionProvider } from "./provider.js";
import { evaluate } from "./policy.js";
import type { Policy, PurchaseRequest } from "./types.js";

export interface RawDocument {
  id: string;
  sourceName: string;
  text: string;
}

/** Runs extraction and policy evaluation for one document and returns a pending purchase request. */
export async function buildRequest(doc: RawDocument, provider: ExtractionProvider, policy: Policy): Promise<PurchaseRequest> {
  const terms = await provider.extract(doc.text);
  const evaluation = evaluate(terms, policy);
  const now = new Date().toISOString();
  return {
    id: doc.id,
    title: terms.vendor.value ? `${terms.vendor.value}` : doc.sourceName,
    sourceName: doc.sourceName,
    text: doc.text,
    extractor: provider.name,
    terms,
    evaluation,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

/** Loads the synthetic sample documents shipped in data/samples. */
export function loadSampleDocuments(dir: string): RawDocument[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => ({
      id: `req-${basename(f, ".txt")}`,
      sourceName: f,
      text: readFileSync(join(dir, f), "utf8"),
    }));
}
