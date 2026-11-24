import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { looksLikePdf, parsePdf, parseText } from "./document.js";
import type { ParsedDocument } from "./document.js";
import type { ExtractionProvider } from "./provider.js";
import { evaluate } from "./policy.js";
import type { Policy, PurchaseRequest } from "./types.js";

export interface RawDocument {
  id: string;
  sourceName: string;
  bytes: Uint8Array;
}

export interface StoredDocument {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface BuiltRequest {
  request: PurchaseRequest;
  document: StoredDocument;
}

export async function parseDocument(bytes: Uint8Array): Promise<{ parsed: ParsedDocument; sourceType: "pdf" | "text"; contentType: string }> {
  if (looksLikePdf(bytes)) return { parsed: await parsePdf(bytes), sourceType: "pdf", contentType: "application/pdf" };
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.includes("\u0000")) throw new Error("Unsupported file type: upload a PDF or a plain-text file");
  const parsed = parseText(text);
  if (parsed.units.length === 0) throw new Error("The document is empty");
  return { parsed, sourceType: "text", contentType: "text/plain" };
}

/** Parses one document, runs extraction and policy evaluation and returns a pending purchase request. */
export async function buildRequest(doc: RawDocument, provider: ExtractionProvider, policy: Policy): Promise<BuiltRequest> {
  const { parsed, sourceType, contentType } = await parseDocument(doc.bytes);
  const terms = await provider.extract(parsed);
  const evaluation = evaluate(terms, policy);
  const now = new Date().toISOString();
  return {
    request: {
      id: doc.id,
      title: terms.vendor.value ?? doc.sourceName,
      sourceName: doc.sourceName,
      sourceType,
      hasDocument: true,
      pages: parsed.pages,
      extractor: provider.name,
      terms,
      evaluation,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    },
    document: { fileName: doc.sourceName, contentType, bytes: doc.bytes },
  };
}

/** Loads the synthetic sample documents (PDFs by default) shipped in data/samples. */
export function loadSampleDocuments(dir: string, ext = ".pdf"): RawDocument[] {
  return readdirSync(dir)
    .filter((f) => extname(f) === ext)
    .sort()
    .map((f) => ({
      id: `req-${basename(f, ext)}`,
      sourceName: f,
      bytes: new Uint8Array(readFileSync(join(dir, f))),
    }));
}
