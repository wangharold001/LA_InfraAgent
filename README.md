# infragen

**AWS infrastructure diagramming and deployment from the terminal.**

Design your AWS architecture visually, then deploy it to AWS — infragen handles CDK code generation, IAM wiring, and deployment automatically.

```bash
npm install -g infragen
diagram
```

---

## How it works

infragen ships as a CLI with three commands. The core workflow:

1. **Design** — Open the diagram editor and drag AWS services onto the canvas
2. **Generate** — Press Enter; Claude writes a complete CDK TypeScript project
3. **Deploy** — CDK deploys your stack to AWS with auto-repair on failure

---

## Install

```bash
npm install -g infragen
```

**Prerequisites:**
- Node.js 18+
- AWS CLI configured (`aws configure`)
- AWS CDK CLI (`npm install -g aws-cdk`)
- Anthropic API key (`export ANTHROPIC_API_KEY=sk-ant-...`)

---

## Commands

### `diagram`

Open the visual diagram editor for an existing project.

```bash
diagram                       # current directory
diagram /path/to/project      # specific directory
```

Opens the editor in your browser. When you press Enter in the terminal, infragen reads your saved diagram and runs the full pipeline.

### `infra-agent`

Start from a text prompt instead of a blank canvas.

```bash
infra-agent
infra-agent /path/to/project  # reads repo context
```

Claude designs an architecture based on your prompt (and your codebase if provided), then opens the diagram editor so you can review and adjust before deploying.

**Generation modes:** `minimal` · `simple` · `standard` · `enterprise` — controls tradeoffs between cost, availability, and complexity.

### `infra-decommission`

Destroy all AWS resources managed by infragen.

```bash
infra-decommission
infra-decommission /path/to/project
```

---

## The Diagram Editor

The editor runs in your browser, served locally by the CLI. It auto-saves as you work.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Topbar  (New · Open · Export · Search · Focus mode)    │
├──────────────┬──────────────────────────┬───────────────┤
│              │                          │               │
│   Palette    │       Canvas (SVG)       │  Chat /       │
│   (services) │                          │  Inspector /  │
│              │                          │  Billing      │
├──────────────┴──────────────────────────┴───────────────┤
│                   JSON pane (Cmd+S to apply)            │
└─────────────────────────────────────────────────────────┘
```

### Palette

AWS services organized into categories. Drag any item onto the canvas to place a node.

**Compute:** Lambda, EC2, Fargate  
**Data:** DynamoDB, RDS, S3, ElastiCache, OpenSearch, DocumentDB, Redshift, EFS, Athena, Glue  
**Messaging:** SQS, SNS, Kinesis, EventBridge, Step Functions, Scheduler, AppSync  
**API:** API Gateway, ALB, NLB  
**Network:** VPC, CloudFront, Route 53, WAF, ACM  
**Security:** Cognito, KMS, Secrets Manager  

### Canvas

- **Add nodes** — drag from the palette
- **Connect nodes** — hover a node to reveal its port, drag to another node
- **Move nodes** — click and drag (snaps to 10px grid)
- **Delete** — select then `Delete`/`Backspace`, or drag to the trash icon
- **Pan** — drag on empty canvas space
- **Zoom** — scroll wheel (0.3× – 3×)
- **Search** — type in the top search bar to jump to any node

### Inspector

Click any node or edge to edit its properties: label, service-specific config (runtime, memory, billing mode, instance type), IAM actions, CDK method, and more.

### Chat

Talk to Claude about your architecture. Toggle "Include codebase" to give Claude context from your local repository — your existing source files, config, and structure — so recommendations fit what you've already built. Select a generation mode to bias Claude's suggestions.

### Billing

Rough on-demand AWS cost estimate based on the services in your diagram, updated live as you edit.

### JSON Pane

The raw diagram state as editable JSON. Edit directly and press Cmd+S to apply changes back to the canvas.

### Export

- **Download JSON** — save the diagram state
- **Download Image (PNG)** — export the canvas

---

## The Deployment Pipeline

After pressing Enter in the terminal:

**Phase 2 — Review**  
Prints every resource, connection, IAM permission, and CDK method for explicit approval.

**Phase 3 — CDK Generation**  
Claude writes a complete CDK TypeScript project to `cdk-infrastructure/`, referencing AWS documentation per service.

**Phase 4 — Deploy**  
Runs `cdk bootstrap` (if needed), `cdk diff`, and `cdk deploy`.

**Phase 5 — Auto-repair**  
If deployment fails, Claude diagnoses and patches the generated code. Up to 3 attempts. Session transcripts saved to `cdk-infrastructure/.infra-agent/`.

---

## How It Works — Technical Details

### Three Claude Agents

infragen runs three distinct Claude agents, each with its own tools and system prompt:

**1. Architecture Agent** (`infra-agent` only)  
Reads your prompt and repo context, then calls tools to build the diagram state: `add_node`, `add_edge`, `set_metadata`. Outputs a fully-specified graph with CDK IDs, IAM actions, and CDK L2 methods on every edge — so the next agent needs zero guesswork.

**2. CDK Generation Agent**  
Receives the diagram state and writes a complete CDK TypeScript project. Before writing each construct, it calls `aws_kb_retrieve` to look up the correct CDK L2 API, prop names, and integration patterns — the same documentation catalog as AWS MCP. This research-then-write loop means generated code matches official AWS patterns, not stale training data.

```
📚 aws_kb_retrieve("CDK Lambda Function TypeScript props")
📚 aws_kb_retrieve("API Gateway HttpApi Lambda integration")
📚 aws_kb_retrieve("DynamoDB TableV2 billing mode encryption")
✎ lib/my-stack.ts  (4.1 KB)
✎ bin/my-stack.ts
✎ package.json
```

**3. Auto-Repair Agent**  
If CDK deployment fails, this agent receives the error output (last 4 KB of stdout/stderr + CloudFormation failure events) and calls `read_file` / `propose_patch` to diagnose and fix the generated code in place. Patches are classified as SAFE (auto-applied) or RISKY (touches IAM, security group ingress, or removal policies — requires user approval).

### IAM and CDK Wiring Per Edge

Every connection in the diagram carries explicit IAM actions and the exact CDK L2 call needed to implement it. The architecture agent generates these upfront so the CDK agent can copy them directly:

```
Lambda → DynamoDB
  relationship: iam-grant
  iamActions:   ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
  cdkMethod:    table.grantReadWriteData(fn)

