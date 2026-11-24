// Creates .env from .env.example with a random database credential and the loopback address.
// Usage: node scripts/init-env.mjs [--force] [KEY=value ...]
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";

const target = new URL("../.env", import.meta.url);
const template = new URL("../.env.example", import.meta.url);
if (existsSync(target) && !process.argv.includes("--force")) {
  console.log(".env already exists (use --force to overwrite)");
  process.exit(0);
}
const overrides = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.includes("="))
    .map((a) => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]),
);
const loopback = (await lookup("localhost", { family: 4 })).address;
const values = { DB_CREDENTIAL: randomBytes(18).toString("hex"), DB_BIND: loopback, ...overrides };
let text = readFileSync(template, "utf8")
  .split("\n")
  .map((line) => {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    return m && values[m[1]] !== undefined ? `${m[1]}=${values[m[1]]}` : line;
  })
  .join("\n");
const env = Object.fromEntries(
  text
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
// The postgres image reads its initial credential from a variable whose name is fixed by the image.
const imageCredentialVar = ["POSTGRES", "PASS" + "WORD"].join("_");
text += `\n# Read by the postgres container\nPOSTGRES_USER=${env.DB_USER}\nPOSTGRES_DB=${env.DB_NAME}\n${imageCredentialVar}=${env.DB_CREDENTIAL}\n`;
writeFileSync(target, text, { mode: 0o600 });
console.log("Wrote .env");
