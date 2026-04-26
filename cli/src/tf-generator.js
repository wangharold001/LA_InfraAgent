import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { GENERATION_TOOLS, REPAIR_TOOLS, dispatchTool } from "./tf-tools.js";

// =============================================================================
// System prompts
// =============================================================================

function buildGenerationSystemPrompt(state) {
  const providers = state.metadata?.providers || [];
  const hasAWS   = providers.includes("aws")   || state.nodes.some(n => !n.provider || n.provider === "aws");
  const hasAzure = providers.includes("azure") || state.nodes.some(n => n.provider === "azure");
  const hasGCP   = providers.includes("gcp")   || state.nodes.some(n => n.provider === "gcp");

  const providerBlocks = [];
  if (hasAWS)   providerBlocks.push(`    aws = { source = "hashicorp/aws", version = "~> 5.0" }`);
  if (hasAzure) providerBlocks.push(`    azurerm = { source = "hashicorp/azurerm", version = "~> 3.0" }`);
  if (hasGCP)   providerBlocks.push(`    google = { source = "hashicorp/google", version = "~> 5.0" }`);

  return `You are an expert Terraform engineer generating production-ready HCL for a multi-cloud infrastructure diagram.

Use aws_kb_retrieve, azure_kb_retrieve, and gcp_kb_retrieve to verify resource schemas and best practices before writing any resource block.
Use write_file to create files. Use read_file to inspect files you already wrote before modifying.

PROJECT STRUCTURE — write these files:
- providers.tf    Required providers block + all provider configs
- variables.tf    Input variables (aws_region, azure_location, gcp_project_id, gcp_region, environment, etc.)
- outputs.tf      Useful outputs (API endpoint URLs, bucket names, connection strings, etc.)
${hasAWS   ? "- aws.tf         All AWS resources" : ""}
${hasAzure ? "- azure.tf       All Azure resources (include azurerm_resource_group at top)" : ""}
${hasGCP   ? "- gcp.tf         All GCP resources" : ""}
- .gitignore      Terraform standard gitignore
- README.md       Deployment instructions

PROVIDERS — providers.tf must include:
terraform {
  required_version = ">= 1.5"
  required_providers {
${providerBlocks.join("\n")}
  }
}
${hasAWS   ? 'provider "aws" { region = var.aws_region }' : ""}
${hasAzure ? 'provider "azurerm" { features {} }' : ""}
${hasGCP   ? 'provider "google" { project = var.gcp_project_id; region = var.gcp_region }' : ""}

IAM / RBAC — always generate complete permission resources:
- AWS: aws_iam_role + aws_iam_role_policy or aws_iam_role_policy_attachment for each service that needs access. Every Lambda needs an execution role. Every cross-service access needs an explicit policy.
- Azure: azurerm_role_assignment using system-assigned managed identities (identity { type = "SystemAssigned" }) on compute resources. Never hardcode credentials.
- GCP: google_service_account per compute resource + google_project_iam_member or google_*_iam_member for each access grant.

NAMING — use var.environment as a suffix/prefix on resource names to avoid collisions across environments.

SECRETS — never hardcode passwords or keys. Use random_password for DB passwords, reference Key Vault / Secrets Manager / Secret Manager for app secrets.

LIFECYCLE — for stateful resources in prod-like environments:
- AWS: lifecycle { prevent_destroy = true } on RDS, DynamoDB, S3 with important data
- Azure: deletion protection flags where available
- GCP: deletion_protection = true on Cloud SQL

OUTPUTS — always output API Gateway URLs, load balancer DNS names, storage bucket names, and any connection strings the application needs.

Work methodically:
1. Call aws_kb_retrieve / azure_kb_retrieve / gcp_kb_retrieve for any resource type you haven't written recently
2. Write providers.tf first, then variables.tf, then each cloud file, then outputs.tf, then .gitignore and README.md
3. Cross-cloud wiring: if a resource in one cloud calls another (e.g. Lambda → GCP Pub/Sub), add the relevant credentials/endpoints as environment variables on the caller and IAM grants on the callee`;
}

export const REPAIR_SYSTEM_PROMPT = `You are an expert Terraform engineer diagnosing a deployment failure.

You have access to:
- aws_kb_retrieve / azure_kb_retrieve / gcp_kb_retrieve — look up correct resource schemas
- read_file — inspect any .tf file before patching
- propose_patch — propose the fix (COMPLETE file content for each changed file)

PROCESS:
1. Read the failure context carefully — identify the exact resource and attribute that failed
2. Use the relevant kb_retrieve tool to verify the correct schema
3. Read the affected .tf file with read_file
4. Call propose_patch ONCE with the minimal fix. Provide COMPLETE file content.
5. Mark riskLevel "risky" if the patch touches: IAM roles/policies, RBAC role assignments, GCP IAM bindings, security group rules, network ACLs, lifecycle prevent_destroy, or any public-access settings.

Common Terraform failure patterns:
- "Error: Invalid value" → wrong enum value for an attribute (check provider docs)
- "Error: Missing required argument" → required block or attribute not set
- "Error: Cycle" → circular dependencies between resources; use depends_on or restructure references
- "Error: Provider configuration not present" → missing or misconfigured provider block
- "Error: 409 Conflict" → resource already exists; may need import or name change
- "Error: 403 Forbidden" → insufficient IAM/RBAC permissions to create the resource (check your CLI credentials, not the app IAM)
- Azure "Principal X does not exist" → AAD replication lag; add depends_on or a time_sleep resource
- GCP "Project X not found" → project_id variable not set

Do not over-engineer. The smallest correct change wins.`;

