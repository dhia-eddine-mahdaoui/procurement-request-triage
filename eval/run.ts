import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePdf } from "../src/document.js";
import { extractFromUnits } from "../src/extract.js";
import { formatTerm } from "../src/format.js";
import { evaluate, loadPolicy } from "../src/policy.js";
import { EVAL_DIR, POLICY_FILE, ROOT } from "../src/paths.js";
import { renderPdf, splitSource } from "../scripts/render-pdf.js";
import type { ExtractedTerms, TermKey } from "../src/types.js";

export const FIELDS: TermKey[] = ["vendor", "amount", "termMonths", "autoRenew", "noticeDays", "liabilityCap", "dpaPresent", "paymentTermsDays"];

interface Case {
  id: string;
  set: "dev" | "heldout" | "blind";
  file?: string;
  lines?: string[];
  labels: Record<TermKey, unknown>;
}

export type Outcome = "correct" | "wrong" | "missed" | "spurious";

export interface FieldResult {
  field: TermKey;
  expected: unknown;
  actual: unknown;
  outcome: Outcome;
}

export interface CaseResult {
  id: string;
  set: Case["set"];
  pages: number;
  fields: FieldResult[];
  routeExpected: string;
  routeActual: string;
}

export interface SetSummary {
  docs: number;
  fields: number;
  correct: number;
  accuracy: number;
  precision: number;
  recall: number;
  routeAgreement: number;
  perField: Record<string, { correct: number; total: number }>;
}

export interface EvalReport {
  cases: CaseResult[];
  summary: Record<"dev" | "heldout" | "blind" | "all", SetSummary>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function judge(expected: unknown, actual: unknown): Outcome {
  if (same(expected, actual)) return "correct";
  if (expected === null || expected === undefined) return "spurious";
  if (actual === null || actual === undefined) return "missed";
  return "wrong";
}

const asTerms = (labels: Record<TermKey, unknown>): ExtractedTerms =>
  Object.fromEntries(FIELDS.map((f) => [f, { value: labels[f] ?? null, snippet: null, page: null }])) as unknown as ExtractedTerms;

function summarize(cases: CaseResult[]): SetSummary {
  const fields = cases.flatMap((c) => c.fields);
  const correct = fields.filter((f) => f.outcome === "correct").length;
  const extracted = fields.filter((f) => f.actual !== null && f.actual !== undefined);
  const labelled = fields.filter((f) => f.expected !== null && f.expected !== undefined);
  const perField: SetSummary["perField"] = {};
  for (const f of FIELDS) {
    const rows = fields.filter((x) => x.field === f);
    perField[f] = { correct: rows.filter((x) => x.outcome === "correct").length, total: rows.length };
  }
  return {
    docs: cases.length,
    fields: fields.length,
    correct,
    accuracy: fields.length ? correct / fields.length : 0,
    precision: extracted.length ? extracted.filter((f) => f.outcome === "correct").length / extracted.length : 0,
    recall: labelled.length ? labelled.filter((f) => f.outcome === "correct").length / labelled.length : 0,
    routeAgreement: cases.length ? cases.filter((c) => c.routeExpected === c.routeActual).length / cases.length : 0,
    perField,
  };
}

/** Renders every case to a PDF, parses it back with the production code path and compares against the labels. */
export async function runEval(): Promise<EvalReport> {
  const cases = JSON.parse(readFileSync(join(EVAL_DIR, "cases.json"), "utf8")) as Case[];
  const policy = loadPolicy(POLICY_FILE);
  const results: CaseResult[] = [];
  for (const c of cases) {
    const source = c.file ? readFileSync(join(ROOT, c.file), "utf8") : c.lines!.join("\n");
    const { title, paragraphs } = splitSource(source);
    const parsed = await parsePdf(new Uint8Array(await renderPdf(title, paragraphs)));
    const terms = extractFromUnits(parsed.units);
    results.push({
      id: c.id,
      set: c.set,
      pages: parsed.pages.length,
      fields: FIELDS.map((field) => ({ field, expected: c.labels[field] ?? null, actual: terms[field].value, outcome: judge(c.labels[field], terms[field].value) })),
      routeExpected: evaluate(asTerms(c.labels), policy).route,
      routeActual: evaluate(terms, policy).route,
    });
  }
  return {
    cases: results,
    summary: { dev: summarize(results.filter((r) => r.set === "dev")), heldout: summarize(results.filter((r) => r.set === "heldout")), blind: summarize(results.filter((r) => r.set === "blind")), all: summarize(results) },
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmt = (f: TermKey, v: unknown) => formatTerm(f, v ?? null);

function printReport(rep: EvalReport): void {
  for (const set of ["dev", "heldout", "blind", "all"] as const) {
    const s = rep.summary[set];
    console.log(`${set.padEnd(8)} docs=${s.docs} fields=${s.correct}/${s.fields} accuracy=${pct(s.accuracy)} precision=${pct(s.precision)} recall=${pct(s.recall)} route-agreement=${pct(s.routeAgreement)}`);
  }
  console.log("\nPer field (held-out):");
  for (const f of FIELDS) console.log(`  ${f.padEnd(17)} ${rep.summary.heldout.perField[f].correct}/${rep.summary.heldout.perField[f].total}`);
  console.log("\nErrors:");
  for (const c of rep.cases) {
    for (const f of c.fields.filter((x) => x.outcome !== "correct")) {
      console.log(`  ${c.id} ${f.field}: ${f.outcome} (expected ${fmt(f.field, f.expected)}, got ${fmt(f.field, f.actual)})`);
    }
    if (c.routeExpected !== c.routeActual) console.log(`  ${c.id} route: expected ${c.routeExpected}, got ${c.routeActual}`);
  }
}

if (process.argv[1] && /run\.ts$/.test(process.argv[1])) {
  const rep = await runEval();
  printReport(rep);
  const out = process.argv.find((a) => a.startsWith("--json="))?.slice(7);
  if (out) writeFileSync(out, JSON.stringify(rep, null, 2));
}
