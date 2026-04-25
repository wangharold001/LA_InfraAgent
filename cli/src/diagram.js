function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 8);
}

function toPascalCase(str) {
  return (str || "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(" ").filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

const SERVICE_META = {
  lambda:      { label: "Lambda" },
  ec2:         { label: "EC2" },
  fargate:     { label: "Fargate" },
  rds:         { label: "RDS" },
  dynamodb:    { label: "DynamoDB" },
  s3:          { label: "S3" },
  elasticache: { label: "ElastiCache" },
  sqs:         { label: "SQS" },
  sns:         { label: "SNS" },
  apigateway:  { label: "API Gateway" },
  alb:         { label: "ALB" },
  vpc:         { label: "VPC" },
  cloudfront:  { label: "CloudFront" },
  external:    { label: "External" },
  user:        { label: "User" },
};

const CDK_META = {
  lambda:      { construct: "aws_lambda.Function",                                    module: "aws-cdk-lib/aws-lambda" },
  ec2:         { construct: "aws_ec2.Instance",                                       module: "aws-cdk-lib/aws-ec2" },
  fargate:     { construct: "aws_ecs_patterns.ApplicationLoadBalancedFargateService", module: "aws-cdk-lib/aws-ecs-patterns" },
  rds:         { construct: "aws_rds.DatabaseInstance",                               module: "aws-cdk-lib/aws-rds" },
  dynamodb:    { construct: "aws_dynamodb.TableV2",                                   module: "aws-cdk-lib/aws-dynamodb" },
  s3:          { construct: "aws_s3.Bucket",                                          module: "aws-cdk-lib/aws-s3" },
  elasticache: { construct: "aws_elasticache.CfnReplicationGroup",                    module: "aws-cdk-lib/aws-elasticache" },
  sqs:         { construct: "aws_sqs.Queue",                                          module: "aws-cdk-lib/aws-sqs" },
  sns:         { construct: "aws_sns.Topic",                                          module: "aws-cdk-lib/aws-sns" },
  apigateway:  { construct: "aws_apigatewayv2.HttpApi",                               module: "aws-cdk-lib/aws-apigatewayv2" },
  alb:         { construct: "aws_elasticloadbalancingv2.ApplicationLoadBalancer",     module: "aws-cdk-lib/aws-elasticloadbalancingv2" },
  vpc:         { construct: "aws_ec2.Vpc",                                            module: "aws-cdk-lib/aws-ec2" },
  cloudfront:  { construct: "aws_cloudfront.Distribution",                            module: "aws-cdk-lib/aws-cloudfront" },
  external:    { construct: null, module: null },
  user:        { construct: null, module: null },
};

const NODE_CDK_DEFAULTS = {
  lambda:      { runtime: "NODEJS_20_X", handler: "index.handler", code: "lambda/handler", memorySize: 512, timeout: 29, environment: {}, tracing: "Active", reservedConcurrentExecutions: null, layers: [], vpcRef: null, removalPolicy: "DESTROY" },
  ec2:         { instanceType: "T3_MICRO", machineImage: "AMAZON_LINUX_2023", keyPairName: null, vpcRef: null, associatePublicIpAddress: false, removalPolicy: "DESTROY" },
  fargate:     { cpu: 256, memoryLimitMiB: 512, image: "amazon/amazon-ecs-sample", containerPort: 80, desiredCount: 1, assignPublicIp: false, vpcRef: null, removalPolicy: "DESTROY" },
  rds:         { engine: "POSTGRES", engineVersion: "15.4", instanceClass: "T3", instanceSize: "MICRO", databaseName: "appdb", multiAz: false, storageEncrypted: true, allocatedStorage: 20, deletionProtection: false, vpcRef: null, removalPolicy: "SNAPSHOT" },
  dynamodb:    { partitionKey: { name: "pk", type: "STRING" }, sortKey: null, billingMode: "PAY_PER_REQUEST", stream: "NONE", pointInTimeRecovery: true, encryption: "AWS_MANAGED", gsi: [], removalPolicy: "RETAIN" },
  s3:          { versioned: false, blockPublicAccess: "BLOCK_ALL", encryption: "S3_MANAGED", cors: [], lifecycleRules: [], removalPolicy: "RETAIN", autoDeleteObjects: false },
  elasticache: { engine: "redis", cacheNodeType: "cache.t3.micro", numCacheNodes: 1, automaticFailoverEnabled: false, atRestEncryptionEnabled: true, transitEncryptionEnabled: true, vpcRef: null, removalPolicy: "DESTROY" },
  sqs:         { fifo: false, visibilityTimeout: 30, messageRetentionPeriod: 345600, receiveMessageWaitTime: 0, dlqRef: null, maxReceiveCount: 3, encryption: "KMS_MANAGED", removalPolicy: "DESTROY" },
  sns:         { fifo: false, contentBasedDeduplication: false, masterKey: null, removalPolicy: "DESTROY" },
  apigateway:  { apiType: "HTTP", stageName: "prod", auth: "NONE", cors: true, throttlingBurstLimit: 100, throttlingRateLimit: 50, removalPolicy: "DESTROY" },
  alb:         { internetFacing: true, targetType: "IP", healthCheckPath: "/health", listenerPort: 443, listenerProtocol: "HTTPS", vpcRef: null, removalPolicy: "DESTROY" },
  vpc:         { cidr: "10.0.0.0/16", maxAzs: 2, natGateways: 1, subnetConfiguration: [{ name: "Public", subnetType: "PUBLIC", cidrMask: 24 }, { name: "Private", subnetType: "PRIVATE_WITH_EGRESS", cidrMask: 24 }], removalPolicy: "DESTROY" },
  cloudfront:  { priceClass: "PRICE_CLASS_100", defaultRootObject: "index.html", httpVersion: "HTTP2", certificate: null, webAclId: null, removalPolicy: "DESTROY" },
  external:    { endpoint: "", authType: "NONE" },
  user:        { authType: "COGNITO" },
};

export const EDGE_RELATIONSHIPS = [
  "iam-grant", "event-source-mapping", "subscription",
  "api-integration", "origin", "trigger", "invoke",
  "stream-consumer", "read", "write", "read-write",
];

const MIN_DIST = 300;

export function createDiagram() {
  const state = {
    schemaVersion: "0.2.0",
    metadata: { name: "Untitled", stackName: "", region: "us-east-1", account: "", environment: "dev", createdAt: new Date().toISOString() },
    nodes: [],
    edges: [],
  };

  function autoPlace() {
    const candidates = [];
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 6; col++)
        candidates.push({ x: 80 + col * 200, y: 80 + row * 180 });

    for (const pt of candidates) {
      const tooClose = state.nodes.some(n => {
        const dx = n.x - pt.x, dy = n.y - pt.y;
        return Math.sqrt(dx * dx + dy * dy) < MIN_DIST;
      });
      if (!tooClose) return pt;
    }
    const maxY = state.nodes.reduce((m, n) => Math.max(m, n.y), 0);
    return { x: 80, y: maxY + 220 };
  }

  function executeTool(name, input) {
    switch (name) {
      case "add_node": {
        const pos     = (input.x != null && input.y != null) ? input : autoPlace();
        const type    = input.type in SERVICE_META ? input.type : "external";
        const meta    = SERVICE_META[type];
        const cdkMeta = CDK_META[type] || { construct: null, module: null };
        const label   = input.label || meta.label;
        const n = {
          id: uid("n"), type, label,
          cdkConstruct: cdkMeta.construct,
          cdkModule:    cdkMeta.module,
          cdkId:        input.cdkId || toPascalCase(label),
          notes:        input.notes || "",
          x: Math.round(pos.x / 10) * 10,
          y: Math.round(pos.y / 10) * 10,
          props: { ...(NODE_CDK_DEFAULTS[type] || {}), ...(input.props || {}) },
        };
        state.nodes.push(n);
        return { id: n.id, label: n.label };
      }
      case "add_edge": {
        const src = state.nodes.find(n => n.id === input.from_id);
        const dst = state.nodes.find(n => n.id === input.to_id);
        if (!src) return { error: `Node ${input.from_id} not found` };
        if (!dst) return { error: `Node ${input.to_id} not found` };
        if (src.id === dst.id) return { error: "Cannot connect a node to itself" };
        const e = {
          id: uid("e"), from: src.id, to: dst.id,
          label:        input.label        || "",
          relationship: input.relationship || "invoke",
          iamActions:   input.iamActions   || [],
          cdkMethod:    input.cdkMethod    || "",
          protocol:     input.protocol     || "",
          notes:        input.notes        || "",
        };
        state.edges.push(e);
        return { id: e.id };
      }
      case "clear_diagram":
        state.nodes = []; state.edges = [];
        Object.assign(state.metadata, { name: "Untitled", stackName: "", region: "us-east-1", account: "", environment: "dev", createdAt: new Date().toISOString() });
        return { ok: true };
      case "set_metadata":
        if (input.name)        state.metadata.name        = input.name;
        if (input.stackName)   state.metadata.stackName   = input.stackName;
        if (input.region)      state.metadata.region      = input.region;
        if (input.account)     state.metadata.account     = input.account;
        if (input.environment) state.metadata.environment = input.environment;
        return { ok: true };
      case "remove_object": {
        const ni = state.nodes.findIndex(n => n.id === input.id);
        if (ni !== -1) {
          state.nodes.splice(ni, 1);
          state.edges = state.edges.filter(e => e.from !== input.id && e.to !== input.id);
          return { ok: true, removed: "node" };
        }
        const ei = state.edges.findIndex(e => e.id === input.id);
        if (ei !== -1) { state.edges.splice(ei, 1); return { ok: true, removed: "edge" }; }
        return { error: `No node or edge with id ${input.id}` };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  return { state, executeTool };
}

export const TOOLS = [
  {
    name: "add_node",
    description: "Add an AWS service node. Populate cdkId, props, and notes fully — the props object must contain ALL fields listed in the CDK defaults for that service type so a downstream CDK agent needs zero guesswork.",
    input_schema: {
      type: "object",
      properties: {
        type:  { type: "string", description: "One of: lambda, ec2, fargate, rds, dynamodb, s3, elasticache, sqs, sns, apigateway, alb, vpc, cloudfront, external, user" },
        label: { type: "string", description: "Human-readable display name, e.g. 'User Auth Function'" },
        cdkId: { type: "string", description: "PascalCase CDK construct ID, e.g. 'UserAuthFunction'. Must be unique in the stack." },
        props: {
          type: "object",
          description: "Complete CDK deployment props. Always include ALL fields for the service type — use recommended defaults for anything not specified by the user.",
        },
        notes: { type: "string", description: "1–2 sentences describing this resource's role and any non-obvious configuration decisions." },
        x:     { type: "number", description: "Canvas x position (auto-placed if omitted)" },
        y:     { type: "number", description: "Canvas y position (auto-placed if omitted)" },
      },
      required: ["type", "label", "cdkId"],
    },
  },
  {
    name: "add_edge",
    description: "Connect two nodes. Always specify relationship, iamActions, cdkMethod, and protocol so a CDK agent can generate correct IAM grants and integrations without guessing.",
    input_schema: {
      type: "object",
      properties: {
        from_id:      { type: "string", description: "Source node id" },
        to_id:        { type: "string", description: "Destination node id" },
        label:        { type: "string", description: "Short display label shown on the diagram arrow" },
        relationship: {
          type: "string",
          enum: EDGE_RELATIONSHIPS,
          description: "The AWS relationship type this arrow represents.",
        },
        iamActions: {
          type: "array", items: { type: "string" },
          description: "Explicit IAM action strings, e.g. ['dynamodb:GetItem','dynamodb:PutItem']. Empty array for non-IAM relationships.",
        },
        cdkMethod: { type: "string", description: "Exact CDK L2 method call, e.g. 'table.grantReadWriteData(fn)'" },
        protocol:  { type: "string", description: "Communication mechanism, e.g. 'AWS SDK v3', 'HTTPS', 'SQS trigger'" },
        notes:     { type: "string", description: "Any non-obvious wiring details or ordering constraints." },
      },
      required: ["from_id", "to_id", "relationship"],
    },
  },
  {
    name: "clear_diagram",
    description: "Remove all nodes and edges. Call before building a fresh architecture.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_metadata",
    description: "Set diagram-level deployment metadata used by the CDK agent to initialise the Stack.",
    input_schema: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Human-readable diagram/architecture name" },
        stackName:   { type: "string", description: "CloudFormation stack name, e.g. 'MyAppStack'" },
        region:      { type: "string", description: "AWS region, e.g. 'us-east-1'" },
        account:     { type: "string", description: "AWS account ID (12 digits). Use empty string if unknown." },
        environment: { type: "string", description: "'dev', 'staging', or 'prod'" },
      },
      required: ["name"],
    },
  },
  {
    name: "remove_object",
    description: "Remove a node (and its connected edges) or a single edge by id.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "The id of the node or edge to remove" } },
      required: ["id"],
    },
  },
];
