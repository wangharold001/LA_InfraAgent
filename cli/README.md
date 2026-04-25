# InfraAgent CLI

**AI-Powered AWS Infrastructure: From Prompt → Architecture → CDK Code → Deployment**

An intelligent terminal agent that:
1. Designs AWS architecture from natural language prompts
2. Gets your approval with detailed review
3. Generates production-ready AWS CDK TypeScript code
4. Deploys to your AWS account

## Quick Start

### Prerequisites

```bash
# Install Node.js 18+
node --version  # Should be >= 18

# Install AWS CLI and configure credentials
aws configure

# Install AWS CDK CLI globally
npm install -g aws-cdk

# Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...
```

### Installation

```bash
cd cli
npm install
npm link  # Makes 'infra-agent' available globally
```

### Usage

```bash
# Run from any directory
infra-agent

# Or specify a directory to analyze
infra-agent /path/to/your/project
```

## How It Works

### Phase 1: Architecture Design

The agent reads your repository context and uses Claude to design AWS architecture:

```
What infrastructure would you like to build?
> I need a serverless API with authentication and a database

Generation modes: [1] minimal  [2] simple  [3] standard  [4] enterprise
Choose mode (default: simple): 2

🤖 Generating architecture with Claude AI (mode: simple)...
  + node  lambda        AuthFunction
  + node  apigateway    RestAPI
  + node  dynamodb      UsersTable
  + edge  n_abc123 → n_def456 (invoke)
  ...
```

The agent:
- Analyzes your codebase (package.json, serverless.yml, etc.)
- Designs complete architecture with AWS best practices
- Assigns proper IAM permissions
- Includes production-ready defaults
- Saves visual diagram as HTML

#### Generation Modes

| Mode | Description | Best for |
|------|-------------|----------|
| `minimal` | Serverless-only (Lambda, DynamoDB, S3, API Gateway). No VPC, no always-on compute. `removalPolicy: DESTROY` everywhere. | Prototypes, lowest possible cost |
| `simple` | Serverless-first, but allows one always-on tier (e.g. single-AZ RDS or Fargate). No VPC unless required. | Small production apps |
| `standard` | VPC with public/private subnets, single NAT gateway, single-AZ databases, SQS for async decoupling. `removalPolicy: SNAPSHOT` for databases. | Cost-conscious production |
| `enterprise` | Multi-AZ stateful resources, ElastiCache, ALB, WAF, full encryption, CloudWatch alarms on all critical paths. | High-availability, compliance |

You can enter the number (`1`–`4`) or the mode name directly. Defaults to `simple`.

### Phase 2: Review & Approval

Interactive review of the generated architecture:

```
📋 GENERATED ARCHITECTURE
═══════════════════════════════════════════════════════

📦 Stack Configuration:
   Name:        Serverless API
   Stack Name:  ServerlessApiStack
   Region:      us-east-1
   Environment: dev

🏗️  Resources (5 nodes):

   LAMBDA:
     • Auth Function (AuthFunction)
       Handles user authentication with JWT
       Props: runtime: NODEJS_20_X, memory: 512MB, timeout: 29s

   DYNAMODB:
     • Users Table (UsersTable)
       Stores user profiles and credentials
       Props: billing: PAY_PER_REQUEST, pk: userId

🔗 Connections (3 edges):
   API → Auth Function
     Relationship: api-integration
     CDK: api.addRoutes({integration: new HttpLambdaIntegration('Auth', fn)})

✅ Proceed with CDK code generation? (yes/no):
```

### Phase 3: CDK Code Generation

An AI agent generates complete CDK TypeScript project with AWS documentation references:

```
🤖 Starting CDK Code Generation Agent...

📝 Generating CDK project files...
   📚 Querying AWS docs: "CDK Lambda Function TypeScript"
   📚 Querying AWS docs: "API Gateway Lambda integration CDK"
   📚 Querying AWS docs: "DynamoDB table CDK best practices"
   ✓ lib/serverless-api-stack.ts (3482 bytes)
   ✓ bin/serverless-api.ts (456 bytes)
   ✓ package.json (892 bytes)
   ✓ tsconfig.json (321 bytes)
   ✓ cdk.json (234 bytes)
   ✓ .gitignore (87 bytes)
   ✓ README.md

✅ Generated 7 CDK files
📁 CDK project location: ./cdk-infrastructure
```

The generated code:
- **References AWS documentation** via built-in knowledge base (AWS MCP support coming soon)
- Uses exact CDK L2 constructs with verified APIs
- Implements all IAM permissions with proper methods
- Follows AWS best practices from official docs
- Includes helpful comments and type safety
- Ready to deploy immediately

