import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { route } from "../router.js";
import { getRuntime } from "./runtime.js";

/** API Gateway (HTTP API, payload v2) adapter: same router and service as the local Node server. */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const { service } = await getRuntime();
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body) : null;
  const out = await route(service, {
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.queryStringParameters ?? {},
    body,
  });
  return { statusCode: out.status, headers: out.headers, body: out.body, isBase64Encoded: out.isBase64 };
}
