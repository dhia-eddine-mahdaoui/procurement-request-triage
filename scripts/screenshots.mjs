// Captures README screenshots with headless Chrome. Needs the app running on a fresh seeded database.
// Usage: BASE_URL=http://localhost:8787 node scripts/screenshots.mjs <uploadPdf>
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.env.BASE_URL ?? "http://localhost:8787";
const upload = process.argv[2];
const out = new URL("../docs/screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const shot = (name, opts = {}) => page.screenshot({ path: `${out}${name}.png`, ...opts });
const post = (path, data) => page.request.post(`${base}${path}`, { data });

try {
  // A little history so the list shows more than "pending".
  await post("/api/requests/req-07-quartz-data-feed/decision", { decision: "approve", reviewer: "Alex Morgan", comment: "Within budget, DPA attached." });
  await post("/api/requests/req-04-ironbridge-support/decision", { decision: "reject", reviewer: "Sam Okafor", comment: "No liability cap and no DPA." });

  // 1. Request list
  await page.goto(`${base}/#/`);
  await page.waitForSelector("tr.row");
  await shot("01-request-list");

  // 2. Detail with highlighted source
  await page.goto(`${base}/#/requests/req-03-castor-hosting`);
  await page.waitForSelector(".hl");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("row", { name: /Liability cap/ }).click();
  await page.waitForSelector(".hl.on");
  await page.waitForTimeout(500);
  await shot("02-request-detail");

  // 3. Decision with comment and audit trail
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/#/requests/req-02-kestrel-renewal`);
  await page.waitForSelector(".hl");
  await page.getByPlaceholder("Your name").fill("Priya Nair");
  await page.getByPlaceholder("Reason for the decision").fill("Notice of 14 days on auto-renew is below policy. Ask the vendor for 30 days before we sign.");
  await page.getByRole("button", { name: "Request changes" }).click();
  await page.waitForSelector(".audit blockquote");
  await page.addStyleTag({ content: ".topbar,.detail-grid .col:last-child{position:static!important}" }); // sticky bar would repeat mid-page in a full-page capture
  await shot("03-decision-and-audit", { fullPage: true });

  // 4. Intake
  await page.goto(`${base}/#/new`);
  await page.setInputFiles("input[type=file]", upload);
  await page.waitForSelector(".drop.filled");
  await shot("04-intake-upload");
  await page.getByRole("button", { name: "Extract and triage" }).click();
  await page.waitForSelector(".detail-head h1");
  const title = await page.textContent(".detail-head h1");
  console.log(`Upload created request for: ${title}`);

  // 5. Eval report (static page written by `npm run eval:report`)
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(readFileSync(new URL("../docs/eval-report.html", import.meta.url), "utf8"));
  await shot("05-eval-report", { fullPage: true });
} finally {
  await browser.close();
}
