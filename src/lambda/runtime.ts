import { createPool, PgStore } from "../pg-store.js";
import { validatePolicy } from "../policy.js";
import { createProvider } from "../provider.js";
import { TriageService } from "../service.js";
import type { Policy } from "../types.js";
import policyJson from "../../policy/policy.json";

export type ParamReader = (name: string) => Promise<string>;

/** Reads a (secure) SSM parameter. The SDK ships with the Lambda Node runtime, so it is not bundled. */
export const ssmReader: ParamReader = async (name) => {
  const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
  const out = await new SSMClient({}).send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  if (!out.Parameter?.Value) throw new Error(`SSM parameter ${name} is empty`);
  return out.Parameter.Value;
};

/** DATABASE_URL directly (local testing) or from the SSM parameter named by DATABASE_URL_PARAM. */
export async function resolveDatabaseUrl(env: NodeJS.ProcessEnv, read: ParamReader = ssmReader): Promise<string> {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.DATABASE_URL_PARAM) return read(env.DATABASE_URL_PARAM);
  throw new Error("Set DATABASE_URL or DATABASE_URL_PARAM");
}

export const policy = policyJson as Policy;
validatePolicy(policy);

export interface LambdaRuntime {
  service: TriageService;
  pool: ReturnType<typeof createPool>;
}

let cached: Promise<LambdaRuntime> | null = null;

/** One pool and service per execution environment, created lazily on the first invocation (cold start). */
export function getRuntime(env: NodeJS.ProcessEnv = process.env, read: ParamReader = ssmReader): Promise<LambdaRuntime> {
  cached ??= (async () => {
    const pool = createPool(await resolveDatabaseUrl(env, read));
    const provider = createProvider(env);
    const service = new TriageService({ store: new PgStore(pool), policy, provider });
    return { service, pool };
  })().catch((err) => {
    cached = null; // do not cache a failed cold start
    throw err;
  });
  return cached;
}

export function resetRuntimeForTests(): void {
  cached = null;
}

