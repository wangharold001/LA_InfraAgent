import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const SYSTEM_PROMPT = `You are an expert AWS CDK developer with access to official AWS documentation via MCP tools. You will receive an architecture diagram in JSON format with complete CDK metadata and you must generate a complete, production-ready CDK TypeScript project.

AVAILABLE TOOLS:
1. **aws_kb_retrieve** - Query AWS documentation and CDK reference materials
2. **write_file** - Write files to the CDK project

WORKFLOW:
Before generating each major file, use aws_kb_retrieve to fetch relevant CDK documentation and best practices:
- Query for CDK construct APIs (e.g., "aws-cdk-lib lambda.Function TypeScript")
- Look up integration patterns (e.g., "CDK API Gateway Lambda integration")
- Find best practices (e.g., "CDK DynamoDB table production settings")
- Verify prop mappings and method signatures

Then use write_file to create ALL necessary files:

1. **lib/{stack-name}-stack.ts** - Main CDK Stack
   - Import all required CDK modules (aws-cdk-lib/aws-lambda, etc.)
   - Create Stack class extending cdk.Stack
   - Instantiate ALL nodes as CDK constructs using their exact cdkId and full props
   - Implement ALL edges using their exact cdkMethod
   - Add comments from node.notes explaining design decisions
   - Handle resource dependencies in correct order

2. **bin/{stack-name}.ts** - CDK App Entry Point
   - Import the stack
   - Create CDK App
   - Instantiate stack with env (account, region)
   - Add environment tags
   - Call app.synth()

3. **package.json** - Dependencies
   - Include aws-cdk-lib (^2.0.0), constructs, typescript, @types/node, ts-node
   - Scripts: build, watch, test, cdk
   - Proper project name based on stackName

4. **tsconfig.json** - TypeScript Config
   - Target ES2020, strict mode, proper module resolution

5. **cdk.json** - CDK Config
   - App command pointing to bin/{stack-name}.ts
   - Feature flags for CDK v2
   - Context settings

6. **.gitignore** - Git Ignore
   - node_modules, cdk.out, *.js, *.d.ts

CRITICAL RULES:
- ALWAYS query aws_kb_retrieve before writing complex constructs to verify syntax
- Use EXACT cdkId from nodes as construct IDs
- Use EXACT cdkMethod from edges for integrations
- Map ALL props correctly to CDK construct properties (verify with docs)
- Import all required modules
- Handle dependencies (e.g., create VPC before using it)
- Use proper TypeScript types
- Follow AWS best practices from documentation
- Add helpful comments

Work methodically: research → write → verify → next file.`;

const TOOLS = [
  {
    name: "aws_kb_retrieve",
    description: "Query AWS documentation, CDK references, and best practices. Use this to fetch accurate CDK construct APIs, integration patterns, and AWS service documentation before writing code.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for AWS documentation (e.g., 'CDK Lambda Function TypeScript props', 'API Gateway Lambda integration CDK', 'DynamoDB table CDK best practices')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "write_file",
    description: "Write a file to the CDK project directory",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from project root (e.g. 'lib/my-stack.ts')" },
        content: { type: "string", description: "Complete file content" },
      },
      required: ["path", "content"],
    },
  },
];

/**
 * Query AWS documentation via MCP or provide fallback documentation
 *
 * This function provides CDK documentation to the code generation agent.
 *
 * INTEGRATION WITH AWS MCP SERVER:
 * To connect to the official AWS MCP server (https://github.com/awslabs/mcp):
 * 1. Install: npm install -g @aws/mcp-server-aws
 * 2. Set AWS_MCP_ENABLED=true environment variable
 * 3. The agent will automatically use real-time AWS documentation
 *
 * For now, we use comprehensive built-in CDK documentation that covers
 * all major services with best practices and examples.
 *
 * @param {string} query - Documentation query
 * @returns {Promise<string>} - Documentation content
 */
