import { createHash } from "node:crypto";
import type { S3Event } from "aws-lambda";
import { ServiceError, type TriageService } from "../service.js";
import { getRuntime } from "./runtime.js";

export type ObjectReader = (bucket: string, key: string) => Promise<Uint8Array>;

export const s3Reader: ObjectReader = async (bucket, key) => {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const out = await new S3Client({}).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!out.Body) throw new Error(`Empty S3 object ${key}`);
  return out.Body.transformToByteArray();
};

/**
 * Processes S3 ObjectCreated events: each uploaded PDF becomes a pending request.
 * S3 delivers events at least once, so the request id is derived from bucket, key and etag and a
 * duplicate delivery is recognised (409) and skipped instead of creating a second request.
 */
export async function ingestS3Event(event: S3Event, service: TriageService, read: ObjectReader): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const rec of event.Records) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
    const id = `req-s3-${createHash("sha256").update(`${bucket}/${key}/${rec.s3.object.eTag ?? ""}`).digest("hex").slice(0, 10)}`;
    try {
      const bytes = await read(bucket, key);
      await service.ingest(key.split("/").pop() ?? key, bytes, id);
      created.push(id);
    } catch (err) {
      if (err instanceof ServiceError && err.status === 409) skipped.push(id);
      else if (err instanceof ServiceError && err.status < 500) {
        console.warn(`Skipping ${key}: ${err.message}`); // unreadable upload: do not retry forever
        skipped.push(id);
      } else throw err; // transient failure: let Lambda retry the event
    }
  }
  return { created, skipped };
}

export async function handler(event: S3Event) {
  const { service } = await getRuntime();
  return ingestS3Event(event, service, s3Reader);
}
