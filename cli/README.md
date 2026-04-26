# infragen

**AWS infrastructure diagramming and deployment from the terminal.**

Design your AWS architecture visually, then deploy it — infragen handles CDK code generation and deployment automatically.

## Install

```bash
npm install -g infragen
export ANTHROPIC_API_KEY=sk-ant-...
```

**Also required:**
- Node.js 18+
- AWS CLI (`aws configure`)
- AWS CDK CLI (`npm install -g aws-cdk`)

## Quick Start

```bash
diagram
```

Opens an interactive AWS diagram editor in your browser. Build your architecture, then press Enter in the terminal to generate CDK code and deploy.

Or let Claude design it for you first:

```bash
infra-agent
```

Prompts you for what you want to build, generates an architecture, then opens the diagram so you can review and edit before deploying.

---

## Commands

### `diagram`

Open the diagram editor for an existing project.

```bash
diagram                        # current directory
diagram /path/to/project       # specific directory
```

Requires an `infra-diagram.html` in the directory (created by `infra-agent` on first run, or open the HTML file directly in a browser without the CLI). Press Enter in the terminal when ready — infragen reads the saved diagram and runs the pipeline.

### `infra-agent`

Generate an architecture from a text prompt, then open the editor.

```bash
infra-agent                    # current directory
infra-agent /path/to/project   # reads repo context from that directory
```

Claude designs the diagram based on your prompt and any repo context it finds (`package.json`, config files, etc.), then opens the editor for you to review and adjust.

**Generation modes:**

| Mode | Description |
|------|-------------|
| `minimal` | Serverless-only (Lambda, DynamoDB, S3, API Gateway). No VPC. `DESTROY` removal policy. |
| `simple` | Serverless-first, one always-on tier allowed. No VPC unless required. |
| `standard` | VPC, private subnets, single NAT gateway, SQS for async decoupling. |
| `enterprise` | Multi-AZ, ElastiCache, ALB, WAF, full encryption, CloudWatch alarms. |

### `infra-decommission`

Destroy all AWS resources managed by infragen.

```bash
infra-decommission             # current directory
infra-decommission /path/to/project
```

Runs `cdk destroy` after a confirmation prompt. Resources with deletion protection may need manual cleanup.

---

## The Diagram Editor

The editor runs locally in your browser. It connects back to the CLI process for auto-save.

**Canvas**
- Drag AWS services from the left palette onto the canvas
- Click and drag between nodes to draw a connection
- Right-click a node to delete it
- Drag a node to the trash icon to delete it
- Search nodes with the top search bar
- Focus mode (⤢) hides all panels for a clean view

**Palette**
AWS services organized by category: Compute, Data, Messaging, API, Network, Security.

**Inspector** (right panel)
Click any node or edge to edit its properties — runtime, memory, billing mode, instance type, IAM actions, CDK method, etc.

**Chat** (right panel)
Talk to Claude about your architecture. Toggle "Include current diagram" to give Claude full context of your current diagram. Select a generation mode to bias Claude's recommendations.

**Billing** (right panel)
Rough on-demand AWS cost estimate based on the services in your diagram, updated as you edit.

**JSON pane** (bottom)
The raw diagram state as editable JSON. Edit directly and press Cmd+S to apply changes to the canvas.

**Export**
- Download JSON — save the diagram state
- Download Image (PNG) — export the canvas as an image

---

## The Deployment Pipeline

After you press Enter in the terminal, infragen runs four phases:

**Phase 2 — Review**  
Prints every resource, connection, IAM action, and CDK method for your approval.

**Phase 3 — CDK Generation**  
An AI agent writes a complete CDK TypeScript project to `cdk-infrastructure/`, referencing AWS documentation for each service.

**Phase 4 — Deploy**  
Runs `cdk bootstrap` (if needed), `cdk diff`, and `cdk deploy`.

**Phase 5 — Auto-repair**  
If deployment fails, Claude diagnoses the error and patches the generated code. Retries up to 3 times. Session transcripts saved to `cdk-infrastructure/.infra-agent/`.

---

## Supported Services

**Compute:** Lambda, EC2, Fargate  
**Data:** DynamoDB, RDS, S3, ElastiCache, OpenSearch, DocumentDB, Redshift, EFS, Athena, Glue  
**Messaging:** SQS, SNS, Kinesis, EventBridge, Step Functions, Scheduler, AppSync  
**API:** API Gateway, ALB, NLB  
**Network:** VPC, CloudFront, Route 53, WAF, ACM  
**Security:** Cognito, KMS, Secrets Manager  

---

## After Deployment

```bash
cd cdk-infrastructure
cdk diff      # preview changes
cdk deploy    # redeploy
```

To tear down:

```bash
infra-decommission
```

---

## Troubleshooting

**`ANTHROPIC_API_KEY not set`** → `export ANTHROPIC_API_KEY=sk-ant-...`  
**`CDK CLI not found`** → `npm install -g aws-cdk`  
**`AWS credentials not configured`** → `aws configure`  
**Bootstrap required** → answer yes when prompted, or `cd cdk-infrastructure && cdk bootstrap`

---

Built for LA Hacks 2026 · MIT License
