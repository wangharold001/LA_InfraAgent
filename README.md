# InfraAgent — AWS Architecture Diagram Builder

InfraAgent is a browser-based AWS architecture diagramming tool with built-in AI chat assistance. It lets engineers visually design cloud infrastructure, export diagrams as structured text, and get real-time guidance from Claude AI — all without installing anything. The end goal is to pair the visual diagram with an MCP server that converts the diagram into deployable CloudFormation (CFN) Infrastructure-as-Code.

---


## Track

Our projects is following the Cognition "Augment The Agent" track. Our app connects agents to new tools and services they can't access today. 

## Table of Contents

- [Motivation](#motivation)
- [Features](#features)
- [Getting Started](#getting-started)
- [Using the Diagram Editor](#using-the-diagram-editor)
  - [Palette — Adding Services](#palette--adding-services)
  - [Canvas — Moving and Connecting](#canvas--moving-and-connecting)
  - [Inspector — Editing Properties](#inspector--editing-properties)
  - [File Contents Pane](#file-contents-pane)
  - [Topbar Actions](#topbar-actions)
- [AI Chat Assistant](#ai-chat-assistant)
  - [Setup](#setup)
  - [Diagram Context](#diagram-context)
  - [Conversation Management](#conversation-management)
- [File Format](#file-format)
  - [Schema Overview](#schema-overview)
  - [Node Object](#node-object)
  - [Edge Object](#edge-object)
  - [Full Example](#full-example)
- [Mermaid Export](#mermaid-export)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Supported AWS Services](#supported-aws-services)
- [Architecture & Design Decisions](#architecture--design-decisions)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Motivation

Engineers often spend significant time on infrastructure setup — provisioning DynamoDB tables, spinning up EC2 instances, wiring VPCs — before they can write a single line of application code. InfraAgent aims to collapse that gap: design your architecture visually, get AI feedback on it, then generate the CloudFormation to deploy it.

---

## Features

| Feature | Description |
|---|---|
| Drag-and-drop diagram builder | Drop AWS service blocks onto an infinite canvas |
| Edge drawing | Click a node's port to draw directed connections between services |
| Node inspection & editing | Click any node to edit its label, custom properties, and service-specific defaults |
| Edge labeling | Click any edge to give it a descriptive label (e.g. "HTTP", "event trigger") |
| Pan & zoom canvas | Click-drag to pan, scroll wheel to zoom in/out |
| Structured JSON state | The full diagram is stored as a versioned JSON document with nodes and edges |
| Save / Open | Download the diagram as a `.arch.json` file and reopen it later |
| Mermaid export | Copy the diagram as a Mermaid `flowchart LR` for pasting into docs or GitHub |
| AI Chat assistant | Ask Claude questions about your architecture; the AI can see your current diagram |
| No install required | Runs entirely in the browser as a single HTML file — no build step, no server |

---

## Getting Started

InfraAgent is a single self-contained HTML file. There is nothing to install.

1. Open `DiagramEditorv1.html` in any modern browser (Chrome, Firefox, Edge, Safari).
2. The editor loads immediately.
3. To use the AI Chat, you will need an [Claude API key].

> **Tip:** For the best experience, open the file directly from disk. All features work offline except the AI Chat, which requires an internet connection to reach the Claude API.

---

## Using the Diagram Editor

### Layout

```
┌──────────────────────────────────────────────────────┐
│  Topbar  (New · Chat with AI · Open · Save · Export) │
├───────────┬──────────────────────────┬───────────────┤
│           │                          │               │
│  Palette  │        Canvas (SVG)      │   Inspector   │
│           │                          │               │
├───────────┴──────────────────────────┴───────────────┤
│              File Contents (JSON preview)            │
└──────────────────────────────────────────────────────┘
```

---

### Palette — Adding Services

The left sidebar lists all supported AWS services grouped by category:

- **Compute** — Lambda, EC2, Fargate
- **Data** — RDS, DynamoDB, S3, ElastiCache
- **Integration** — SQS, SNS, API Gateway, ALB
- **Network** — VPC, CloudFront
- **Other** — External (third-party system), User (client/end-user)

**To add a service:** click and drag any item from the palette onto the canvas. The node appears where you drop it and is immediately selected.

---

### Canvas — Moving and Connecting

**Moving nodes**
Click and drag any node to reposition it. Positions snap to a 10px grid automatically.

**Drawing edges (connections)**
Each node has a small circular port on its right edge. To connect two nodes:
1. Hover over the source node until the port appears.
2. Click and drag from the port.
3. Release the drag over the destination node.

A curved bezier arrow is drawn between the two nodes. Self-connections are not allowed.

**Selecting edges**
Click directly on any arrow to select it. The edge turns blue and its properties appear in the Inspector.

**Panning the canvas**
Click and drag on empty canvas space to pan. The cursor changes to a grabbing hand while panning.

**Zooming**
Scroll the mouse wheel over the canvas to zoom in or out. Zoom is centered on the cursor position. The zoom range is 0.3× to 3×.

**Deleting**
Select a node or edge, then press `Delete` or `Backspace`.

---

### Inspector — Editing Properties

Clicking a node or edge opens its properties in the right sidebar.

**Node properties:**

| Field | Description |
|---|---|
| ID | Auto-generated unique identifier (read-only) |
| Service | The AWS service type (read-only) |
| Label | Display name shown on the diagram — editable |
| Properties (JSON) | Service-specific configuration as a free-form JSON object |

Each service type comes with sensible property defaults:

| Service | Default properties |
|---|---|
| Lambda | `runtime: "nodejs20.x"`, `memory: 512` |
| EC2 | `instanceType: "t3.micro"` |
| Fargate | `cpu: 256`, `memory: 512` |
| RDS | `engine: "postgres"`, `instanceClass: "db.t3.micro"` |
| DynamoDB | `billingMode: "PAY_PER_REQUEST"` |
| ElastiCache | `engine: "redis"` |
| VPC | `cidr: "10.0.0.0/16"` |

You can add any additional keys to the Properties JSON — they are preserved in the saved file and will be available to the MCP/CFN generation layer.

**Edge properties:**

| Field | Description |
|---|---|
| ID | Auto-generated unique identifier (read-only) |
| From | Source node ID (read-only) |
| To | Destination node ID (read-only) |
| Label | Optional description shown on the arrow — editable |

The **Delete node** and **Delete edge** buttons in the Inspector remove the selected element. Deleting a node also deletes all edges connected to it.

---

### File Contents Pane

The bottom pane shows a live, syntax-highlighted JSON preview of the entire diagram state. It updates in real time as you make changes. The header shows a count of current nodes and edges.

This is the exact JSON that gets saved to disk and later read by the MCP server for CFN generation.

---

### Topbar Actions

| Button | Action |
|---|---|
| **New** | Clears the canvas and starts a fresh diagram. Prompts for confirmation if there are unsaved nodes. |
| **Chat with AI** | Opens the AI chat panel on the right side of the screen. |
| **Open** | Opens a file picker to load a previously saved `.arch.json` file. |
| **Save** | Downloads the current diagram as a `.arch.json` file. |
| **Copy as Mermaid** | Copies the diagram as a Mermaid `flowchart LR` string to the clipboard. The button text briefly changes to "Copied" to confirm. |

---

## AI Chat Assistant

The AI chat panel is powered by Anthropic's Claude model. It acts as an expert AWS solutions architect embedded directly in the editor.

### Setup

1. Click **Chat with AI** in the topbar. The panel slides in from the right.
2. Paste your Claude API key (starts with `sk-...`) into the **API Key** field at the bottom of the panel.
3. Your key is saved to browser `localStorage` automatically — you only need to enter it once per browser.
4. Type a message and press **Enter** (or click **Send**).

> **Security note:** Your API key is stored only in your own browser's localStorage and is sent directly from your browser to `api.Claude.com`. It is never sent to any other server.

### Diagram Context

When the **"Include current diagram as context"** checkbox is checked (default: on), the AI automatically receives the current diagram in Mermaid format as part of its system prompt before every message. This lets it give architecture-specific answers such as:

- "Your diagram is missing a load balancer in front of the EC2 instances."
- "RDS should be placed inside the VPC you've defined — connect them."
- "You may want to add an ElastiCache layer between Lambda and RDS to reduce DB load."

When the checkbox is unchecked, the AI answers as a general AWS assistant without diagram knowledge.

### Conversation Management

- **Multi-turn conversation:** The full message history is preserved within the session. The AI remembers what was said earlier in the conversation.
- **Shift+Enter:** Inserts a newline in the message input without sending.
- **Enter:** Sends the message.
- **Clear button:** Wipes the message history and resets the conversation.
- **Close (✕) button:** Slides the panel away without clearing history.
- **Typing indicator:** Animated dots appear while waiting for Claude's response.
- **Error display:** API errors (invalid key, rate limit, network failure) are shown inline in red.

---

## File Format

Diagrams are saved as `.arch.json` files. The format is versioned and designed to be human-readable.

### Schema Overview

```json
{
  "schemaVersion": "0.1.0",
  "metadata": {
    "name": "My Architecture",
    "createdAt": "2026-04-24T00:00:00.000Z"
  },
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

### Node Object

```json
{
  "id": "n_abc123",
  "type": "lambda",
  "label": "Auth Handler",
  "x": 200,
  "y": 140,
  "props": {
    "runtime": "nodejs20.x",
    "memory": 512
  }
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier, auto-generated with a `n_` prefix |
| `type` | string | AWS service type key (see [Supported AWS Services](#supported-aws-services)) |
| `label` | string | Human-readable display name shown on the diagram |
| `x` | number | Canvas X position in world coordinates (snapped to 10px grid) |
| `y` | number | Canvas Y position in world coordinates (snapped to 10px grid) |
| `props` | object | Arbitrary service configuration properties |

### Edge Object

```json
{
  "id": "e_xyz789",
  "from": "n_abc123",
  "to": "n_def456",
  "label": "invoke"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier, auto-generated with an `e_` prefix |
| `from` | string | ID of the source node |
| `to` | string | ID of the destination node |
| `label` | string | Optional description of the connection |

### Full Example

```json
{
  "schemaVersion": "0.1.0",
  "metadata": {
    "name": "Simple Web App",
    "createdAt": "2026-04-24T10:00:00.000Z"
  },
  "nodes": [
    {
      "id": "n_1a2b3c",
      "type": "user",
      "label": "Browser",
      "x": 40,
      "y": 100,
      "props": {}
    },
    {
      "id": "n_4d5e6f",
      "type": "apigateway",
      "label": "REST API",
      "x": 240,
      "y": 100,
      "props": {}
    },
    {
      "id": "n_7g8h9i",
      "type": "lambda",
      "label": "Handler",
      "x": 440,
      "y": 100,
      "props": {
        "runtime": "nodejs20.x",
        "memory": 512
      }
    },
    {
      "id": "n_jklmno",
      "type": "dynamodb",
      "label": "Users Table",
      "x": 640,
      "y": 100,
      "props": {
        "billingMode": "PAY_PER_REQUEST"
      }
    }
  ],
  "edges": [
    { "id": "e_1", "from": "n_1a2b3c", "to": "n_4d5e6f", "label": "HTTPS" },
    { "id": "e_2", "from": "n_4d5e6f", "to": "n_7g8h9i", "label": "invoke" },
    { "id": "e_3", "from": "n_7g8h9i", "to": "n_jklmno", "label": "read/write" }
  ]
}
```

---

## Mermaid Export

Clicking **Copy as Mermaid** produces a Mermaid `flowchart LR` diagram that can be pasted directly into GitHub markdown, Notion, or any Mermaid-compatible renderer.

**Example output for the diagram above:**

```
flowchart LR
  n_1a2b3c["Browser<br><small>User</small>"]
  n_4d5e6f["REST API<br><small>API Gateway</small>"]
  n_7g8h9i["Handler<br><small>Lambda</small>"]
  n_jklmno["Users Table<br><small>DynamoDB</small>"]
  n_1a2b3c -->|HTTPS| n_4d5e6f
  n_4d5e6f -->|invoke| n_7g8h9i
  n_7g8h9i -->|read/write| n_jklmno
```

This Mermaid representation is also the format sent to Claude when the AI chat's "Include current diagram" option is enabled.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Delete` / `Backspace` | Delete the selected node or edge (when focus is not in a text field) |
| `Enter` (in chat) | Send the current chat message |
| `Shift+Enter` (in chat) | Insert a newline in the chat input |

---

## Supported AWS Services

| Key | Display Name | Category | Default Properties |
|---|---|---|---|
| `lambda` | Lambda | Compute | `runtime: "nodejs20.x"`, `memory: 512` |
| `ec2` | EC2 | Compute | `instanceType: "t3.micro"` |
| `fargate` | Fargate | Compute | `cpu: 256`, `memory: 512` |
| `rds` | RDS | Data | `engine: "postgres"`, `instanceClass: "db.t3.micro"` |
| `dynamodb` | DynamoDB | Data | `billingMode: "PAY_PER_REQUEST"` |
| `s3` | S3 | Data | _(none)_ |
| `elasticache` | ElastiCache | Data | `engine: "redis"` |
| `sqs` | SQS | Integration | _(none)_ |
| `sns` | SNS | Integration | _(none)_ |
| `apigateway` | API Gateway | Integration | _(none)_ |
| `alb` | ALB | Integration | _(none)_ |
| `vpc` | VPC | Network | `cidr: "10.0.0.0/16"` |
| `cloudfront` | CloudFront | Network | _(none)_ |
| `external` | External | Other | _(none)_ |
| `user` | User | Other | _(none)_ |

---

## Architecture & Design Decisions

**Single HTML file**
The entire editor is a single `.html` file with no external dependencies, no bundler, and no build step. This makes it trivially easy to open and share — just double-click the file.

**SVG canvas**
The canvas is rendered as an SVG element. Nodes are `<g>` groups containing `<rect>` and `<text>` elements. Edges are cubic bezier `<path>` elements. SVG provides crisp rendering at any zoom level and makes hit-testing straightforward.

**Structured JSON state**
All diagram data lives in a single `state` object that is the source of truth. Every user action (add, move, delete, edit) mutates this object and calls `render()`, which redraws the entire SVG from scratch. This makes state management simple and predictable.

**Mermaid as the interchange format**
Rather than inventing a custom serialization format, InfraAgent uses Mermaid `flowchart LR` as the human-readable text representation. This gives compatibility with existing tools and is also the format provided to the AI for diagram-aware chat.

**AI chat is context-injected, not fine-tuned**
The AI assistant is a standard Claude model. Architecture awareness is achieved purely by injecting the current Mermaid diagram into the system prompt on every message. No fine-tuning or custom model is required.

**localStorage for API key persistence**
The Claude API key is stored in browser `localStorage` under the key `Claude_api_key`. It is sent directly from the browser to `api.Claude.com` and never passes through any intermediate server.

---

## CLI Agent - Prompt to Deployed Infrastructure

The `cli/` directory contains a **terminal-based agent** that completes the full workflow:

### From Prompt → AWS Deployment in 4 Phases

1. **Architecture Design** (AI Agent)
   - Reads your repository context
   - Uses Claude to design complete AWS architecture
   - Includes production-ready defaults and IAM permissions

2. **User Approval** (Interactive Terminal)
   - Reviews generated resources and connections
   - Shows detailed configuration
   - Requires explicit approval before proceeding

3. **CDK Code Generation** (AI Agent)
   - Generates production-ready TypeScript CDK code
   - Creates complete project (lib/, bin/, package.json, etc.)
   - Implements all resources with exact props and methods

4. **Deployment** (Automated)
   - Runs `npm install` and builds TypeScript
   - Bootstraps CDK environment (if needed)
   - Deploys to your AWS account
   - Shows stack outputs

### Quick Start

```bash
cd cli
npm install
export ANTHROPIC_API_KEY=sk-ant-...

# Run the agent
node bin/infra-agent.js

# Or install globally
npm link
infra-agent
```

See [cli/README.md](cli/README.md) for complete documentation.

### Example Session

```
What infrastructure would you like to build?
> I need a serverless REST API with a database

🤖 Generating architecture...
  + node  apigateway    RestAPI
  + node  lambda        HandlerFunction
  + node  dynamodb      AppTable
  + edge  RestAPI → HandlerFunction (invoke)
  + edge  HandlerFunction → AppTable (read/write)

✅ Architecture generated: 3 resources, 2 connections

[Shows detailed review]

✅ Proceed with CDK code generation? yes

🤖 Starting CDK Code Generation Agent...
   ✓ lib/my-stack-stack.ts
   ✓ bin/my-stack.ts
   ✓ package.json
   ... (7 files total)

Deploy to AWS now? yes

🚀 Deploying to AWS...
✅ Deployment completed successfully!
```

## Roadmap

**Completed:**
- ✅ AI-powered architecture design from natural language
- ✅ Interactive approval workflow
- ✅ CDK code generation with AI agent that references AWS documentation
- ✅ Automated AWS deployment
- ✅ Built-in comprehensive AWS CDK documentation (15+ services)
- ✅ Documentation-driven code generation (research-then-write approach)

**In Progress:**
- **MCP Server** — Expose as MCP tools for Claude Code and other agents
- **AWS MCP Integration** — Connect to [official AWS MCP server](https://github.com/awslabs/mcp) for real-time docs
- **Diagram templates** — Pre-built patterns (three-tier web app, event-driven pipeline)

**Planned:**
- **Grouping / VPC containers** — Visual grouping of nodes inside VPC boundaries
- **More service types** — IAM roles, Secrets Manager, EventBridge, Step Functions, EKS
- **Undo / Redo** — Command history for reversible edits
- **Multi-stack support** — Generate multiple related stacks
- **Cost estimation** — Preview monthly costs before deployment
- **CDK validation** — Pre-deployment checks via `cdk doctor` and linting

See [cli/AWS_MCP_INTEGRATION.md](cli/AWS_MCP_INTEGRATION.md) for details on AWS documentation integration.

---

## Contributing

This project was built for LA Hacks 2026. The codebase lives entirely in `DiagramEditorv1.html`.

To contribute:
1. Open the file in a text editor.
2. Make your changes.
3. Open the file in a browser and verify visually.
4. Submit a pull request.

There is no build step, no `npm install`, and no test suite to run.
