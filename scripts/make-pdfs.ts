import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { renderPdf, splitSource } from "./render-pdf.js";

/** Renders every .txt in <sourceDir> to a PDF in <outDir>. Usage: tsx scripts/make-pdfs.ts <sourceDir> <outDir> */
const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) throw new Error("Usage: make-pdfs.ts <sourceDir> <outDir>");
mkdirSync(outDir, { recursive: true });

for (const f of readdirSync(srcDir).filter((x) => x.endsWith(".txt")).sort()) {
  const { title, paragraphs } = splitSource(readFileSync(join(srcDir, f), "utf8"));
  writeFileSync(join(outDir, `${basename(f, ".txt")}.pdf`), await renderPdf(title, paragraphs));
}
console.log(`Wrote PDFs to ${outDir}`);
