# infragen

**From idea to deployed AWS infrastructure — in minutes.**

Describe what you want to build. InfraAgent designs the architecture, opens an interactive diagram editor, generates CDK code, and deploys it to AWS.

## Install

```bash
npm install -g infragen
```

**Prerequisites:**
- Node.js 18+
- AWS CLI configured (`aws configure`)
- AWS CDK CLI (`npm install -g aws-cdk`)
- Anthropic API key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Commands

### `infra-agent`

Start from a natural language prompt. Generates an architecture diagram and walks you through code generation and deployment.

```bash
infra-agent

# Or point at an existing project for codebase context
infra-agent /path/to/your/project
```

**What happens:**
1. You describe what you want to build
2. Claude designs the architecture and opens a diagram in your browser
3. You review and approve
4. CDK TypeScript code is generated
5. Stack deploys to your AWS account

### `diagram`

Re-open the diagram editor for an existing project, or continue editing before deploying.

```bash
diagram

# Or from a specific project directory
diagram /path/to/your/project
```

The editor auto-saves. When you press Enter in the terminal, it picks up wherever you left off and runs the CDK generation + deployment pipeline.

### `infra-decommission`

Tear down all AWS resources created by InfraAgent.

```bash
infra-decommission

# Or from a specific project directory
infra-decommission /path/to/your/project
```

Runs `cdk destroy` with a confirmation prompt. Resources with deletion protection may need manual cleanup.

## Example

```
$ infra-agent

What infrastructure would you like to build?
> A serverless REST API with a DynamoDB table and S3 for file uploads

Generation modes: [1] minimal  [2] simple  [3] standard  [4] enterprise
Choose mode (default: simple): 2

🤖 Generating architecture...
  + node  apigateway    RestAPI
  + node  lambda        ApiHandler
  + node  dynamodb      ItemsTable
  + node  s3            UploadsBucket
  + edge  RestAPI → ApiHandler
  + edge  ApiHandler → ItemsTable
  + edge  ApiHandler → UploadsBucket

✅ Architecture generated: 4 resources, 3 connections
📊 Opening diagram editor...
```

The browser opens with an interactive diagram. Drag nodes, add connections, chat with Claude about your design. Press Enter when ready.

## Diagram Editor

The built-in diagram editor lets you:

- **Drag and drop** AWS services from the palette
- **Draw connections** between services
- **Edit properties** (memory, instance type, billing mode, etc.) in the inspector
- **Chat with Claude** about your architecture — ask questions, request changes, get recommendations
- **Include codebase context** — toggle on to give Claude visibility into your existing repo

Changes save automatically. The editor reads back the final state when you press Enter.

## Generation Modes

| Mode | Description |
|------|-------------|
| `minimal` | Serverless only — Lambda, DynamoDB, S3, API Gateway. No VPC. Everything set to `DESTROY`. |
| `simple` | Serverless-first with one always-on tier allowed. No VPC unless required. |
| `standard` | VPC, private subnets, single NAT gateway, SQS for async work. DB snapshots on delete. |
| `enterprise` | Multi-AZ, ElastiCache, ALB, WAF, full encryption, CloudWatch alarms. |

## Supported AWS Services

Compute: Lambda, EC2, Fargate  
Data: DynamoDB, RDS, S3, ElastiCache, OpenSearch, DocumentDB, Redshift, EFS  
Messaging: SQS, SNS, Kinesis, EventBridge, Step Functions  
API: API Gateway, AppSync, ALB, NLB  
Network: VPC, CloudFront, Route 53, WAF, ACM  
Security: Cognito, KMS, Secrets Manager  

## Environment Variables

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Required
export AWS_PROFILE=myprofile           # Optional: specific AWS profile
export AWS_REGION=us-west-2            # Optional: override region
```

## Troubleshooting

**`ANTHROPIC_API_KEY not set`**
```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
```

**`CDK CLI not found`**
```bash
npm install -g aws-cdk
```

**`AWS credentials not configured`**
```bash
aws configure
```

**Bootstrap required (first deployment)**
```bash
cd cdk-infrastructure
cdk bootstrap
```

**Deployment failed — auto-repair**  
InfraAgent automatically retries up to 3 times, using Claude to diagnose and patch the generated code. If it still fails, the transcript is saved to `cdk-infrastructure/.infra-agent/` for manual inspection.

## After Deployment

```bash
cd cdk-infrastructure

cdk diff           # Preview changes
cdk deploy         # Deploy updates
cdk destroy        # Or use: infra-decommission
```

---

Built for LA Hacks 2026 · [MIT License](../LICENSE)
