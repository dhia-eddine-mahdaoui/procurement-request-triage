import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TERM_LABELS, formatTerm } from "../src/format.js";
import { ROOT } from "../src/paths.js";
import { FIELDS, runEval, type EvalReport, type SetSummary } from "./run.js";

const SETS = [
  { key: "dev", title: "Development set", note: "8 documents the rules were written against. A ceiling, not a measure of generalisation." },
  { key: "heldout", title: "Held-out set", note: "14 new documents in different phrasing. Rules were fixed after a first run on this set." },
  { key: "blind", title: "Blind set", note: "8 further documents, written after the rules were frozen (one amount-parser bug it exposed was fixed afterwards). The honest number." },
] as const;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function card(title: string, note: string, s: SetSummary): string {
  return `<section class="card">
    <h2>${title}</h2>
    <p class="note">${note}</p>
    <div class="big">${pct(s.accuracy)}<span>field accuracy</span></div>
    <div class="sub">${s.correct} of ${s.fields} fields correct across ${s.docs} documents</div>
    <dl>
      <div><dt>Precision</dt><dd>${pct(s.precision)}</dd></div>
      <div><dt>Recall</dt><dd>${pct(s.recall)}</dd></div>
      <div><dt>Route agreement</dt><dd>${pct(s.routeAgreement)}</dd></div>
    </dl>
  </section>`;
}

function fieldRows(rep: EvalReport): string {
  return FIELDS.map((f) => {
    const cells = SETS.map(({ key }) => {
      const { correct, total } = rep.summary[key].perField[f];
      const w = total ? (correct / total) * 100 : 0;
      return `<td><div class="bar"><i style="width:${w}%"></i></div><span>${correct}/${total}</span></td>`;
    }).join("");
    return `<tr><th>${TERM_LABELS[f]}</th>${cells}</tr>`;
  }).join("");
}

function errorRows(rep: EvalReport): string {
  const rows: string[] = [];
  for (const c of rep.cases) {
    for (const f of c.fields.filter((x) => x.outcome !== "correct")) {
      rows.push(
        `<tr><td>${esc(c.id)}</td><td>${TERM_LABELS[f.field]}</td><td><span class="tag ${f.outcome}">${f.outcome}</span></td><td>${esc(formatTerm(f.field, f.expected ?? null))}</td><td>${esc(formatTerm(f.field, f.actual ?? null))}</td></tr>`,
      );
    }
  }
  return rows.join("");
}

export function renderReport(rep: EvalReport): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Extraction eval</title>
<style>
:root{--bg:#f4f5f8;--ink:#161a23;--muted:#5d6677;--line:#e2e5ec;--accent:#3b46d9;--ok:#17754a;--bad:#a3232f;--warn:#8a5300}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 "Inter","Segoe UI",system-ui,sans-serif}
main{max-width:1180px;margin:0 auto;padding:2rem 1.5rem 3rem}
h1{margin:0 0 .2rem;font-size:1.6rem}h2{margin:0;font-size:1rem}.lead{color:var(--muted);margin:0 0 1.4rem;max-width:760px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.4rem}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:1.1rem 1.2rem;box-shadow:0 1px 2px rgba(20,26,40,.06)}
.note{color:var(--muted);font-size:.82rem;margin:.2rem 0 .8rem;min-height:2.4em}
.big{font-size:2.5rem;font-weight:750;letter-spacing:-.02em;line-height:1}.big span{display:block;font-size:.78rem;font-weight:500;color:var(--muted);letter-spacing:0;margin-top:.3rem}
.sub{color:var(--muted);font-size:.82rem;margin:.6rem 0 .8rem}
dl{margin:0;display:grid;gap:.3rem}dl div{display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:.35rem}dt{color:var(--muted)}dd{margin:0;font-weight:650;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse}th,td{padding:.5rem .8rem;border-bottom:1px solid var(--line);text-align:left;font-size:.9rem;vertical-align:middle}
thead th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:#fafbfd}
tbody th{font-weight:550}td span{font-variant-numeric:tabular-nums;color:var(--muted);font-size:.82rem;margin-left:.5rem}
.bar{display:inline-block;width:110px;height:8px;border-radius:4px;background:#e8ebf2;vertical-align:middle;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent)}
.tag{display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.74rem;font-weight:650;margin:0}
.tag.missed{background:#fdeccb;color:var(--warn)}.tag.wrong{background:#fbe0e3;color:var(--bad)}.tag.spurious{background:#e3ecfb;color:#1f4fa3}
h3{margin:1.6rem 0 .6rem;font-size:1.05rem}.card.flush{padding:0;overflow:hidden}
.foot{color:var(--muted);font-size:.82rem;margin-top:1rem;max-width:820px}
@media(max-width:860px){.grid{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Extraction eval</h1>
<p class="lead">Field-level accuracy of the rule-based extractor on ${rep.summary.all.docs} labelled synthetic vendor documents. Each document is rendered to a real PDF, parsed back with the production PDF code and compared with hand-written labels for eight fields. A missing value is correct only when the document does not state the term.</p>
<div class="grid">${SETS.map((s) => card(s.title, s.note, rep.summary[s.key])).join("")}</div>
<h3>Correct fields by term</h3>
<section class="card flush"><table><thead><tr><th>Term</th>${SETS.map((s) => `<th>${s.title}</th>`).join("")}</tr></thead><tbody>${fieldRows(rep)}</tbody></table></section>
<h3>Remaining errors (${rep.cases.flatMap((c) => c.fields).filter((f) => f.outcome !== "correct").length})</h3>
<section class="card flush"><table><thead><tr><th>Document</th><th>Term</th><th>Outcome</th><th>Expected</th><th>Extracted</th></tr></thead><tbody>${errorRows(rep)}</tbody></table></section>
<p class="foot">Precision is the share of extracted values that are right; recall the share of stated terms that were found. Route agreement compares the approver route computed from extracted terms with the route computed from the labels.</p>
</main></body></html>`;
}

if (process.argv[1] && /report\.ts$/.test(process.argv[1])) {
  const out = join(ROOT, "docs", "eval-report.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderReport(await runEval()));
  console.log(`Wrote ${out.replace(ROOT + "/", "")}`);
}
