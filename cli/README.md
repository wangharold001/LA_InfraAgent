# infragen

**Draw your AWS infrastructure. Deploy it.**

Open a diagram editor, drag in AWS services, connect them — then press Enter. InfraAgent generates CDK code and deploys your stack to AWS.

## Install

```bash
npm install -g infragen
```

**Prerequisites:**
- Node.js 18+
- AWS CLI configured (`aws configure`)
- AWS CDK CLI (`npm install -g aws-cdk`)
- Anthropic API key (`export ANTHROPIC_API_KEY=sk-ant-...`)

## Quick Start

```bash
diagram
```

That's it. A diagram editor opens in your browser. Drag AWS services from the palette, draw connections between them, and use the built-in Claude chat to ask questions or request changes. When you're happy, press Enter in the terminal — InfraAgent generates CDK TypeScript code and walks you through deployment.

## Commands

### `diagram`

Open the visual diagram editor.

```bash
diagram

# Point at a specific project directory
diagram /path/to/project
```

The editor auto-saves as you work. When you press Enter, InfraAgent reads your diagram and runs the full pipeline: approval review → CDK generation → deploy to AWS.

**In the editor:**
- Drag services from the palette onto the canvas
- Click and drag between nodes to draw connections
- Click any node to edit its properties (memory, instance type, billing mode, etc.)
- Open the chat panel to talk to Claude about your architecture
- Toggle "Include codebase" to give Claude context from your existing repo

### `infra-agent`

Skip the diagram and start from a text prompt. Claude designs the architecture, then opens the diagram editor so you can review and adjust before deploying.

```bash
infra-agent

# Or point at a project for codebase context
infra-agent /path/to/project
```

### `infra-decommission`

Destroy all AWS resources created by InfraAgent.

```bash
infra-decommission

# Or from a specific project directory
infra-decommission /path/to/project
```

## The Pipeline

Once you press Enter in the diagram editor:

1. **Review** — InfraAgent shows every resource, connection, and IAM permission for approval
2. **Generate** — Claude writes a complete CDK TypeScript project referencing AWS documentation
3. **Deploy** — CDK bootstraps, synthesizes, and deploys your stack to AWS
4. **Auto-repair** — If deployment fails, Claude diagnoses and patches the code automatically (up to 3 attempts)

## Generation Modes (for `infra-agent`)

| Mode | Description |
|------|-------------|
| `minimal` | Serverless only — Lambda, DynamoDB, S3, API Gateway. No VPC. |
| `simple` | Serverless-first, one always-on tier allowed. |
| `standard` | VPC, private subnets, SQS for async work. DB snapshots on delete. |
| `enterprise` | Multi-AZ, ElastiCache, ALB, WAF, full encryption, CloudWatch alarms. |

## Supported AWS Services

Compute: Lambda, EC2, Fargate  
Data: DynamoDB, RDS, S3, ElastiCache, OpenSearch, DocumentDB, Redshift, EFS  
Messaging: SQS, SNS, Kinesis, EventBridge, Step Functions  
API: API Gateway, AppSync, ALB, NLB  
Network: VPC, CloudFront, Route 53, WAF, ACM  
Security: Cognito, KMS, Secrets Manager  

## After Deployment

```bash
cd cdk-infrastructure

cdk diff      # Preview changes
cdk deploy    # Deploy updates
```

Or to tear everything down:

```bash
infra-decommission
```

## Troubleshooting

**`ANTHROPIC_API_KEY not set`** — `export ANTHROPIC_API_KEY=sk-ant-your-key-here`

**`CDK CLI not found`** — `npm install -g aws-cdk`

**`AWS credentials not configured`** — `aws configure`

**Bootstrap required (first deploy)** — answer yes when prompted, or run `cdk bootstrap` in `cdk-infrastructure/`

**Deployment failed** — InfraAgent retries up to 3 times with Claude-assisted auto-repair. Transcripts saved to `cdk-infrastructure/.infra-agent/`

---

Built for LA Hacks 2026 · MIT License
