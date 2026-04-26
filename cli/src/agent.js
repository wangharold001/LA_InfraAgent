import Anthropic from "@anthropic-ai/sdk";
import { createDiagram, TOOLS } from "./diagram.js";
import { VALID_NODE_TYPES_PROMPT } from "./diagram-services.js";

export const MODE_PROMPTS = {
  minimal:    "COST MODE — Minimal: prioritize zero fixed costs. Use serverless-first (Lambda/Azure Functions/Cloud Run, managed NoSQL, object storage). Avoid VMs, VPCs, NAT gateways, and any always-on compute unless strictly required. Set removal_policy to destroy on everything.",
  simple:     "COST MODE — Simple: prefer managed serverless but allow one always-on tier (e.g. a single-AZ relational DB or a single container service) if the use case needs it. No VPC/VNet unless required.",
  standard:   "COST MODE — Standard: production-ready but cost-conscious. Use a VPC/VNet with public and private subnets. Single-AZ for databases unless load demands otherwise. Add async messaging (SQS/Service Bus/Pub-Sub) for decoupling where appropriate.",
  enterprise: "COST MODE — Enterprise: assume high-availability and compliance. Multi-AZ/multi-region for all stateful resources, managed caching layer, WAF, encryption in transit and at rest everywhere, monitoring and alerting on all critical paths.",
};

const SYSTEM = (repoContext, mode) => {
  let prompt = `\
You are an expert multi-cloud solutions architect. Your output is consumed by a downstream Terraform code-generation agent — every node and edge must be filled in completely so that agent needs zero guesswork.
Use the provided tools to build the diagram. Do not explain — just call the tools.`;

  if (mode && MODE_PROMPTS[mode]) prompt += `\n\n${MODE_PROMPTS[mode]}`;

  prompt += `

METADATA — call set_metadata first with name, stackName, providers (array of clouds used: aws/azure/gcp), region (if AWS nodes), and environment.

NODES — always call add_node with:
- tfId: snake_case unique Terraform resource local name (e.g. "user_auth_function", "orders_table")
- provider is inferred from the node type — pick the right service type for the target cloud
- props: full Terraform props object — include ALL relevant attributes for the resource. Fill unspecified fields with provider-recommended defaults.
  Key rules by type:
  AWS:
    lambda: runtime (nodejs20.x/python3.12/etc), handler, filename, memory_size, timeout, environment_variables map, tracing_mode "Active", removal_policy
    dynamodb: hash_key, hash_key_type, billing_mode, point_in_time_recovery true, server_side_encryption true, removal_policy "retain" for prod
    s3: versioning, block_public_acls true, block_public_policy true, server_side_encryption, force_destroy
    rds: engine, engine_version, instance_class, db_name, multi_az, storage_encrypted true, deletion_protection, removal_policy "snapshot"
    All stateful resources: default removal_policy to "retain" unless environment is dev
  Azure:
    az_functions: os_type, runtime_name, runtime_version, sku_name (Y1 for consumption), always_on
    az_cosmosdb: kind, offer_type, consistency_level, geo_redundant
    az_blob: account_tier, account_replication_type, allow_blob_public_access false, min_tls_version
    az_aks: kubernetes_version, node_count, vm_size
  GCP:
    gcp_cloud_run: location, image, cpu, memory, max_instance_count, allow_unauthenticated
    gcp_firestore: location_id, type (FIRESTORE_NATIVE/DATASTORE_MODE), deletion_policy
    gcp_gcs: location, storage_class, uniform_bucket_level_access true
    gcp_cloud_sql: database_version, tier, disk_autoresize, deletion_protection
- notes: 1–2 sentences on the resource's role and any non-obvious decisions

EDGES — always call add_edge with:
- relationship: one of the valid relationship types
- permissions: exact permission strings for the cloud:
  AWS: IAM action strings e.g. ["dynamodb:GetItem", "dynamodb:PutItem"]
  Azure: RBAC role names e.g. ["Storage Blob Data Contributor"]
  GCP: IAM roles e.g. ["roles/storage.objectViewer"]
  Empty array only for non-permission relationships (api-integration, trigger, etc.)
- tfRef: the Terraform resource or data source reference that wires them, e.g. "aws_iam_role_policy.lambda_dynamo" or "azurerm_role_assignment.func_cosmos"
- protocol: communication mechanism (HTTPS / gRPC / AMQP / Pub/Sub push / AWS SDK v3 / etc.)

For cross-cloud edges (e.g. AWS Lambda calling GCP Pub/Sub): set protocol to the actual wire protocol (HTTPS), permissions to whatever the source service needs on the destination, and tfRef to the relevant IAM/credential resource.

LAYOUT — left-to-right data flow (x ≥ 320px between same-row nodes), top-to-bottom tiers (y ~160px apart).
Valid node types: ${VALID_NODE_TYPES_PROMPT}.
Use "external" for any service not in that list (still fill props and notes).`;

  if (repoContext) prompt += `\n\nRepository files:\n${repoContext}`;
  return prompt;
};

export async function runAgent(repoContext, userPrompt, apiKey, { onTool, mode } = {}) {
  if (process.env.MOCK_API === "true") {
    const { state, executeTool } = createDiagram();
    executeTool("set_metadata", { name: "Mock Architecture", stackName: "mock-app", providers: ["aws"], region: "us-east-1", environment: "dev" });
    const api = executeTool("add_node", { type: "apigateway", label: "API Gateway", tfId: "api_gateway", x: 80,  y: 200 });
    const fn  = executeTool("add_node", { type: "lambda",     label: "Handler",     tfId: "handler_fn",  x: 480, y: 200 });
    const db  = executeTool("add_node", { type: "dynamodb",   label: "Table",       tfId: "app_table",   x: 880, y: 200 });
    executeTool("add_edge", { from_id: api.id, to_id: fn.id, label: "invoke", relationship: "api-integration", tfRef: "aws_apigatewayv2_integration.handler", protocol: "HTTPS", permissions: [] });
    executeTool("add_edge", { from_id: fn.id,  to_id: db.id, label: "read/write", relationship: "iam-grant", tfRef: "aws_iam_role_policy.lambda_dynamo", protocol: "AWS SDK v3", permissions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"] });
    return state;
  }

  const client = new Anthropic({ apiKey });
  const { state, executeTool } = createDiagram();

  const messages = [{ role: "user", content: userPrompt }];

  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM(repoContext, mode),
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") break;

    const results = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      if (onTool) onTool(block.name, block.input);
      const result = executeTool(block.name, block.input);
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }

    messages.push({ role: "user", content: results });
  }

  return state;
}
