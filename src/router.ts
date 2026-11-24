import { ServiceError, type TriageService } from "./service.js";

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  body: string | null;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  /** Text body, or base64 when `isBase64` is set (binary documents). */
  body: string;
  isBase64: boolean;
}

const json = (status: number, data: unknown): ApiResponse => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(data),
  isBase64: false,
});

function parseBody(raw: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError(400, "Body must be a JSON object");
  }
}

/** Maps an HTTP-shaped request onto the service. Shared by the Node server and the Lambda adapter. */
export async function route(service: TriageService, req: ApiRequest): Promise<ApiResponse> {
  try {
    return await dispatch(service, req);
  } catch (err) {
    if (err instanceof ServiceError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: "Internal error" });
  }
}

async function dispatch(service: TriageService, { method, path, query, body }: ApiRequest): Promise<ApiResponse> {
  if (method === "GET" && path === "/api/health") return json(200, service.health());
  if (method === "GET" && path === "/api/requests") return json(200, await service.listRequests(query));
  if (method === "POST" && path === "/api/requests") return json(201, await service.createRequest(parseBody(body)));
  if (method === "GET" && path === "/api/audit") return json(200, await service.audit());

  const m = /^\/api\/requests\/([^/]+)(?:\/(decision|document))?$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === "GET" && !m[2]) return json(200, await service.getRequest(id));
    if (method === "POST" && m[2] === "decision") return json(200, await service.decide(id, parseBody(body)));
    if (method === "GET" && m[2] === "document") {
      const doc = await service.document(id);
      return {
        status: 200,
        headers: {
          "content-type": doc.contentType,
          "content-disposition": `inline; filename="${doc.fileName.replace(/[^\w.\- ]/g, "_")}"`,
        },
        body: Buffer.from(doc.bytes).toString("base64"),
        isBase64: true,
      };
    }
  }
  throw new ServiceError(404, "Not found");
}
