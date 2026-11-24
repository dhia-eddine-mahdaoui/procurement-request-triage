import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createProvider, type ExtractionProvider } from "./provider.js";
import { buildRequest, loadSampleDocuments } from "./ingest.js";
import { loadPolicy } from "./policy.js";
import { FileStore } from "./store.js";
import { DEFAULT_STORE_FILE, POLICY_FILE, SAMPLES_DIR, WEB_DIST } from "./paths.js";
import type { Decision, Policy, RequestStatus } from "./types.js";

const DECISIONS: Record<Decision, RequestStatus> = {
  approve: "approved",
  reject: "rejected",
  request_changes: "changes_requested",
};

const MAX_BODY_BYTES = 256 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface Context {
  store: FileStore;
  policy: Policy;
  provider: ExtractionProvider;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Body must be a JSON object");
  }
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new HttpError(400, `${field} is required`);
  if (value.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return value.trim();
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Context): Promise<void> {
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/api/health") {
    return send(res, 200, { ok: true, extractor: ctx.provider.name, policyVersion: ctx.policy.version });
  }

  if (method === "GET" && path === "/api/requests") {
    return send(res, 200, ctx.store.listRequests());
  }

  if (method === "POST" && path === "/api/requests") {
    const body = await readJson(req);
    const text = requireString(body.text, "text", 200_000);
    const sourceName = typeof body.sourceName === "string" && body.sourceName.trim() ? body.sourceName.trim().slice(0, 120) : "pasted-quote.txt";
    const request = await buildRequest(
      { id: `req-${randomUUID().slice(0, 8)}`, sourceName, text },
      ctx.provider,
      ctx.policy,
    );
    ctx.store.saveRequest(request);
    return send(res, 201, request);
  }

  if (method === "GET" && path === "/api/audit") {
    return send(res, 200, ctx.store.listEvents());
  }

  const match = /^\/api\/requests\/([^/]+)(\/decision)?$/.exec(path);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const request = ctx.store.getRequest(id);
    if (!request) throw new HttpError(404, "Request not found");

    if (method === "GET" && !match[2]) {
      return send(res, 200, { request, events: ctx.store.listEvents(id) });
    }

    if (method === "POST" && match[2]) {
      const body = await readJson(req);
      const action = body.decision;
      if (typeof action !== "string" || !Object.keys(DECISIONS).includes(action)) {
        throw new HttpError(400, "decision must be approve, reject or request_changes");
      }
      const decision = action as Decision;
      const reviewer = requireString(body.reviewer, "reviewer", 80);
      const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
      if (decision !== "approve" && comment.length === 0) {
        throw new HttpError(400, "A comment is required when rejecting or requesting changes");
      }
      const fromStatus = request.status;
      const toStatus = DECISIONS[decision];
      request.status = toStatus;
      request.updatedAt = new Date().toISOString();
      ctx.store.saveRequest(request);
      const event = ctx.store.appendEvent({
        requestId: id,
        reviewer,
        action: decision,
        fromStatus,
        toStatus,
        comment: comment || null,
      });
      return send(res, 200, { request, event });
    }
  }

  throw new HttpError(404, "Not found");
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

export function createApp(ctx: Context) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (path.startsWith("/api/")) await handleApi(req, res, path, ctx);
      else serveStatic(res, path);
    } catch (err) {
      if (err instanceof HttpError) send(res, err.status, { error: err.message });
      else {
        console.error(err);
        send(res, 500, { error: "Internal error" });
      }
    }
  };
}

function seedIfEmpty(store: FileStore, policy: Policy, provider: ExtractionProvider): Promise<void> {
  if (store.listRequests().length > 0) return Promise.resolve();
  const docs = loadSampleDocuments(SAMPLES_DIR);
  return (async () => {
    for (const doc of docs) store.saveRequest(await buildRequest(doc, provider, policy));
    console.log(`Seeded ${docs.length} sample requests`);
  })();
}

async function main(): Promise<void> {
  const provider = createProvider(process.env);
  const policy = loadPolicy(POLICY_FILE);
  const store = new FileStore(process.env.TRIAGE_DB ?? DEFAULT_STORE_FILE);
  await seedIfEmpty(store, policy, provider);

  const port = Number(process.env.TRIAGE_PORT ?? 8787);
  const server = createServer(createApp({ store, policy, provider }));
  server.listen(port, "localhost", () => {
    console.log(`Procurement triage API on http://localhost:${port} (extractor: ${provider.name})`);
  });
}

if (process.argv[1] && /server\.ts$/.test(process.argv[1])) {
  void main();
}
