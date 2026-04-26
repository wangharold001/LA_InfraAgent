import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

// =============================================================================
// Tool definitions (Anthropic tool format)
// =============================================================================

const AWS_KB_RETRIEVE_TOOL = {
  name: "aws_kb_retrieve",
  description:
    "Query AWS documentation, CDK references, and best practices. Use before writing or changing complex constructs to get accurate APIs and integration patterns.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query (e.g. 'CDK Lambda Function TypeScript props', 'API Gateway HttpApi Lambda integration', 'DynamoDB TableV2 production settings')",
      },
    },
    required: ["query"],
  },
};

const WRITE_FILE_TOOL = {
  name: "write_file",
  description: "Write a file to the CDK project directory.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path from project root (e.g. 'lib/my-stack.ts')",
      },
      content: { type: "string", description: "Complete file content" },
    },
    required: ["path", "content"],
  },
};

const READ_FILE_TOOL = {
  name: "read_file",
  description:
    "Read an existing file in the CDK project directory. Use during repair to inspect what was written before patching.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path from project root (e.g. 'lib/my-stack.ts')",
      },
    },
    required: ["path"],
  },
};

const DESCRIBE_STACK_EVENTS_TOOL = {
  name: "describe_stack_events",
  description:
    "Get the most recent CloudFormation events for a stack, filtered to *_FAILED entries. Use to understand why `cdk deploy` failed.",
  input_schema: {
    type: "object",
    properties: {
      stackName: { type: "string", description: "CloudFormation stack name" },
      maxItems: {
        type: "number",
        description: "Maximum number of events to scan (default 30)",
      },
    },
    required: ["stackName"],
  },
};

const RUN_CDK_TOOL = {
  name: "run_cdk",
  description:
    "Run a CDK CLI subcommand from the project directory. Allowed: synth, diff, deploy, bootstrap, destroy. Captures and returns stdout/stderr.",
  input_schema: {
    type: "object",
    properties: {
      subcommand: {
        type: "string",
        description:
          "CDK subcommand and args, e.g. 'synth' or 'diff MyStack'. Only the first token is checked against the allow-list.",
      },
    },
    required: ["subcommand"],
  },
};

const PROPOSE_PATCH_TOOL = {
  name: "propose_patch",
  description:
    "Propose a fix for a deployment failure. Provide the COMPLETE new content for each file you want changed. The orchestrator will classify the patch SAFE or RISKY, optionally prompt the user, and only then apply the writes and redeploy. Do NOT use write_file during repair; use this tool instead.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One-line summary of the fix.",
      },
      rationale: {
        type: "string",
        description:
          "Why this fix addresses the failure. Reference the specific error or CloudFormation event.",
      },
      files: {
        type: "array",
        description: "Files to overwrite. Empty list is allowed (e.g. nothing to fix).",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path from project root.",
            },
            newContent: {
              type: "string",
              description: "Complete new file content.",
            },
            riskLevel: {
              type: "string",
              enum: ["safe", "risky"],
              description:
                "Self-assessment. The orchestrator re-classifies independently; this is advisory.",
            },
            reason: {
              type: "string",
              description: "Short reason for changing this file.",
            },
          },
          required: ["path", "newContent"],
        },
      },
    },
    required: ["summary", "rationale", "files"],
  },
};

export const GENERATION_TOOLS = [AWS_KB_RETRIEVE_TOOL, WRITE_FILE_TOOL];
export const REPAIR_TOOLS = [
  AWS_KB_RETRIEVE_TOOL,
  READ_FILE_TOOL,
  DESCRIBE_STACK_EVENTS_TOOL,
  RUN_CDK_TOOL,
  PROPOSE_PATCH_TOOL,
];

// =============================================================================
// Tool dispatcher
// =============================================================================

/**
 * Dispatch a single tool_use block.
 * @param {{name: string, id: string, input: object}} block
 * @param {{outputDir: string, generatedFiles: string[], proposedPatch?: object|null}} ctx
 * @returns {Promise<{tool_use_id: string, content: string, is_error?: boolean}>}
 */
