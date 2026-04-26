/**
 * Single source of truth for diagram node types, CDK hints, palette layout,
 * and defaults merged into diagram state. Used by diagram.js (CLI agent),
 * renderer (injected into browser HTML), and buildPaletteHtml().
 */

function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** @type {Record<string, { label: string, short: string, color: string }>} */
export const SERVICE_META = {
  lambda: { label: "Lambda", short: "λ", color: "#EF9F27" },
  ec2: { label: "EC2", short: "EC2", color: "#EF9F27" },
  fargate: { label: "Fargate", short: "Farg", color: "#EF9F27" },
  rds: { label: "RDS", short: "RDS", color: "#378add" },
  dynamodb: { label: "DynamoDB", short: "DDB", color: "#378add" },
  s3: { label: "S3", short: "S3", color: "#1d9e75" },
  elasticache: { label: "ElastiCache", short: "EC", color: "#378add" },
  opensearch: { label: "OpenSearch", short: "OS", color: "#378add" },
  documentdb: { label: "DocumentDB", short: "Doc", color: "#378add" },
  redshift: { label: "Redshift", short: "RS", color: "#378add" },
  efs: { label: "EFS", short: "EFS", color: "#1d9e75" },
  athena: { label: "Athena", short: "Ath", color: "#9467bd" },
  glue: { label: "Glue DB", short: "Glue", color: "#9467bd" },
  sqs: { label: "SQS", short: "SQS", color: "#d85a30" },
  sns: { label: "SNS", short: "SNS", color: "#d85a30" },
  kinesis: { label: "Kinesis", short: "Kin", color: "#d85a30" },
  eventbridge: { label: "EventBridge", short: "EvB", color: "#d85a30" },
  stepfunctions: { label: "Step Functions", short: "SFn", color: "#d85a30" },
  scheduler: { label: "Scheduler", short: "Sch", color: "#d85a30" },
  appsync: { label: "AppSync", short: "AppS", color: "#d85a30" },
  apigateway: { label: "API Gateway", short: "API", color: "#d85a30" },
  alb: { label: "ALB", short: "ALB", color: "#d85a30" },
  nlb: { label: "NLB", short: "NLB", color: "#d85a30" },
  vpc: { label: "VPC", short: "VPC", color: "#888780" },
  cloudfront: { label: "CloudFront", short: "CF", color: "#888780" },
  route53: { label: "Route 53", short: "R53", color: "#888780" },
  waf: { label: "WAF", short: "WAF", color: "#888780" },
  acm: { label: "ACM", short: "ACM", color: "#888780" },
  cognito: { label: "Cognito", short: "Cog", color: "#c45c00" },
  kms: { label: "KMS", short: "KMS", color: "#c45c00" },
  secretsmanager: { label: "Secrets Mgr", short: "Sec", color: "#c45c00" },
  external: { label: "External", short: "Ext", color: "#6b6b64" },
  user: { label: "User", short: "Usr", color: "#6b6b64" },
};

