import type { DocPage, DocUnit } from "./types.js";

export interface ParsedDocument {
  pages: DocPage[];
  units: DocUnit[];
}

export function unitsOf(pages: DocPage[]): DocUnit[] {
  return pages.flatMap((p) => p.paragraphs.map((text) => ({ text, page: p.page })));
}

/** Plain text: one paragraph per non-empty line, form feed starts a new page. */
export function parseText(text: string): ParsedDocument {
  const pages = text
    .split("\f")
    .map((chunk, i) => ({
      page: i + 1,
      paragraphs: chunk
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    }))
    .filter((p) => p.paragraphs.length > 0);
  return { pages, units: unitsOf(pages) };
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface PdfJs {
  getDocument(src: Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
      destroy(): Promise<void>;
    }>;
  };
}

let pdfjsPromise: Promise<PdfJs> | null = null;

/** Loads pdfjs lazily. The worker module is registered explicitly so the code also works once bundled for Lambda. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as Record<string, unknown>).pdfjsWorker = worker;
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
  })();
  return pdfjsPromise;
}

const isTextItem = (i: unknown): i is TextItem =>
  typeof i === "object" && i !== null && typeof (i as TextItem).str === "string" && Array.isArray((i as TextItem).transform);

/**
 * Extracts text from a text-based PDF. Items are grouped into visual lines by baseline, and lines are
 * merged into paragraphs by vertical gap, so a sentence wrapped over several lines becomes one unit.
 * Scanned (image-only) PDFs yield no text and are rejected: OCR is out of scope.
 */
export async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  try {
    const pages: DocPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const items = content.items.filter(isTextItem).filter((i) => i.str.trim().length > 0);
      const rows: { y: number; h: number; items: TextItem[] }[] = [];
      for (const it of items) {
        const y = it.transform[5];
        const row = rows.find((r) => Math.abs(r.y - y) < 2);
        if (row) row.items.push(it);
        else rows.push({ y, h: Math.abs(it.transform[3]) || it.height || 10, items: [it] });
      }
      rows.sort((a, b) => b.y - a.y);
      const paragraphs: string[] = [];
      let current: string[] = [];
      let prev: { y: number; h: number } | null = null;
      for (const row of rows) {
        row.items.sort((a, b) => a.transform[4] - b.transform[4]);
        let text = "";
        let endX: number | null = null;
        for (const it of row.items) {
          if (endX !== null && it.transform[4] - endX > 1 && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
          text += it.str;
          endX = it.transform[4] + it.width;
        }
        if (prev && prev.y - row.y > prev.h * 1.45 && current.length) {
          paragraphs.push(current.join(" "));
          current = [];
        }
        current.push(text.replace(/\s+/g, " ").trim());
        prev = { y: row.y, h: row.h };
      }
      if (current.length) paragraphs.push(current.join(" "));
      if (paragraphs.length) pages.push({ page: n, paragraphs });
    }
    if (pages.length === 0) throw new Error("No extractable text in this PDF (scanned documents need OCR, which is not supported)");
    return { pages, units: unitsOf(pages) };
  } finally {
    await doc.destroy();
  }
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/** The whole document as one string, used for verbatim snippet checks (LLM grounding). */
export function fullText(pages: DocPage[]): string {
  return pages.map((p) => p.paragraphs.join("\n")).join("\n");
}