export async function dispatchTool(block, ctx) {
  const { name, id, input } = block;
  try {
    switch (name) {
      case "aws_kb_retrieve":
        return ok(id, await queryAWSDocumentation(input.query || ""));
      case "write_file":
        return ok(id, handleWriteFile(input, ctx));
      case "read_file":
        return ok(id, handleReadFile(input, ctx));
      case "describe_stack_events":
        return ok(
          id,
          await getRecentStackFailureEvents(
            input.stackName,
            Number(input.maxItems) || 30
          )
        );
      case "run_cdk":
        return ok(id, handleRunCdk(input, ctx));
      case "propose_patch":
        ctx.proposedPatch = input;
        return ok(
          id,
          "Patch recorded. The orchestrator will classify it (SAFE/RISKY) and either apply it or ask the user."
        );
      default:
        return err(id, `Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(id, `Tool error in ${name}: ${e.message}`);
  }
}

function ok(id, content) {
  return { tool_use_id: id, content: typeof content === "string" ? content : JSON.stringify(content) };
}
function err(id, msg) {
  return { tool_use_id: id, content: msg, is_error: true };
}

// =============================================================================
// Tool handlers
// =============================================================================

function handleWriteFile(input, ctx) {
  const rel = input.path;
  const filePath = safeJoin(ctx.outputDir, rel);

  let body = String(input.content ?? "");
  if (rel.endsWith(".json")) body = fixInvalidJSON(body);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");

  if (!ctx.generatedFiles.includes(rel)) ctx.generatedFiles.push(rel);
  console.log(`   ✓ ${rel} (${body.length} bytes)`);
  return `Success. File written to ${rel}`;
}

function handleReadFile(input, ctx) {
  const filePath = safeJoin(ctx.outputDir, input.path);
  if (!fs.existsSync(filePath)) return `File not found: ${input.path}`;
  const body = fs.readFileSync(filePath, "utf8");
  // Cap to ~32 KB so we don't blow context with huge files
  return body.length > 32_000
    ? body.slice(0, 32_000) + `\n\n... [truncated, original ${body.length} bytes]`
    : body;
}

function handleRunCdk(input, ctx) {
  const allowed = new Set(["synth", "diff", "deploy", "bootstrap", "destroy"]);
  const tokens = String(input.subcommand || "").trim().split(/\s+/).filter(Boolean);
  const sub = tokens[0];
  if (!allowed.has(sub)) {
    return JSON.stringify({
      exitCode: -1,
      error: `Subcommand not allowed: ${sub}. Allowed: ${[...allowed].join(", ")}`,
    });
  }
  const result = spawnSync("npx", ["cdk", ...tokens], {
    cwd: ctx.outputDir,
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.stringify({
    exitCode: result.status,
    signal: result.signal || null,
    stdout: tail(result.stdout, 8000),
    stderr: tail(result.stderr, 8000),
  });
}

function safeJoin(base, rel) {
  const target = path.resolve(base, rel || "");
  const baseAbs = path.resolve(base);
  if (target !== baseAbs && !target.startsWith(baseAbs + path.sep)) {
    throw new Error(`Path escapes project directory: ${rel}`);
  }
  return target;
}

export function tail(s, n) {
  if (!s) return "";
  return s.length <= n ? s : s.slice(s.length - n);
}

// =============================================================================
// CloudFormation events
// =============================================================================

/**
 * Returns a JSON string of the last failure events for a stack.
 * Tolerant of: AWS CLI missing, stack not yet created, IAM denied.
 */
export async function getRecentStackFailureEvents(stackName, maxItems = 30) {
  if (!stackName) {
    return JSON.stringify({ error: "stackName is required" });
  }
  const result = spawnSync(
    "aws",
    [
      "cloudformation",
      "describe-stack-events",
      "--stack-name",
      stackName,
      "--max-items",
      String(maxItems),
      "--output",
      "json",
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );

  if (result.error) {
    return JSON.stringify({
      error: "aws CLI not available or failed to spawn",
      detail: result.error.message,
    });
  }
  if (result.status !== 0) {
    return JSON.stringify({
      error: "describe-stack-events returned non-zero",
      exitCode: result.status,
      stderr: tail(result.stderr, 1500),
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return result.stdout;
  }
  const events = Array.isArray(parsed.StackEvents) ? parsed.StackEvents : [];
  const failures = events
    .filter((e) => /FAILED$/.test(e.ResourceStatus || ""))
    .slice(0, 10)
    .map((e) => ({
      Timestamp: e.Timestamp,
      LogicalResourceId: e.LogicalResourceId,
      ResourceType: e.ResourceType,
      ResourceStatus: e.ResourceStatus,
      ResourceStatusReason: e.ResourceStatusReason,
    }));
  return JSON.stringify(failures, null, 2);
}

// =============================================================================
// Patch risk classifier
// =============================================================================

const RISKY_PATTERNS = [
  /\biam\.(?:Policy|Role|User|Group|PolicyStatement|ManagedPolicy)/,
  /\bPolicyStatement\b/,
  /\baddToRolePolicy\b/,
  /\bEffect\.ALLOW\b/,
  /\bEffect\.DENY\b/,
  /\baddIngressRule\b/,
  /\bconnections\.allowFrom/,
  /\bconnections\.allowFromAnyIpv4/,
  /\bRemovalPolicy\.RETAIN\b/,
  /\bgrantPrincipal\b/,
  /\bBucketPolicy\b/,
  /\.attachInlinePolicy\b/,
  /\bassumeRolePolicy\b/,
];

/**
 * Classify a propose_patch as SAFE or RISKY based on the *new* file content.
 * The model's self-reported `riskLevel` is treated as advisory (RISKY wins).
 */
export function classifyPatch(files) {
  if (!Array.isArray(files) || files.length === 0) return "SAFE";
  for (const f of files) {
    if (f && f.riskLevel === "risky") return "RISKY";
    const content = String((f && f.newContent) || "");
    for (const re of RISKY_PATTERNS) {
      if (re.test(content)) return "RISKY";
    }
  }
  return "SAFE";
}

// =============================================================================
// JSON repair (used by write_file and post-generation validation)
// =============================================================================

export function fixInvalidJSON(content) {
  content = content.replace(/\/\/.*$/gm, "");
  content = content.replace(/\/\*[\s\S]*?\*\//g, "");
  content = content.replace(/,(\s*[}\]])/g, "$1");
  content = content.split("\n").filter((line) => line.trim()).join("\n");
  return content;
}

// =============================================================================
// AWS docs (built-in fallback used by aws_kb_retrieve)
//
// INTEGRATION WITH AWS MCP SERVER (optional):
// See cli/AWS_MCP_INTEGRATION.md. When `callAWSMCP` is wired here, set
// AWS_MCP_ENABLED=true to prefer live documentation; otherwise the built-in
// snippets below are returned (same shape as the original aws_kb pipeline).
// =============================================================================

async function queryAWSDocumentation(query) {
  console.log(`   📚 Querying AWS docs: "${query}"`);

  const docs = {
    lambda: `
AWS CDK Lambda Function (aws-cdk-lib/aws-lambda):

import * as lambda from 'aws-cdk-lib/aws-lambda';

new lambda.Function(this, 'MyFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda'),
  memorySize: 512,
  timeout: Duration.seconds(30),
  environment: { KEY: 'value' },
  tracing: lambda.Tracing.ACTIVE,
});

Best practices:
- Use Lambda.Runtime constants, not strings
- Set appropriate timeout (default 3s often too low)
- Enable X-Ray tracing for observability
`,
    dynamodb: `
AWS CDK DynamoDB Table (aws-cdk-lib/aws-dynamodb):

import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

new dynamodb.TableV2(this, 'MyTable', {
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
  billing: dynamodb.Billing.onDemand(),
  pointInTimeRecovery: true,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  removalPolicy: RemovalPolicy.RETAIN,
});

table.grantReadWriteData(lambdaFunction);

Best practices:
- Use TableV2 (newer, more features)
- Enable point-in-time recovery for production
- Use on-demand billing unless predictable traffic
- Set RETAIN policy for production data
`,
    apigateway: `
AWS CDK API Gateway (aws-cdk-lib/aws-apigatewayv2):

import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

const api = new apigw.HttpApi(this, 'MyApi', {
  apiName: 'my-api',
  corsPreflight: {
    allowOrigins: ['*'],
    allowMethods: [apigw.CorsHttpMethod.ANY],
    allowHeaders: ['*'],
  },
});

const integration = new HttpLambdaIntegration('FunctionIntegration', fn);
api.addRoutes({
  path: '/items',
  methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST],
  integration,
});
new CfnOutput(this, 'ApiUrl', { value: api.url! });
`,
    s3: `
AWS CDK S3 Bucket (aws-cdk-lib/aws-s3):

import * as s3 from 'aws-cdk-lib/aws-s3';

new s3.Bucket(this, 'MyBucket', {
  versioned: true,
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  removalPolicy: RemovalPolicy.RETAIN,
});

bucket.grantRead(lambdaFunction);

Best practices:
- Always block public access unless specifically needed
- Enable versioning for critical data
- Use lifecycle rules to reduce costs
- Set RETAIN policy for production
`,
    rds: `
AWS CDK RDS Database (aws-cdk-lib/aws-rds):

import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

new rds.DatabaseInstance(this, 'Database', {
  engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15_4 }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  multiAz: true,
  storageEncrypted: true,
  deletionProtection: true,
  removalPolicy: RemovalPolicy.SNAPSHOT,
  backupRetention: Duration.days(7),
});