/** @type {Record<string, { construct: string|null, module: string|null }>} */
export const CDK_META = {
  lambda: { construct: "aws_lambda.Function", module: "aws-cdk-lib/aws-lambda" },
  ec2: { construct: "aws_ec2.Instance", module: "aws-cdk-lib/aws-ec2" },
  fargate: { construct: "aws_ecs_patterns.ApplicationLoadBalancedFargateService", module: "aws-cdk-lib/aws-ecs-patterns" },
  rds: { construct: "aws_rds.DatabaseInstance", module: "aws-cdk-lib/aws-rds" },
  dynamodb: { construct: "aws_dynamodb.TableV2", module: "aws-cdk-lib/aws-dynamodb" },
  s3: { construct: "aws_s3.Bucket", module: "aws-cdk-lib/aws-s3" },
  elasticache: { construct: "aws_elasticache.CfnReplicationGroup", module: "aws-cdk-lib/aws-elasticache" },
  opensearch: { construct: "aws_opensearchservice.Domain", module: "aws-cdk-lib/aws-opensearchservice" },
  documentdb: { construct: "aws_docdb.DatabaseCluster", module: "aws-cdk-lib/aws-docdb" },
  redshift: { construct: "aws_redshift.Cluster", module: "aws-cdk-lib/aws-redshift" },
  efs: { construct: "aws_efs.FileSystem", module: "aws-cdk-lib/aws-efs" },
  athena: { construct: "aws_athena.WorkGroup", module: "aws-cdk-lib/aws-athena" },
  glue: { construct: "aws_glue.Database", module: "aws-cdk-lib/aws-glue" },
  sqs: { construct: "aws_sqs.Queue", module: "aws-cdk-lib/aws-sqs" },
  sns: { construct: "aws_sns.Topic", module: "aws-cdk-lib/aws-sns" },
  kinesis: { construct: "aws_kinesis.Stream", module: "aws-cdk-lib/aws-kinesis" },
  eventbridge: { construct: "aws_events.EventBus", module: "aws-cdk-lib/aws-events" },
  stepfunctions: { construct: "aws_stepfunctions.StateMachine", module: "aws-cdk-lib/aws-stepfunctions" },
  scheduler: { construct: "aws_scheduler.Schedule", module: "aws-cdk-lib/aws-scheduler" },
  appsync: { construct: "aws_appsync.GraphqlApi", module: "aws-cdk-lib/aws-appsync" },
  apigateway: { construct: "aws_apigatewayv2.HttpApi", module: "aws-cdk-lib/aws-apigatewayv2" },
  alb: { construct: "aws_elasticloadbalancingv2.ApplicationLoadBalancer", module: "aws-cdk-lib/aws-elasticloadbalancingv2" },
  nlb: { construct: "aws_elasticloadbalancingv2.NetworkLoadBalancer", module: "aws-cdk-lib/aws-elasticloadbalancingv2" },
  vpc: { construct: "aws_ec2.Vpc", module: "aws-cdk-lib/aws-ec2" },
  cloudfront: { construct: "aws_cloudfront.Distribution", module: "aws-cdk-lib/aws-cloudfront" },
  route53: { construct: "aws_route53.HostedZone", module: "aws-cdk-lib/aws-route53" },
  waf: { construct: "aws_wafv2.CfnWebACL", module: "aws-cdk-lib/aws-wafv2" },
  acm: { construct: "aws_certificatemanager.Certificate", module: "aws-cdk-lib/aws-certificatemanager" },
  cognito: { construct: "aws_cognito.UserPool", module: "aws-cdk-lib/aws-cognito" },
  kms: { construct: "aws_kms.Key", module: "aws-cdk-lib/aws-kms" },
  secretsmanager: { construct: "aws_secretsmanager.Secret", module: "aws-cdk-lib/aws-secretsmanager" },
  external: { construct: null, module: null },
  user: { construct: null, module: null },
};