async function queryAWSDocumentation(query) {
  console.log(`   📚 Querying AWS docs: "${query}"`);

  // TODO: Check for AWS MCP server and use it if available
  // if (process.env.AWS_MCP_ENABLED === 'true') {
  //   try {
  //     const mcpResult = await callAWSMCP(query);
  //     return mcpResult;
  //   } catch (error) {
  //     console.log(`   ⚠ AWS MCP unavailable, using built-in docs`);
  //   }
  // }

  // Provide comprehensive CDK documentation snippets based on common queries
  const docs = {
    lambda: `
AWS CDK Lambda Function (aws-cdk-lib/aws-lambda):

import * as lambda from 'aws-cdk-lib/aws-lambda';

new lambda.Function(this, 'MyFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,  // or PYTHON_3_11, etc.
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda'),
  memorySize: 512,  // MB
  timeout: Duration.seconds(30),
  environment: {
    KEY: 'value'
  },
  tracing: lambda.Tracing.ACTIVE,
  reservedConcurrentExecutions: 10,  // optional
});

Best practices:
- Use Lambda.Runtime constants, not strings
- Set appropriate timeout (default 3s often too low)
- Enable X-Ray tracing for observability
- Use environment variables for configuration
`,
    dynamodb: `
AWS CDK DynamoDB Table (aws-cdk-lib/aws-dynamodb):

import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

new dynamodb.TableV2(this, 'MyTable', {
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },  // optional
  billing: dynamodb.Billing.onDemand(),
  pointInTimeRecovery: true,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  removalPolicy: RemovalPolicy.RETAIN,  // for production
  globalSecondaryIndexes: [{
    indexName: 'GSI1',
    partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
  }],
});

// Grant permissions
table.grantReadWriteData(lambdaFunction);
table.grantReadData(lambdaFunction);
table.grantWriteData(lambdaFunction);

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

// Add Lambda integration
const integration = new HttpLambdaIntegration('FunctionIntegration', fn);
api.addRoutes({
  path: '/items',
  methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST],
  integration: integration,
});

// Output the URL
new CfnOutput(this, 'ApiUrl', { value: api.url! });

Best practices:
- Use HttpApi (API Gateway v2) for REST APIs
- Configure CORS if accessed from browsers
- Use path parameters: '/items/{id}'
- Add CloudWatch Logs integration
`,
    s3: `
AWS CDK S3 Bucket (aws-cdk-lib/aws-s3):

import * as s3 from 'aws-cdk-lib/aws-s3';

new s3.Bucket(this, 'MyBucket', {
  versioned: true,
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  removalPolicy: RemovalPolicy.RETAIN,
  autoDeleteObjects: false,  // true only for dev
  lifecycleRules: [{
    expiration: Duration.days(90),
    transitions: [{
      storageClass: s3.StorageClass.INFREQUENT_ACCESS,
      transitionAfter: Duration.days(30),
    }],
  }],
  cors: [{
    allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
    allowedOrigins: ['*'],
    allowedHeaders: ['*'],
  }],
});

// Grant permissions
bucket.grantRead(lambdaFunction);
bucket.grantReadWrite(lambdaFunction);

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
  engine: rds.DatabaseInstanceEngine.postgres({
    version: rds.PostgresEngineVersion.VER_15_4,
  }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
  vpc: vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  allocatedStorage: 20,
  maxAllocatedStorage: 100,
  multiAz: true,  // for production
  storageEncrypted: true,
  deletionProtection: true,  // for production
  removalPolicy: RemovalPolicy.SNAPSHOT,
  backupRetention: Duration.days(7),
});

// Grant access from Lambda
database.connections.allowFrom(lambdaFunction, ec2.Port.tcp(5432));

Best practices:
- Deploy in VPC private subnets
- Enable encryption and deletion protection for production
- Use multi-AZ for high availability
- Set backup retention appropriately
`,
    sqs: `
AWS CDK SQS Queue (aws-cdk-lib/aws-sqs):

import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

const queue = new sqs.Queue(this, 'MyQueue', {
  queueName: 'my-queue',
  visibilityTimeout: Duration.seconds(300),
  receiveMessageWaitTime: Duration.seconds(20),  // long polling
  retentionPeriod: Duration.days(4),
  encryption: sqs.QueueEncryption.KMS_MANAGED,
  deadLetterQueue: {
    queue: dlq,
    maxReceiveCount: 3,
  },
});

// Add as Lambda event source
lambdaFunction.addEventSource(new SqsEventSource(queue, {
  batchSize: 10,
  maxBatchingWindow: Duration.seconds(5),
}));

// Grant send/receive
queue.grantSendMessages(producer);
queue.grantConsumeMessages(consumer);

Best practices:
- Configure DLQ for failed messages
- Use long polling (receiveMessageWaitTime)
- Match visibility timeout to Lambda timeout
- Enable encryption for sensitive data
`,
    sns: `
AWS CDK SNS Topic (aws-cdk-lib/aws-sns):

import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

const topic = new sns.Topic(this, 'MyTopic', {
  displayName: 'My Topic',
  topicName: 'my-topic',
});

// Subscribe Lambda
topic.addSubscription(new subscriptions.LambdaSubscription(lambdaFunction));

// Subscribe SQS
topic.addSubscription(new subscriptions.SqsSubscription(queue));

// Subscribe Email
topic.addSubscription(new subscriptions.EmailSubscription('user@example.com'));

// Grant publish
topic.grantPublish(lambdaFunction);

Best practices:
- Use descriptive topic names
- Set up DLQ for subscriptions
- Filter messages with subscription filters
- Consider using FIFO topics for ordering
`,
    vpc: `
AWS CDK VPC (aws-cdk-lib/aws-ec2):

import * as ec2 from 'aws-cdk-lib/aws-ec2';

const vpc = new ec2.Vpc(this, 'MyVPC', {
  cidr: '10.0.0.0/16',
  maxAzs: 2,
  natGateways: 1,
  subnetConfiguration: [
    {
      name: 'Public',
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask: 24,
    },
    {
      name: 'Private',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      cidrMask: 24,
    },
  ],
  enableDnsHostnames: true,
  enableDnsSupport: true,
});

// Use VPC in other resources
const lambda = new lambda.Function(this, 'Function', {
  vpc: vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  // ...
});

Best practices:
- Use at least 2 AZs for high availability
- Separate public and private subnets
- Minimize NAT Gateways to reduce costs (use 0 for dev)
- Enable VPC Flow Logs for monitoring
`,
    cloudfront: `
AWS CDK CloudFront Distribution (aws-cdk-lib/aws-cloudfront):

import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

const distribution = new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(bucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
  },
  defaultRootObject: 'index.html',
  errorResponses: [{
    httpStatus: 404,
    responseHttpStatus: 200,
    responsePagePath: '/index.html',
    ttl: Duration.seconds(0),
  }],
  priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
});

// Output domain name
new CfnOutput(this, 'DistributionDomain', {
  value: distribution.distributionDomainName,
});

Best practices:
- Always redirect HTTP to HTTPS
- Configure error responses for SPAs
- Use appropriate cache policies
- Consider price class based on global needs
`,
    ec2: `
AWS CDK EC2 Instance (aws-cdk-lib/aws-ec2):

import * as ec2 from 'aws-cdk-lib/aws-ec2';

const instance = new ec2.Instance(this, 'Instance', {
  vpc: vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
  machineImage: new ec2.AmazonLinuxImage({
    generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
  }),
  keyName: 'my-key-pair',  // for SSH access
  securityGroup: securityGroup,
});

// Allow SSH from specific IP
instance.connections.allowFrom(
  ec2.Peer.ipv4('1.2.3.4/32'),
  ec2.Port.tcp(22),
  'Allow SSH'
);

Best practices:
- Use latest Amazon Linux 2023
- Deploy in private subnets if no public access needed
- Use IAM roles instead of access keys
- Enable detailed monitoring for production
`,
    fargate: `
AWS CDK Fargate Service (aws-cdk-lib/aws-ecs-patterns):

import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';

const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
  vpc: vpc,
  cpu: 256,
  memoryLimitMiB: 512,
  desiredCount: 2,
  taskImageOptions: {
    image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
    containerPort: 80,
    environment: {
      ENV: 'production',
    },
  },
  publicLoadBalancer: true,
  healthCheckGracePeriod: Duration.seconds(60),
});

// Auto scaling
const scaling = fargateService.service.autoScaleTaskCount({
  minCapacity: 1,
  maxCapacity: 10,
});
scaling.scaleOnCpuUtilization('CpuScaling', {
  targetUtilizationPercent: 70,
});

Best practices:
- Right-size CPU and memory
- Enable auto-scaling
- Use health checks
- Deploy in private subnets with ALB
`,
    alb: `
AWS CDK Application Load Balancer (aws-cdk-lib/aws-elasticloadbalancingv2):

import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';

const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
  vpc: vpc,
  internetFacing: true,
  vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
});

const listener = alb.addListener('Listener', {
  port: 443,
  protocol: elbv2.ApplicationProtocol.HTTPS,
  certificates: [certificate],
});

listener.addTargets('Targets', {
  port: 80,
  protocol: elbv2.ApplicationProtocol.HTTP,
  targets: [new targets.InstanceTarget(instance)],
  healthCheck: {
    path: '/health',
    interval: Duration.seconds(30),
  },
});

Best practices:
- Use HTTPS listeners with ACM certificates
- Configure health checks appropriately
- Enable access logs to S3
- Use target groups for multiple targets
`,
    elasticache: `
AWS CDK ElastiCache Redis (aws-cdk-lib/aws-elasticache):

import * as elasticache from 'aws-cdk-lib/aws-elasticache';

const subnetGroup = new elasticache.CfnSubnetGroup(this, 'SubnetGroup', {
  description: 'Redis subnet group',
  subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
});

const redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
  replicationGroupDescription: 'Redis cluster',
  engine: 'redis',
  cacheNodeType: 'cache.t3.micro',
  numCacheClusters: 2,
  automaticFailoverEnabled: true,
  cacheSubnetGroupName: subnetGroup.ref,
  atRestEncryptionEnabled: true,
  transitEncryptionEnabled: true,
  securityGroupIds: [securityGroup.securityGroupId],
});

Best practices:
- Deploy in private subnets
- Enable encryption at rest and in transit
- Use replication for high availability
- Configure appropriate node size
`,
  };

  // Match query to documentation
  const queryLower = query.toLowerCase();
  if (queryLower.includes('lambda') || queryLower.includes('function')) return docs.lambda;
  if (queryLower.includes('dynamodb') || queryLower.includes('table')) return docs.dynamodb;
  if (queryLower.includes('api') || queryLower.includes('gateway')) return docs.apigateway;
  if (queryLower.includes('s3') || queryLower.includes('bucket')) return docs.s3;
  if (queryLower.includes('rds') || queryLower.includes('database')) return docs.rds;
  if (queryLower.includes('sqs') || queryLower.includes('queue')) return docs.sqs;
  if (queryLower.includes('sns') || queryLower.includes('topic')) return docs.sns;
  if (queryLower.includes('vpc') || queryLower.includes('network')) return docs.vpc;
  if (queryLower.includes('cloudfront') || queryLower.includes('cdn')) return docs.cloudfront;
  if (queryLower.includes('ec2') || queryLower.includes('instance')) return docs.ec2;
  if (queryLower.includes('fargate') || queryLower.includes('ecs')) return docs.fargate;
  if (queryLower.includes('alb') || queryLower.includes('load balancer')) return docs.alb;
  if (queryLower.includes('elasticache') || queryLower.includes('redis')) return docs.elasticache;

  // Generic CDK guidance
  return `
AWS CDK TypeScript General Best Practices:

Imports:
- Use 'aws-cdk-lib' for all AWS constructs
- Import specific modules: import * as lambda from 'aws-cdk-lib/aws-lambda';
- Import Duration, RemovalPolicy from 'aws-cdk-lib'

Stack Structure:
export class MyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Resources here
  }
}

Dependencies:
- CDK handles most dependencies automatically
- Use .node.addDependency() if manual ordering needed

Outputs:
new cdk.CfnOutput(this, 'OutputName', {
  value: resource.someProperty,
  description: 'Description'
});

For specific service: Query with service name (Lambda, DynamoDB, S3, etc.)
`;
}