database.connections.allowFrom(lambdaFunction, ec2.Port.tcp(5432));
`,
    sqs: `
AWS CDK SQS Queue (aws-cdk-lib/aws-sqs):

import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

const queue = new sqs.Queue(this, 'MyQueue', {
  visibilityTimeout: Duration.seconds(300),
  receiveMessageWaitTime: Duration.seconds(20),
  retentionPeriod: Duration.days(4),
  encryption: sqs.QueueEncryption.KMS_MANAGED,
  deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
});

lambdaFunction.addEventSource(new SqsEventSource(queue, { batchSize: 10 }));
queue.grantSendMessages(producer);
queue.grantConsumeMessages(consumer);
`,
    sns: `
AWS CDK SNS Topic (aws-cdk-lib/aws-sns):

import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

const topic = new sns.Topic(this, 'MyTopic', { displayName: 'My Topic' });

topic.addSubscription(new subscriptions.LambdaSubscription(lambdaFunction));
topic.addSubscription(new subscriptions.SqsSubscription(queue));
topic.grantPublish(lambdaFunction);
`,
    vpc: `
AWS CDK VPC (aws-cdk-lib/aws-ec2):

import * as ec2 from 'aws-cdk-lib/aws-ec2';

const vpc = new ec2.Vpc(this, 'MyVPC', {
  cidr: '10.0.0.0/16',
  maxAzs: 2,
  natGateways: 1,
  subnetConfiguration: [
    { name: 'Public',  subnetType: ec2.SubnetType.PUBLIC,             cidrMask: 24 },
    { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
  ],
});

Best practices:
- Use at least 2 AZs for high availability
- Separate public and private subnets
- Minimize NAT Gateways to reduce costs (use 0 for dev)
`,
    cloudfront: `
AWS CDK CloudFront Distribution (aws-cdk-lib/aws-cloudfront):

import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(bucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
  },
  defaultRootObject: 'index.html',
  priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
});
`,
    ec2: `
