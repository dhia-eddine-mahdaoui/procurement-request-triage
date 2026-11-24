import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { createRuntime, seedSamples } from "./bootstrap.js";
import { loadEnvFile } from "./config.js";
import { MAX_UPLOAD_BYTES, type TriageService } from "./service.js";
import { route } from "./router.js";
import { WEB_DIST } from "./paths.js";

const MAX_BODY_BYTES = Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 4096; // base64 overhead
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return "__too_large__";
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : null;
}

function serveStatic(res: ServerResponse, path: string): void {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("UI not built. Run `npm run build:web`, or use `npm run dev:web` (Vite dev server).");
    return;
  }
  const rel = path === "/" ? "index.html" : path.slice(1);
  let file = normalize(join(WEB_DIST, rel));
  if (!file.startsWith(WEB_DIST + sep) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(WEB_DIST, "index.html"); // SPA fallback
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

export function createApp(service: TriageService) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return serveStatic(res, url.pathname);
    const raw = await readBody(req);
    if (raw === "__too_large__") {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large" }));
      return;
    }
    const out = await route(service, {
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: raw,
    });
    res.writeHead(out.status, out.headers);
    res.end(out.isBase64 ? Buffer.from(out.body, "base64") : out.body);
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  const rt = await createRuntime(process.env);
  if ((await rt.store.count()) === 0 && process.env.TRIAGE_SEED !== "0") {
    console.log(`Seeded ${await seedSamples(rt)} sample requests`);
  }
  const port = Number(process.env.TRIAGE_PORT ?? 8787);
  const server = createServer((req, res) => {
    createApp(rt.service)(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error" }));
    });
  });
  server.listen(port, "localhost", () => {
    console.log(`Procurement triage on http://localhost:${port} (store: ${rt.storeKind}, extractor: ${rt.provider.name})`);
  });
  const stop = () => server.close(() => void rt.store.close().then(() => process.exit(0)));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && /server\.ts$/.test(process.argv[1])) {
  void main();
}