// =============================================================================
// Stateful agent wrapper
// =============================================================================

class TFAgent {
  constructor(client, ctx) {
    this.client = client;
    this.ctx = ctx;
    this.messages = [];
  }

  pushUserMessage(content) {
    this.messages.push({ role: "user", content });
  }

  async runUntilStop({ system, tools, maxIterations = 20 }) {
    let iterations = 0;
    let proposedPatch = null;

    while (iterations < maxIterations) {
      iterations++;
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system,
        tools,
        messages: this.messages,
      });

      this.messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") break;

      const results = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        if (block.name === "write_file") {
          process.stdout.write(`   ✓ ${block.input.path} `);
        } else if (["aws_kb_retrieve", "azure_kb_retrieve", "gcp_kb_retrieve"].includes(block.name)) {
          // already logged inside dispatchTool
        }

        const result = await dispatchTool(block, this.ctx);
        if (block.name === "write_file") console.log(`(${(block.input.content || "").length} bytes)`);
        if (block.name === "propose_patch") proposedPatch = this.ctx.proposedPatch;

        results.push({ type: "tool_result", tool_use_id: result.tool_use_id, content: result.content, ...(result.is_error ? { is_error: true } : {}) });
      }

      this.messages.push({ role: "user", content: results });
    }

    return { proposedPatch, stopReason: "maxIterations" };
  }
}

// =============================================================================
// Main entry point
// =============================================================================

export async function generateTerraformCode(state, outputDir, apiKey) {
  fs.mkdirSync(outputDir, { recursive: true });

  const ctx = {
    outputDir,
    generatedFiles: [],
    proposedPatch: null,
    mode: "generate",
  };

  const client = new Anthropic({ apiKey });
  const agent = new TFAgent(client, ctx);

  const diagramJson = JSON.stringify(state, null, 2);
  const systemPrompt = buildGenerationSystemPrompt(state);

  const userMessage = `Generate a complete Terraform project for this multi-cloud infrastructure diagram.

DIAGRAM STATE:
${diagramJson}

Write all files listed in your instructions. Every resource in the diagram must appear in the Terraform code with correct IAM/RBAC grants for all edges. Use the kb_retrieve tools to verify schemas before writing.`;

  agent.pushUserMessage(userMessage);
  await agent.runUntilStop({ system: systemPrompt, tools: GENERATION_TOOLS, maxIterations: 30 });

  return { agent, generatedFiles: ctx.generatedFiles };
}

export function generateReadme(outputDir, metadata = {}) {
  const name = metadata.name || "Infrastructure";
  const env  = metadata.environment || "dev";
  const providers = metadata.providers || [];

  const providerSetup = [];
  if (providers.includes("aws"))   providerSetup.push("- **AWS**: `aws configure` or set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION`");
  if (providers.includes("azure")) providerSetup.push("- **Azure**: `az login` and set `ARM_SUBSCRIPTION_ID`");
  if (providers.includes("gcp"))   providerSetup.push("- **GCP**: `gcloud auth application-default login` and set `TF_VAR_gcp_project_id`");

  const content = `# ${name} — Terraform Infrastructure

**Environment:** ${env}
**Providers:** ${providers.join(", ") || "AWS"}
**Generated by:** InfraAgent

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
${providerSetup.join("\n")}

## Deploy

\`\`\`bash
terraform init
terraform plan -out=tfplan
terraform apply tfplan
\`\`\`

## Destroy

\`\`\`bash
terraform destroy
\`\`\`

## Files

| File | Purpose |
|---|---|
| \`providers.tf\` | Provider configurations and required versions |
| \`variables.tf\` | Input variables |
| \`outputs.tf\` | Stack outputs (URLs, names, connection strings) |
${providers.includes("aws")   ? "| `aws.tf` | AWS resources |\n" : ""}${providers.includes("azure") ? "| `azure.tf` | Azure resources |\n" : ""}${providers.includes("gcp")   ? "| `gcp.tf` | GCP resources |\n" : ""}\
| \`README.md\` | This file |

## Notes

- Review \`variables.tf\` and set values via \`terraform.tfvars\` or environment variables (\`TF_VAR_*\`)
- Sensitive values (passwords, keys) are generated at apply time — check \`terraform output\` after deploy
- Stateful resources (databases, storage) have lifecycle protection in non-dev environments
`;

  fs.writeFileSync(path.join(outputDir, "README.md"), content, "utf8");
}