AWS CDK EC2 Instance (aws-cdk-lib/aws-ec2):

import * as ec2 from 'aws-cdk-lib/aws-ec2';

const instance = new ec2.Instance(this, 'Instance', {
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
  machineImage: ec2.MachineImage.latestAmazonLinux2(),
  // Alternative: new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023 })
  securityGroup,
});

DO NOT use MachineImage.genericLinux({ 'us-east-1': 'ami-...' }) with only one region —
CDK throws "Unable to find AMI in AMI map" when AWS_REGION / stack env is elsewhere.

SecurityGroup descriptions must be ASCII only (no en-dashes, no smart quotes).
`,
    fargate: `
AWS CDK Fargate Service (aws-cdk-lib/aws-ecs-patterns):

import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';

const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
  vpc,
  cpu: 256,
  memoryLimitMiB: 512,
  desiredCount: 2,
  taskImageOptions: {
    image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
    containerPort: 80,
  },
  publicLoadBalancer: true,
});
`,
    alb: `
AWS CDK Application Load Balancer (aws-cdk-lib/aws-elasticloadbalancingv2):

import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
  vpc,
  internetFacing: true,
  vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
});

const listener = alb.addListener('Listener', {
  port: 443,
  protocol: elbv2.ApplicationProtocol.HTTPS,
  certificates: [certificate],
});
`,
    elasticache: `
AWS CDK ElastiCache Redis (aws-cdk-lib/aws-elasticache):

import * as elasticache from 'aws-cdk-lib/aws-elasticache';

const subnetGroup = new elasticache.CfnSubnetGroup(this, 'SubnetGroup', {
  description: 'Redis subnet group',
  subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
});

new elasticache.CfnReplicationGroup(this, 'Redis', {
  replicationGroupDescription: 'Redis cluster',
  engine: 'redis',
  cacheNodeType: 'cache.t3.micro',
  numCacheClusters: 2,
  automaticFailoverEnabled: true,
  cacheSubnetGroupName: subnetGroup.ref,
  atRestEncryptionEnabled: true,
  transitEncryptionEnabled: true,
});
`,
    kinesis: `
AWS CDK Kinesis Stream (aws-cdk-lib/aws-kinesis):

import * as kinesis from 'aws-cdk-lib/aws-kinesis';

