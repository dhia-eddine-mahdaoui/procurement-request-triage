import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { TriageStack } from "../lib/triage-stack.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
let t: Template;

beforeAll(() => {
  execFileSync("node", ["scripts/bundle-lambda.mjs"], { cwd: root, stdio: "ignore" });
  const stack = new TriageStack(new App(), "Test", { lambdaCodePath: `${root}dist/lambda` });
  t = Template.fromStack(stack);
}, 60_000);

describe("TriageStack", () => {
  it("defines the three handlers on Node 20", () => {
    for (const handler of ["api.handler", "migrate.handler", "s3-ingest.handler"]) {
      t.hasResourceProperties("AWS::Lambda::Function", { Handler: handler, Runtime: "nodejs20.x" });
    }
  });

  it("routes /api/* from an HTTP API to the API function", () => {
    t.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "ANY /api/{proxy+}" });
  });

  it("triggers ingest for PDFs uploaded under incoming/", () => {
    t.hasResourceProperties("Custom::S3BucketNotifications", {
      NotificationConfiguration: {
        LambdaFunctionConfigurations: [
          Match.objectLike({
            Events: ["s3:ObjectCreated:*"],
            Filter: { Key: { FilterRules: [{ Name: "suffix", Value: ".pdf" }, { Name: "prefix", Value: "incoming/" }] } },
          }),
        ],
      },
    });
  });

  it("keeps buckets private and encrypted and limits ingest concurrency", () => {
    const buckets = t.findResources("AWS::S3::Bucket");
    expect(Object.keys(buckets)).toHaveLength(2);
    for (const b of Object.values(buckets)) {
      expect(b.Properties.PublicAccessBlockConfiguration).toMatchObject({ BlockPublicAcls: true, RestrictPublicBuckets: true });
      expect(b.Properties.BucketEncryption).toBeDefined();
    }
    t.hasResourceProperties("AWS::Lambda::Function", { Handler: "s3-ingest.handler", ReservedConcurrentExecutions: 5 });
  });

  it("grants only ssm:GetParameter on the single database URL parameter", () => {
    const policies = Object.values(t.findResources("AWS::IAM::Policy"));
    const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement as { Action: unknown; Resource: unknown }[]);
    const ssm = statements.filter((s) => s.Action === "ssm:GetParameter");
    expect(ssm.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(ssm)).not.toContain('"*"');
  });

  it("fronts the API and the UI with one CloudFront distribution", () => {
    t.resourceCountIs("AWS::CloudFront::Distribution", 1);
    t.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({ CacheBehaviors: [Match.objectLike({ PathPattern: "/api/*" })] }),
    });
  });
});