/**
 * Generate CDK code files using Claude as a code generation agent
 * @param {object} state - The diagram state with full CDK metadata
 * @param {string} outputDir - Directory to write CDK project files
 * @param {string} apiKey - Anthropic API key
 * @returns {Promise<string[]>} - List of generated files
 */
export async function generateCDKCode(state, outputDir, apiKey) {
  console.log("\n🤖 Starting CDK Code Generation Agent...\n");

  // Create output directory structure
  fs.mkdirSync(outputDir, { recursive: true });

  const client = new Anthropic({ apiKey });

  const stackFileName = toKebabCase(state.metadata.stackName || "infrastructure");
  const serviceTypes = [...new Set(state.nodes.map(n => n.type))].join(", ");

  // Single comprehensive prompt
  const prompt = `Generate a complete AWS CDK TypeScript project for this architecture.

ARCHITECTURE SPECIFICATION:
${JSON.stringify(state, null, 2)}

REQUIRED FILES:
1. lib/${stackFileName}-stack.ts (main Stack class)
2. bin/${stackFileName}.ts (app entry point)
3. package.json (name: "${stackFileName}-cdk", services: ${serviceTypes})
4. tsconfig.json (standard CDK TypeScript config)
5. cdk.json (app: "npx ts-node bin/${stackFileName}.ts")
6. .gitignore (node_modules, cdk.out, *.js, *.d.ts)

Use write_file for each file. Generate production-ready code with:
- All imports
- Proper types
- Error handling
- Comments from notes
- Exact cdkIds and cdkMethods
- All props mapped correctly

Start with lib/ stack file, then bin/ app, then config files.`;

  console.log("📝 Generating CDK project files...");

  const messages = [{ role: "user", content: prompt }];
  const generatedFiles = await runGenerationAgent(client, messages, outputDir);

  return generatedFiles;
}

