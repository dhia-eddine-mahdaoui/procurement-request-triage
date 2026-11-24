// Bundles the Lambda handlers with esbuild into dist/lambda (ES modules, Node 20 target).
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/lambda", { recursive: true });
await build({
  entryPoints: { api: "src/lambda/api.ts", migrate: "src/lambda/migrate.ts", "s3-ingest": "src/lambda/s3-ingest.ts" },
  outdir: "dist/lambda",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  minify: false,
  // The AWS SDK v3 is provided by the Lambda Node runtime; pg-native is an optional pg add-on.
  external: ["@aws-sdk/*", "pg-native"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
cpSync("migrations", "dist/lambda/migrations", { recursive: true });