SQS → Lambda
  relationship: event-source-mapping
  iamActions:   []
  cdkMethod:    fn.addEventSource(new SqsEventSource(queue, { batchSize: 10 }))
```

### Graph as the Interface

The diagram state is the shared language between every component — the browser editor, the architecture agent, the CDK generation agent, and the approval review. Every agent reads and writes the same JSON schema, so humans and agents can hand off the same artifact without translation.

---

## File Format

Diagrams are saved as `infra-diagram.state.json`. Schema version `0.2.0`.

```json
{
  "schemaVersion": "0.2.0",
  "metadata": {
    "name": "My API",
    "stackName": "MyApiStack",
    "region": "us-east-1",
    "environment": "dev",
    "createdAt": "2026-04-26T00:00:00.000Z"
  },
  "nodes": [
    {
      "id": "n_abc123",
      "type": "lambda",
      "label": "API Handler",
      "cdkId": "ApiHandler",
      "x": 400,
      "y": 200,
      "props": { "runtime": "NODEJS_20_X", "memorySize": 512, "timeout": 29 },
      "notes": "Handles all API routes"
    }
  ],
  "edges": [
    {
      "id": "e_xyz",
      "from": "n_abc123",
      "to": "n_def456",
      "label": "read/write",
      "relationship": "iam-grant",
      "iamActions": ["dynamodb:GetItem", "dynamodb:PutItem"],
      "cdkMethod": "table.grantReadWriteData(fn)"
    }
  ]
}
```

---

## Troubleshooting

**`ANTHROPIC_API_KEY not set`** → `export ANTHROPIC_API_KEY=sk-ant-...`  
**`CDK CLI not found`** → `npm install -g aws-cdk`  
**`AWS credentials not configured`** → `aws configure`  
**Bootstrap required** → answer yes when prompted, or `cd cdk-infrastructure && cdk bootstrap`  
**Deployment failed** → infragen auto-repairs up to 3 times; check `cdk-infrastructure/.infra-agent/` for transcripts

---

## Project Structure

```
cli/
├── bin/
│   ├── infra-agent.js        # prompt → diagram → deploy
│   ├── diagram.js            # open existing diagram → deploy
│   └── infra-decommission.js # destroy CDK stack
├── src/
│   ├── agent.js              # architecture generation agent
│   ├── diagram.js            # diagram state + tool execution
│   ├── diagram-services.js   # service catalog, palette, CDK mappings
│   ├── cdk-generator.js      # CDK code generation agent
│   ├── cdk-tools.js          # aws_kb_retrieve + file tools
│   ├── iac-pipeline.js       # approval → generate → deploy loop
│   ├── deployer.js           # CDK deploy / destroy runner
│   ├── approval.js           # terminal review + approval prompt
│   ├── renderer.js           # injects state into HTML, starts server
│   └── server.js             # local HTTP server (auto-save endpoint)
└── assets/
    ├── diagram-editor.html   # editor shell
    ├── diagram-editor.css    # editor styles
    └── diagram-editor.js     # editor logic (canvas, chat, billing, inspector)
```

---

Built for LA Hacks 2026 · MIT License