**AWS MCP Integration** (Optional):
The agent can connect to the [official AWS MCP server](https://github.com/awslabs/mcp) for real-time AWS documentation:
```bash
# Install AWS MCP (future enhancement)
npm install -g @aws/mcp-server-aws
export AWS_MCP_ENABLED=true
```

Currently uses comprehensive built-in CDK documentation for all supported services.

### Phase 4: Deployment

Automated deployment to AWS:

```
Deploy to AWS now? (yes/no): yes

🚀 CDK DEPLOYMENT
═══════════════════════════════════════════════════════

🔍 Checking CDK CLI...
   ✓ Found: 2.150.0

🔍 Checking AWS credentials...
   ✓ Authenticated as: arn:aws:iam::123456789012:user/developer
   Account: 123456789012

📦 Installing dependencies...
   ✓ Dependencies installed

🔨 Building TypeScript...
   ✓ Build completed

🔍 Synthesizing CloudFormation...
   ✓ Synthesis successful

🔧 Bootstrap CDK environment? (yes/no): yes
   ✓ Bootstrap completed

📋 Generating deployment diff...
   [Shows what will be created/changed]

🚀 Deploy this stack to AWS? (yes/no): yes
   This may take several minutes...

✅ Deployment completed successfully!
```

## How the Agent Works

### Documentation-Driven Code Generation

The CDK generation agent uses a unique **research-then-write** approach:

1. **Before writing each construct**, the agent queries AWS documentation:
   - "CDK Lambda Function TypeScript props"
   - "API Gateway Lambda integration pattern"
   - "DynamoDB best practices for production"

2. **Applies official patterns** from AWS documentation:
   - Exact TypeScript types and imports
   - Verified CDK L2 construct APIs
   - AWS Well-Architected best practices
   - Production-ready security defaults

3. **Generates code** that matches official AWS examples:
   ```typescript
   // Agent researches Lambda docs, then writes:
   new lambda.Function(this, 'AuthFunction', {
     runtime: lambda.Runtime.NODEJS_20_X,  // Not string literal
     code: lambda.Code.fromAsset('lambda'), // Not just 'code'
     tracing: lambda.Tracing.ACTIVE,        // Recommended for production
   });
   ```

This ensures generated code is **always up-to-date** with CDK best practices, not based on outdated training data.

### Built-in AWS Documentation

The agent includes comprehensive CDK documentation for:
- Lambda, DynamoDB, S3, RDS, ElastiCache
- API Gateway, ALB, SQS, SNS
- VPC, CloudFront, EC2, Fargate
- Integration patterns (grants, event sources, origins)
- Best practices for each service

**Future**: Direct integration with [AWS MCP](https://github.com/awslabs/mcp) for real-time doc updates.

## Architecture Design Features

### Intelligent Resource Configuration

The agent generates **complete** CDK properties, not just what you mentioned:

```typescript
// You say: "I need a Lambda function"
// Agent generates:
new lambda.Function(this, 'MyFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda/handler'),
  memorySize: 512,
  timeout: Duration.seconds(29),
  environment: {},
  tracing: lambda.Tracing.ACTIVE,
  removalPolicy: RemovalPolicy.DESTROY,
  // ... and more based on best practices
});
```

### Smart IAM Permissions

Every connection includes exact IAM actions:

```typescript
// The agent knows what permissions are needed
table.grantReadWriteData(fn);  // Grants: GetItem, PutItem, Query, Scan, etc.

// Or specific actions:
table.grant(fn, 'dynamodb:GetItem', 'dynamodb:PutItem');
```

### Environment-Aware Defaults

Production vs development settings:

```typescript
// Production (environment: "prod")
removalPolicy: RemovalPolicy.RETAIN        // Keep data on delete
multiAz: true                               // High availability
deletionProtection: true                    // Prevent accidents

// Development (environment: "dev")
removalPolicy: RemovalPolicy.DESTROY       // Clean up on delete
multiAz: false                              // Save costs
```

## Generated Project Structure

```
cdk-infrastructure/
├── bin/
│   └── my-stack.ts          # CDK app entry point
├── lib/
│   └── my-stack-stack.ts    # Stack with all resources
├── cdk.out/                 # CloudFormation templates (generated)
├── node_modules/            # Dependencies
├── package.json             # Project config
├── tsconfig.json            # TypeScript config
├── cdk.json                 # CDK config
├── .gitignore
└── README.md                # Deployment instructions
```

## Supported AWS Services

**Compute:**
- Lambda (with layers, VPC, env vars)
- EC2 (instances, security groups)
- Fargate (ECS tasks, load balanced)

**Data:**
- DynamoDB (tables, GSIs, streams)
- RDS (Postgres, MySQL, multi-AZ)
- S3 (buckets, lifecycle, CORS)
- ElastiCache (Redis, Memcached)

**Integration:**
- API Gateway (HTTP, REST, WebSocket)
- ALB (Application Load Balancer)
- SQS (queues, FIFO, DLQ)
- SNS (topics, subscriptions)

**Network:**
- VPC (subnets, NAT, security groups)
- CloudFront (distributions, caching)

## Example Prompts

```
"I need a serverless API with authentication"
→ API Gateway + Lambda + Cognito + DynamoDB

"Build a static website with global CDN"
→ S3 + CloudFront + Route53

"Create a microservices architecture with queues"
→ Multiple Lambda + SQS + DynamoDB + API Gateway

"I want to analyze my current Express app and deploy it"
→ Reads your code, suggests Fargate + RDS + ALB

"Build a data processing pipeline"
→ S3 + Lambda + SQS + DynamoDB Streams + SNS
```

## Environment Variables

```bash
# Required
export ANTHROPIC_API_KEY=sk-ant-...    # Get from console.anthropic.com

# Optional
export AWS_PROFILE=myprofile            # Use specific AWS profile
export AWS_REGION=us-west-2             # Override default region
export CDK_DEFAULT_ACCOUNT=123456789012 # Specify AWS account
```

## Development

### Run Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

### Test Without API (Mock Mode)

```bash
MOCK_API=true node bin/infra-agent.js
```

### Debug

```bash
NODE_OPTIONS='--inspect' node bin/infra-agent.js
```

## Workflow Commands

### After Generation

```bash
cd cdk-infrastructure

# See what will be deployed
cdk diff

# Deploy changes
cdk deploy

# View CloudFormation outputs
cdk deploy --outputs-file outputs.json

# View synthesized CloudFormation
cat cdk.out/*.template.json

# Destroy stack (removes all resources)
cdk destroy
```

### Modify and Redeploy

```bash
# Edit the generated stack
vim lib/my-stack-stack.ts

# Build
npm run build

# See changes
cdk diff

# Deploy updates
cdk deploy
```

## Architecture Principles

The agent follows AWS Well-Architected Framework:

1. **Security**
   - Least privilege IAM
   - Encryption at rest/in transit
   - No public resources by default

2. **Reliability**
   - Multi-AZ where appropriate
   - DLQs for queues
   - Retry policies

3. **Performance**
   - Right-sized instances
   - Caching layers
   - Reserved concurrency

4. **Cost Optimization**
   - PAY_PER_REQUEST for DynamoDB
   - Autoscaling
   - Environment-based sizing

5. **Operational Excellence**
   - CloudWatch metrics/alarms
   - X-Ray tracing enabled
   - Tagged resources

## Troubleshooting

### "ANTHROPIC_API_KEY not set"
```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### "CDK CLI not found"
```bash
npm install -g aws-cdk
```

### "AWS credentials not configured"
```bash
aws configure
# Or use environment variables:
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

### "Bootstrap required"
```bash
cd cdk-infrastructure
cdk bootstrap
```

### "Deployment failed"
- Check AWS quotas (Lambda concurrent executions, VPC limits)
- Verify IAM permissions for CDK deployments
- Review CloudFormation events in AWS Console

## Advanced Usage

### Custom Repository Context

Place files the agent should prioritize:

```
your-project/
├── cdk.json              # Existing CDK config
├── serverless.yml        # Serverless framework
├── .env.example          # Environment variables needed
└── ARCHITECTURE.md       # Your architecture notes
```

The agent automatically reads these for context.

### Incremental Changes

```bash
# Generate initial infrastructure
infra-agent

# Make manual edits to cdk-infrastructure/
vim cdk-infrastructure/lib/my-stack-stack.ts

# Deploy changes
cd cdk-infrastructure
npm run build && cdk deploy

# Later, regenerate from new prompt
# (saves to new directory, doesn't overwrite)
infra-agent
```

## Comparison with Other Tools

| Tool | Approach | Learning Curve | Flexibility |
|------|----------|----------------|-------------|
| **InfraAgent** | Natural language → AI-generated CDK | Minutes | High - edit generated code |
| AWS Console | Manual clicking | Hours | Low - console only |
| CDK (manual) | Write TypeScript | Days | Highest - full control |
| Terraform | Write HCL | Days | High - DSL limitations |
| Serverless Framework | Write YAML | Hours | Medium - framework opinions |

## Contributing

See parent [README.md](../README.md) for contribution guidelines.

## License

MIT

---

Built for LA Hacks 2026 - Augment The Agent Track
