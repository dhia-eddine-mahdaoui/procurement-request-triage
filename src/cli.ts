import { createProvider } from "./provider.js";
import { buildRequest, loadSampleDocuments } from "./ingest.js";
import { loadPolicy } from "./policy.js";
import { formatAmount, formatTerm } from "./format.js";
import { POLICY_FILE, SAMPLES_DIR } from "./paths.js";

/** Offline batch run: extracts and triages every sample document, printing a plain-text report. */
async function main(): Promise<void> {
  const provider = createProvider(process.env);
  const policy = loadPolicy(POLICY_FILE);
  const docs = loadSampleDocuments(SAMPLES_DIR);
  const routes: Record<string, number> = {};

  for (const doc of docs) {
    const r = await buildRequest(doc, provider, policy);
    const t = r.terms;
    routes[r.evaluation.route] = (routes[r.evaluation.route] ?? 0) + 1;
    console.log(`\n[${doc.sourceName}] ${r.title}`);
    console.log(`  total: ${t.amount.value ? formatAmount(t.amount.value) : "not found"} | term: ${formatTerm("termMonths", t.termMonths.value)} | auto-renew: ${formatTerm("autoRenew", t.autoRenew.value)} | notice: ${formatTerm("noticeDays", t.noticeDays.value)}`);
    console.log(`  liability cap: ${formatTerm("liabilityCap", t.liabilityCap.value)} | DPA: ${formatTerm("dpaPresent", t.dpaPresent.value)} | payment: ${formatTerm("paymentTermsDays", t.paymentTermsDays.value)}`);
    console.log(`  route: ${r.evaluation.route} | risk: ${r.evaluation.riskLevel}`);
    for (const f of r.evaluation.flags) console.log(`    - [${f.severity}] ${f.ruleId}: ${f.message}`);
  }
  console.log(`\nProcessed ${docs.length} documents with the "${provider.name}" extractor. Routes: ${JSON.stringify(routes)}`);
}

void main();