new kinesis.Stream(this, 'Stream', {
  shardCount: 1,
  retentionPeriod: Duration.hours(24),
  streamMode: kinesis.StreamMode.PROVISIONED,
});

stream.grantReadWrite(lambdaFunction);
`,
    eventbridge: `
AWS CDK EventBridge (aws-cdk-lib/aws-events):

import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

const bus = new events.EventBus(this, 'Bus', { eventBusName: 'app-events' });

new events.Rule(this, 'Rule', {
  eventBus: bus,
  eventPattern: { source: ['app.orders'] },
  targets: [new targets.LambdaFunction(lambdaFunction)],
});
`,
    stepfunctions: `
AWS CDK Step Functions (aws-cdk-lib/aws-stepfunctions):

import * as sfn from 'aws-cdk-lib/aws-stepfunctions';

const chain = new sfn.Pass(this, 'Start');
new sfn.StateMachine(this, 'Machine', {
  definitionBody: sfn.DefinitionBody.fromChainable(chain),
  timeout: Duration.minutes(5),
});

For Lambda / Choice / Map steps use aws-cdk-lib/aws-stepfunctions-tasks (LambdaInvoke, etc.).
`,
    cognito: `
AWS CDK Cognito UserPool (aws-cdk-lib/aws-cognito):

import * as cognito from 'aws-cdk-lib/aws-cognito';

new cognito.UserPool(this, 'Pool', {
  selfSignUpEnabled: true,
  signInAliases: { email: true },
});
`,
    kms: `
AWS CDK KMS Key (aws-cdk-lib/aws-kms):

import * as kms from 'aws-cdk-lib/aws-kms';

const key = new kms.Key(this, 'Key', { enableKeyRotation: true });
key.grantEncryptDecrypt(lambdaFunction);
`,
    secretsmanager: `
AWS CDK Secrets Manager (aws-cdk-lib/aws-secretsmanager):

import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

const secret = new secretsmanager.Secret(this, 'Secret', { generateSecretString: {} });
secret.grantRead(lambdaFunction);
`,
    route53: `
AWS CDK Route 53 HostedZone (aws-cdk-lib/aws-route53):

import * as route53 from 'aws-cdk-lib/aws-route53';

new route53.HostedZone(this, 'Zone', { zoneName: 'example.com' });
`,
    nlb: `
AWS CDK Network Load Balancer (aws-cdk-lib/aws-elasticloadbalancingv2):

import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

new elbv2.NetworkLoadBalancer(this, 'NLB', {
  vpc,
  internetFacing: true,
});
`,
    efs: `
AWS CDK EFS (aws-cdk-lib/aws-efs):

import * as efs from 'aws-cdk-lib/aws-efs';

new efs.FileSystem(this, 'Fs', { vpc, encrypted: true });
`,
    opensearch: `
AWS CDK OpenSearch Domain (aws-cdk-lib/aws-opensearchservice):

import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';

new opensearch.Domain(this, 'Domain', {
  version: opensearch.EngineVersion.OPENSEARCH_2_11,
  capacity: { dataNodes: 1, dataNodeInstanceType: 't3.small.search' },
});
`,
    documentdb: `
AWS CDK DocumentDB (aws-cdk-lib/aws-docdb):

import * as docdb from 'aws-cdk-lib/aws-docdb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

new docdb.DatabaseCluster(this, 'Cluster', {
  masterUser: { username: 'master' },
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  vpc,
});
`,
    redshift: `
AWS CDK Redshift (aws-cdk-lib/aws-redshift):

import * as redshift from 'aws-cdk-lib/aws-redshift';

new redshift.Cluster(this, 'Warehouse', {
  masterUser: { masterUsername: 'admin' },
  vpc,
  nodeType: redshift.NodeType.DC2_LARGE,
  numberOfNodes: 1,
});
`,
    appsync: `
AWS CDK AppSync GraphqlApi (aws-cdk-lib/aws-appsync):

import * as appsync from 'aws-cdk-lib/aws-appsync';

new appsync.GraphqlApi(this, 'Api', {
  name: 'api',
  schema: appsync.SchemaFile.fromAsset('schema.graphql'),
  authorizationConfig: { defaultAuthorization: { authorizationType: appsync.AuthorizationType.API_KEY } },
});
`,
    waf: `
AWS CDK WAFv2 (aws-cdk-lib/aws-wafv2):

import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

new wafv2.CfnWebACL(this, 'WebAcl', {
  defaultAction: { allow: {} },
  scope: 'REGIONAL',
  visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'acl', sampledRequestsEnabled: true },
});
`,
    acm: `
