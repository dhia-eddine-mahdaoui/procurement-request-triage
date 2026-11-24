import PDFDocument from "pdfkit";

const FIRST_PAGE_PARAGRAPHS = 5;

/**
 * Renders a title and paragraphs as a real, text-based A4 PDF. Long paragraphs wrap over several
 * lines, and longer documents continue on a second page, like a typical quote or order form.
 */
export function renderPdf(title: string, paragraphs: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 72, bottom: 72, left: 64, right: 64 },
      info: { Title: title, Author: "Synthetic sample", CreationDate: new Date("2026-01-01T00:00:00Z") },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica-Bold").fontSize(15).text(title);
    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(11);
    paragraphs.forEach((p, i) => {
      if (paragraphs.length > FIRST_PAGE_PARAGRAPHS + 2 && i === FIRST_PAGE_PARAGRAPHS) {
        doc.addPage();
        doc.font("Helvetica-Bold").fontSize(12).text("General terms (continued)");
        doc.moveDown(1);
        doc.font("Helvetica").fontSize(11);
      }
      doc.text(p, { lineGap: 2, align: "left" });
      doc.moveDown(0.9);
    });
    doc.end();
  });
}

export function splitSource(text: string): { title: string; paragraphs: string[] } {
  const [title, ...paragraphs] = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return { title, paragraphs };
}