/** Diagram `props` merged with agent overrides — keep JSON-serializable. */
export const NODE_CDK_DEFAULTS = {
  lambda: {
    runtime: "NODEJS_20_X",
    handler: "index.handler",
    code: "lambda/handler",
    memorySize: 512,
    timeout: 29,
    environment: {},
    tracing: "Active",
    reservedConcurrentExecutions: null,
    layers: [],
    vpcRef: null,
    removalPolicy: "DESTROY",
  },
  ec2: {
    instanceType: "T3_MICRO",
    machineImage: "AMAZON_LINUX_2023",
    keyPairName: null,
    vpcRef: null,
    associatePublicIpAddress: false,
    removalPolicy: "DESTROY",
  },
  fargate: {
    cpu: 256,
    memoryLimitMiB: 512,
    image: "amazon/amazon-ecs-sample",
    containerPort: 80,
    desiredCount: 1,
    assignPublicIp: false,
    vpcRef: null,
    removalPolicy: "DESTROY",
  },
  rds: {
    engine: "POSTGRES",
    engineVersion: "15.4",
    instanceClass: "T3",
    instanceSize: "MICRO",
    databaseName: "appdb",
    multiAz: false,
    storageEncrypted: true,
    allocatedStorage: 20,
    deletionProtection: false,
    vpcRef: null,
    removalPolicy: "SNAPSHOT",
  },
  dynamodb: {
    partitionKey: { name: "pk", type: "STRING" },
    sortKey: null,
    billingMode: "PAY_PER_REQUEST",
    stream: "NONE",
    pointInTimeRecovery: true,
    encryption: "AWS_MANAGED",
    gsi: [],
    removalPolicy: "RETAIN",
  },
  s3: {
    versioned: false,
    blockPublicAccess: "BLOCK_ALL",
    encryption: "S3_MANAGED",
    cors: [],
    lifecycleRules: [],
    removalPolicy: "RETAIN",
    autoDeleteObjects: false,
  },
  elasticache: {
    engine: "redis",
    cacheNodeType: "cache.t3.micro",
    numCacheNodes: 1,
    automaticFailoverEnabled: false,
    atRestEncryptionEnabled: true,
    transitEncryptionEnabled: true,
    vpcRef: null,
    removalPolicy: "DESTROY",
  },
  opensearch: {
    version: "OpenSearch_2.11",
    vpcEnabled: false,
    capacityDataNodes: 1,
    capacityDataNodeInstanceType: "t3.small.search",
    zoneAwarenessEnabled: false,
    removalPolicy: "DESTROY",
  },
  documentdb: {
    masterUsername: "docdbadmin",
    instanceCount: 1,
    instanceType: "R5_LARGE",
    vpcRef: null,
    removalPolicy: "SNAPSHOT",
  },
  redshift: {
    masterUsername: "admin",
    clusterType: "single-node",
    nodeType: "dc2.large",
    numberOfNodes: 1,
    vpcRef: null,
    removalPolicy: "SNAPSHOT",
  },
  efs: {
    vpcRef: null,
    encrypted: true,
    lifecyclePolicy: "AFTER_14_DAYS",
    removalPolicy: "DESTROY",
  },
  athena: {
    workGroupName: "primary",
    enforceWorkGroupConfiguration: true,
    resultConfigurationOutputLocation: "s3://your-athena-results-bucket/prefix/",
    removalPolicy: "DESTROY",
  },
  glue: {
    databaseName: "analytics_db",
    description: "",
    locationUri: "",
    removalPolicy: "DESTROY",
  },
  sqs: {
    fifo: false,
    visibilityTimeout: 30,
    messageRetentionPeriod: 345600,
    receiveMessageWaitTime: 0,
    dlqRef: null,
    maxReceiveCount: 3,
    encryption: "KMS_MANAGED",
    removalPolicy: "DESTROY",
  },
  sns: {
    fifo: false,
    contentBasedDeduplication: false,
    masterKey: null,
    removalPolicy: "DESTROY",
  },
  kinesis: {
    streamName: "",
    shardCount: 1,
    retentionPeriodHours: 24,
    streamMode: "PROVISIONED",
    encryption: "MANAGED",
    removalPolicy: "DESTROY",
  },
  eventbridge: {
    eventBusName: "",
    description: "",
    removalPolicy: "DESTROY",
  },
  stepfunctions: {
    stateMachineName: "",
    timeoutMinutes: 5,
    tracingEnabled: true,
    removalPolicy: "DESTROY",
  },
  scheduler: {
    scheduleName: "",
    scheduleExpression: "rate(1 hour)",
    flexibleTimeWindowMode: "OFF",
    removalPolicy: "DESTROY",
  },
  appsync: {
    name: "",
    schemaFilePath: "schema.graphql",
    authorizationConfigDefaultAction: "API_KEY",
    xrayEnabled: false,
    removalPolicy: "DESTROY",
  },
  apigateway: {
    apiType: "HTTP",
    stageName: "prod",
    auth: "NONE",
    cors: true,
    throttlingBurstLimit: 100,
    throttlingRateLimit: 50,
    removalPolicy: "DESTROY",
  },
  alb: {
    internetFacing: true,
    targetType: "IP",
    healthCheckPath: "/health",
    listenerPort: 443,
    listenerProtocol: "HTTPS",
    vpcRef: null,
    removalPolicy: "DESTROY",
  },
  nlb: {
    internetFacing: true,
    crossZoneEnabled: true,
    listenerPort: 443,
    listenerProtocol: "TCP",
    vpcRef: null,
    removalPolicy: "DESTROY",
  },
  vpc: {
    cidr: "10.0.0.0/16",
    maxAzs: 2,
    natGateways: 1,
    subnetConfiguration: [
      { name: "Public", subnetType: "PUBLIC", cidrMask: 24 },
      { name: "Private", subnetType: "PRIVATE_WITH_EGRESS", cidrMask: 24 },
    ],
    removalPolicy: "DESTROY",
  },
  cloudfront: {
    priceClass: "PRICE_CLASS_100",
    defaultRootObject: "index.html",
    httpVersion: "HTTP2",
    certificate: null,
    webAclId: null,
    removalPolicy: "DESTROY",
  },
  route53: {
    zoneName: "example.com",
    comment: "",
    isPrivate: false,
    vpcRef: null,
    removalPolicy: "DESTROY",
  },
  waf: {
    name: "",
    scope: "REGIONAL",
    defaultAction: "allow",
    removalPolicy: "DESTROY",
  },
  acm: {
    domainName: "example.com",
    validationMethod: "DNS",
    removalPolicy: "DESTROY",
  },
  cognito: {
    userPoolName: "",
    selfSignUpEnabled: true,
    signInWithEmail: true,
    mfa: "OPTIONAL",
    removalPolicy: "DESTROY",
  },
  kms: {
    description: "",
    enableKeyRotation: true,
    removalPolicy: "DESTROY",
  },
  secretsmanager: {
    secretName: "",
    description: "",
    generateSecretString: true,
    removalPolicy: "DESTROY",
  },
  external: { endpoint: "", authType: "NONE" },
  user: { authType: "COGNITO" },
};