AWS CDK ACM Certificate (aws-cdk-lib/aws-certificatemanager):

import * as acm from 'aws-cdk-lib/aws-certificatemanager';

new acm.Certificate(this, 'Cert', { domainName: 'example.com', validation: acm.CertificateValidation.fromDns() });
`,
    athena: `
AWS CDK Athena WorkGroup (aws-cdk-lib/aws-athena):

import * as athena from 'aws-cdk-lib/aws-athena';

new athena.CfnWorkGroup(this, 'WG', {
  name: 'primary',
  workGroupConfiguration: { enforceWorkGroupConfiguration: true },
});
`,
    glue: `
AWS CDK Glue Database (aws-cdk-lib/aws-glue):

import * as glue from 'aws-cdk-lib/aws-glue';

new glue.Database(this, 'Db', { databaseName: 'analytics' });
`,
    scheduler: `
AWS CDK EventBridge Scheduler (aws-cdk-lib/aws-scheduler, aws-cdk-lib/aws-scheduler-targets):

import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';

new scheduler.Schedule(this, 'Sched', {
  schedule: scheduler.ScheduleExpression.rate(Duration.hours(1)),
  target: new LambdaInvoke(fn, { /* input, retryPolicy */ }),
});
`,
  };

  const q = (query || "").toLowerCase();
  if (q.includes("lambda") || q.includes("function")) return docs.lambda;
  if (q.includes("dynamodb") || q.includes("table")) return docs.dynamodb;
  if (q.includes("api") || q.includes("gateway")) return docs.apigateway;
  if (q.includes("s3") || q.includes("bucket")) return docs.s3;
  if (q.includes("rds") || q.includes("database")) return docs.rds;
  if (q.includes("sqs") || q.includes("queue")) return docs.sqs;
  if (q.includes("sns") || q.includes("topic")) return docs.sns;
  if (q.includes("vpc") || q.includes("network")) return docs.vpc;
  if (q.includes("cloudfront") || q.includes("cdn")) return docs.cloudfront;
  if (q.includes("ec2") || q.includes("instance") || q.includes("ami") || q.includes("machineimage"))
    return docs.ec2;
  if (q.includes("fargate") || q.includes("ecs")) return docs.fargate;
  if (q.includes("alb") || (q.includes("load balancer") && !q.includes("network"))) return docs.alb;
  if (q.includes("elasticache") || q.includes("redis")) return docs.elasticache;
  if (q.includes("kinesis")) return docs.kinesis;
  if (q.includes("eventbridge") || q.includes("event bus") || q.includes("event-bus")) return docs.eventbridge;
  if (q.includes("step function") || q.includes("stepfunctions") || q.includes("sfn")) return docs.stepfunctions;
  if (q.includes("cognito")) return docs.cognito;
  if (q.includes("kms")) return docs.kms;
  if (q.includes("secret") && q.includes("manager")) return docs.secretsmanager;
  if (q.includes("secretsmanager")) return docs.secretsmanager;
  if (q.includes("route53") || q.includes("hosted zone")) return docs.route53;
  if (q.includes(" nlb") || q === "nlb" || q.includes("network load")) return docs.nlb;
  if (q.includes("efs") || q.includes("elastic file")) return docs.efs;
  if (q.includes("opensearch") || q.includes("elasticsearch")) return docs.opensearch;
  if (q.includes("documentdb") || q.includes("docdb")) return docs.documentdb;
  if (q.includes("redshift")) return docs.redshift;
  if (q.includes("appsync")) return docs.appsync;
  if (q.includes(" waf") || q.includes("web acl")) return docs.waf;
  if (q.includes("acm") || q.includes("certificate manager")) return docs.acm;
  if (q.includes("athena")) return docs.athena;
  if (q.includes("glue")) return docs.glue;
  if (q.includes("aws-scheduler") || q.includes("eventbridge scheduler") || q.includes("scheduler target"))
    return docs.scheduler;
  if (q.includes("scheduler")) return docs.scheduler;

  return `
AWS CDK TypeScript General Best Practices:

Imports:
- Use 'aws-cdk-lib' for all AWS constructs
- Import specific modules: import * as lambda from 'aws-cdk-lib/aws-lambda';
- Import Duration, RemovalPolicy from 'aws-cdk-lib'

Stack:
export class MyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
  }
}

For specific service: query with the service name (Lambda, DynamoDB, S3, etc.)
`;
}