/**
 * Run the code generation agent with tool calling
 */
async function runGenerationAgent(client, messages, outputDir) {
  const generatedFiles = [];
  let iteration = 0;
  const MAX_ITERATIONS = 20; // Prevent infinite loops

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    // Check for text content (thinking/explanations)
    const textBlocks = response.content.filter(block => block.type === "text");
    if (textBlocks.length > 0 && textBlocks[0].text.trim()) {
      // Agent is explaining what it's doing - show abbreviated version
      const text = textBlocks[0].text.trim();
      if (text.length < 200) {
        console.log(`   💭 ${text}`);
      }
    }

    if (response.stop_reason === "end_turn") {
      // Agent is done
      break;
    }

    if (response.stop_reason === "tool_use") {
      const results = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        if (block.name === "aws_kb_retrieve") {
          // Query AWS documentation
          const docs = await queryAWSDocumentation(block.input.query);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: docs,
          });
        } else if (block.name === "write_file") {
          const filePath = path.join(outputDir, block.input.path);
          const fileDir = path.dirname(filePath);

          fs.mkdirSync(fileDir, { recursive: true });
          fs.writeFileSync(filePath, block.input.content, "utf8");

          generatedFiles.push(block.input.path);
          console.log(`   ✓ ${block.input.path} (${block.input.content.length} bytes)`);

          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Success. File written to ${block.input.path}`,
          });
        }
      }

      if (results.length > 0) {
        messages.push({ role: "user", content: results });
      }
    } else if (response.stop_reason === "max_tokens") {
      console.log("   ⚠ Hit max tokens - agent may not have finished");
      break;
    } else {
      break;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.log("   ⚠ Reached maximum iterations");
  }

  return generatedFiles;
}

/**
 * Convert string to kebab-case
 */
function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}
