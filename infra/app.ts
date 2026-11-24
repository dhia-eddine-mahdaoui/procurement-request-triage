// Synthesises the CloudFormation template locally (cdk.out/). It never talks to AWS and deploys nothing.
import { App } from "aws-cdk-lib";
import { fileURLToPath } from "node:url";
import { TriageStack } from "./lib/triage-stack.js";

const app = new App({ outdir: fileURLToPath(new URL("./cdk.out", import.meta.url)) });
new TriageStack(app, "ProcurementTriage", { lambdaCodePath: fileURLToPath(new URL("../dist/lambda", import.meta.url)) });
app.synth();
console.log("Synthesised to infra/cdk.out");
