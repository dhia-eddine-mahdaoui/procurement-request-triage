import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import type { Construct } from "constructs";

export interface TriageStackProps extends StackProps {
  /** Directory with the bundled handlers (`npm run bundle:lambda` writes dist/lambda). */
  lambdaCodePath: string;
  /** Name of the SSM parameter that holds the Postgres connection URL. Created outside this stack. */
  databaseUrlParam?: string;
}

/**
 * Serverless shape of the triage service: HTTP API -> Lambda (same router and service layer as the
 * local server), S3 upload -> Lambda ingest, a migration Lambda, and a static UI behind CloudFront.
 * The Postgres database itself (RDS, Aurora or a managed provider) is provisioned separately and
 * reached through the connection URL stored in SSM.
 */
export class TriageStack extends Stack {
  constructor(scope: Construct, id: string, props: TriageStackProps) {
    super(scope, id, props);
    const dbParam = props.databaseUrlParam ?? "/triage/database-url";

    const documents = new s3.Bucket(this, "DocumentsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const common: Omit<lambda.FunctionProps, "handler"> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      code: lambda.Code.fromAsset(props.lambdaCodePath),
      environment: { DATABASE_URL_PARAM: dbParam, NODE_OPTIONS: "--enable-source-maps" },
    };

    const readDbUrl = new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [this.formatArn({ service: "ssm", resource: "parameter", resourceName: dbParam.replace(/^\//, "") })],
    });

    const api = new lambda.Function(this, "ApiFunction", { ...common, handler: "api.handler", memorySize: 512, timeout: Duration.seconds(29) });
    const migrate = new lambda.Function(this, "MigrateFunction", { ...common, handler: "migrate.handler", memorySize: 256, timeout: Duration.seconds(60) });
    const ingest = new lambda.Function(this, "IngestFunction", {
      ...common,
      handler: "s3-ingest.handler",
      memorySize: 1024, // PDF parsing
      timeout: Duration.seconds(120),
      reservedConcurrentExecutions: 5, // protects the database connection limit
    });
    for (const fn of [api, migrate, ingest]) fn.addToRolePolicy(readDbUrl);

    documents.grantRead(ingest);
    documents.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(ingest), { prefix: "incoming/", suffix: ".pdf" });

    const httpApi = new apigw.HttpApi(this, "HttpApi", { description: "Procurement triage API" });
    httpApi.addRoutes({
      path: "/api/{proxy+}",
      methods: [apigw.HttpMethod.ANY],
      integration: new HttpLambdaIntegration("ApiIntegration", api),
    });

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: false,
    });
    const apiOrigin = new origins.HttpOrigin(Fn.select(2, Fn.split("/", httpApi.apiEndpoint)), { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY });
    const cdn = new cloudfront.Distribution(this, "Cdn", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: new origins.S3Origin(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: apiOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
      },
    });

    new CfnOutput(this, "SiteUrl", { value: `https://${cdn.distributionDomainName}` });
    new CfnOutput(this, "DocumentsBucketName", { value: documents.bucketName });
    new CfnOutput(this, "MigrateFunctionName", { value: migrate.functionName });
  }
}