export const EDGE_RELATIONSHIPS = [
  "iam-grant",
  "event-source-mapping",
  "subscription",
  "api-integration",
  "origin",
  "trigger",
  "invoke",
  "stream-consumer",
  "read",
  "write",
  "read-write",
];

/** Palette sections: collapsible groups, two-column grid in UI */
export const PALETTE_GROUPS = [
  { title: "Compute", types: ["lambda", "ec2", "fargate"] },
  {
    title: "Data",
    types: ["rds", "dynamodb", "s3", "elasticache", "opensearch", "documentdb", "redshift", "efs", "athena", "glue"],
  },
  {
    title: "Integration",
    types: ["sqs", "sns", "kinesis", "eventbridge", "stepfunctions", "scheduler", "appsync"],
  },
  {
    title: "Network",
    types: ["vpc", "cloudfront", "apigateway", "alb", "nlb", "route53", "waf", "acm"],
  },
  { title: "Identity & secrets", types: ["cognito", "kms", "secretsmanager"] },
  { title: "Other", types: ["external", "user"] },
];

export function buildPaletteHtml() {
  let html = "";
  for (const g of PALETTE_GROUPS) {
    html += `<details class="palette-group" open><summary class="palette-summary">${escapeHtmlAttr(g.title)}</summary><div class="palette-grid">`;
    for (const t of g.types) {
      const m = SERVICE_META[t];
      if (!m) continue;
      const title = escapeHtmlAttr(m.label);
      const short = escapeHtmlAttr(m.short);
      html += `<div class="palette-item" draggable="true" data-type="${t}" title="${title}"><span class="palette-swatch" style="background:${escapeHtmlAttr(m.color)}"></span><span class="palette-label">${short}</span></div>`;
    }
    html += `</div></details>`;
  }
  return html;
}

export function getDiagramServicePack() {
  return {
    SERVICE_META,
    CDK_META,
    NODE_CDK_DEFAULTS,
    EDGE_RELATIONSHIPS,
  };
}

/** Comma-separated list for Anthropic tool / prompt descriptions */
export const VALID_NODE_TYPES_PROMPT = Object.keys(SERVICE_META).sort().join(", ");
