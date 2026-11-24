/// <reference lib="dom" />
// Records the end-to-end flow in headless Chrome and converts it to docs/demo.gif (+ docs/demo.mp4).
// Needs the app running on a freshly seeded database and an ffmpeg binary:
//   python3 -m venv .venv-ffmpeg && .venv-ffmpeg/bin/pip install imageio-ffmpeg
// Usage: BASE_URL=http://localhost:8787 npm run demo:record
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { renderPdf, splitSource } from "./render-pdf.js";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const base = process.env.BASE_URL ?? "http://localhost:8787";
const work = join(root, "dist", "demo");
mkdirSync(work, { recursive: true });
mkdirSync(join(root, "docs"), { recursive: true });

function ffmpegPath(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const py = join(root, ".venv-ffmpeg", "bin", "python");
  if (!existsSync(py)) throw new Error("No ffmpeg: set FFMPEG or create .venv-ffmpeg (see header comment)");
  return execFileSync(py, ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim();
}

// The quote that gets uploaded in the recording (fictional vendor).
const quote = splitSource(readFileSync(join(root, "scripts", "demo-quote.txt"), "utf8"));
const pdfPath = join(work, "Halberd-analytics-quote.pdf");
writeFileSync(pdfPath, await renderPdf(quote.title, quote.paragraphs));

const W = 1200;
const H = 720;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: work, size: { width: W, height: H } } });
const page = await ctx.newPage();

// Headless video has no mouse pointer: draw one, plus a ripple on click.
await page.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.style.cssText = "position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(20,20,30,.75);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none;left:-50px;top:-50px;transition:transform .12s";
    document.body.appendChild(dot);
    addEventListener("mousemove", (e) => {
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
    });
    addEventListener("mousedown", (e) => {
      dot.style.transform = "scale(.7)";
      const r = document.createElement("div");
      r.style.cssText = `position:fixed;z-index:99998;left:${e.clientX}px;top:${e.clientY}px;width:10px;height:10px;margin:-5px;border-radius:50%;border:3px solid #3b46d9;pointer-events:none;transition:all .5s;opacity:.9`;
      document.body.appendChild(r);
      requestAnimationFrame(() => Object.assign(r.style, { width: "54px", height: "54px", margin: "-27px", opacity: "0" }));
      setTimeout(() => r.remove(), 600);
    });
    addEventListener("mouseup", () => (dot.style.transform = ""));
  });
});

const pause = (ms: number) => page.waitForTimeout(ms);
async function click(locator: ReturnType<typeof page.locator>) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await pause(250);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function smoothScroll(y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
  await pause(900);
}

try {
  await page.goto(`${base}/#/`);
  await page.waitForSelector("tr.row");
  await page.mouse.move(W / 2, 300);
  await pause(1400);

  await click(page.getByRole("link", { name: "+ New request" }));
  await page.waitForSelector(".drop");
  await pause(700);
  await page.setInputFiles("input[type=file]", pdfPath);
  await pause(1300);
  await click(page.getByRole("button", { name: "Extract and triage" }));

  await page.waitForSelector(".hl");
  await pause(1800);
  for (const label of [/Liability cap/, /Notice period/, /Data processing agreement/]) {
    await click(page.getByRole("row", { name: label }));
    await pause(1500);
  }
  await smoothScroll(520); // risk flags and route
  await pause(1500);

  await click(page.getByPlaceholder("Your name"));
  await page.keyboard.type("Priya Nair", { delay: 70 });
  await click(page.getByPlaceholder("Reason for the decision"));
  await page.keyboard.type("Auto-renew notice is only 14 days and no DPA. Please ask the vendor to fix both.", { delay: 35 });
  await pause(500);
  await click(page.getByRole("button", { name: "Request changes" }));
  await page.waitForSelector(".audit blockquote");
  await smoothScroll(2000);
  await pause(1800);

  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await click(page.getByRole("link", { name: "Audit log" }));
  await page.waitForSelector(".audit li");
  await pause(2200);
} finally {
  await ctx.close();
  await browser.close();
}

const webm = readdirSync(work).filter((f) => f.endsWith(".webm")).map((f) => join(work, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const ff = ffmpegPath();
const mp4 = join(root, "docs", "demo.mp4");
const gif = join(root, "docs", "demo.gif");
const palette = join(work, "palette.png");
const filters = "setpts=PTS/1.55,fps=8,scale=880:-1:flags=lanczos"; // 1.55x speed-up keeps the GIF near 23 s
execFileSync(ff, ["-y", "-loglevel", "error", "-i", webm, "-vf", filters + ",palettegen=max_colors=64:stats_mode=diff", palette]);
execFileSync(ff, ["-y", "-loglevel", "error", "-i", webm, "-i", palette, "-lavfi", filters + "[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle", "-loop", "0", gif]);
execFileSync(ff, ["-y", "-loglevel", "error", "-i", webm, "-vf", "setpts=PTS/1.55,scale=960:-2,fps=24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30", "-movflags", "+faststart", mp4]);
renameSync(webm, join(work, "last-recording.webm"));
console.log(`Wrote docs/demo.gif (${(statSync(gif).size / 1048576).toFixed(2)} MB) and docs/demo.mp4 (${(statSync(mp4).size / 1048576).toFixed(2)} MB)`);
