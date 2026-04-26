import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// =============================================================================
// Tool definitions (Anthropic tool format)
// =============================================================================

const AWS_KB_RETRIEVE_TOOL = {
  name: "aws_kb_retrieve",
  description: "Query AWS Terraform provider documentation, resource schemas, and best practices. Use before writing or changing any AWS resource block. Query with the Terraform resource type (e.g. 'aws_lambda_function runtime nodejs20', 'aws_dynamodb_table billing_mode PAY_PER_REQUEST').",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "Specific Terraform resource type and attributes to look up" } },
    required: ["query"],
  },
};

const AZURE_KB_RETRIEVE_TOOL = {
  name: "azure_kb_retrieve",
  description: "Query Azure Terraform provider (azurerm) documentation, resource schemas, and best practices. Use before writing any azurerm_* resource block. Query with the resource type and attribute (e.g. 'azurerm_linux_function_app site_config', 'azurerm_cosmosdb_account consistency_policy').",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "Specific azurerm resource type and attributes to look up" } },
    required: ["query"],
  },
};

const GCP_KB_RETRIEVE_TOOL = {
  name: "gcp_kb_retrieve",
  description: "Query GCP Terraform provider (google) documentation, resource schemas, and best practices. Use before writing any google_* resource block. Query with the resource type and attribute (e.g. 'google_cloud_run_v2_service template containers', 'google_firestore_database type FIRESTORE_NATIVE').",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "Specific google provider resource type and attributes to look up" } },
    required: ["query"],
  },
};

const WRITE_FILE_TOOL = {
  name: "write_file",
  description: "Write a file in the Terraform project directory. Use relative paths from the project root (e.g. 'providers.tf', 'aws.tf', 'azure.tf', 'gcp.tf', 'variables.tf', 'outputs.tf', 'README.md').",
  input_schema: {
    type: "object",
    properties: {
      path:    { type: "string", description: "Relative file path within the Terraform project" },
      content: { type: "string", description: "Complete file content" },
    },
    required: ["path", "content"],
  },
};

const READ_FILE_TOOL = {
  name: "read_file",
  description: "Read any file in the Terraform project directory. Use to inspect a file before patching it.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "Relative file path within the Terraform project" } },
    required: ["path"],
  },
};

const PROPOSE_PATCH_TOOL = {
  name: "propose_patch",
  description: "Propose a fix for a deployment failure. Provide the COMPLETE new content for each file to change. The orchestrator will classify SAFE or RISKY, optionally prompt the user, then apply and redeploy. Do NOT use write_file during repair.",
  input_schema: {
    type: "object",
    properties: {
      summary:   { type: "string", description: "One-sentence summary of what the patch fixes" },
      rationale: { type: "string", description: "Why this change fixes the error" },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path:       { type: "string" },
            newContent: { type: "string" },
            reason:     { type: "string" },
            riskLevel:  { type: "string", enum: ["safe", "risky"] },
          },
          required: ["path", "newContent", "riskLevel"],
        },
      },
    },
    required: ["summary", "files"],
  },
};

export const GENERATION_TOOLS = [
  AWS_KB_RETRIEVE_TOOL,
  AZURE_KB_RETRIEVE_TOOL,
  GCP_KB_RETRIEVE_TOOL,
  WRITE_FILE_TOOL,
  READ_FILE_TOOL,
];

export const REPAIR_TOOLS = [
  AWS_KB_RETRIEVE_TOOL,
  AZURE_KB_RETRIEVE_TOOL,
  GCP_KB_RETRIEVE_TOOL,
  READ_FILE_TOOL,
  PROPOSE_PATCH_TOOL,
];

// =============================================================================
// Tool dispatcher
// =============================================================================

export async function dispatchTool(block, ctx) {
  const { name, id, input } = block;
  try {
    switch (name) {
      case "aws_kb_retrieve":
        return ok(id, await queryAWSDocumentation(input.query || ""));
      case "azure_kb_retrieve":
        return ok(id, await queryAzureDocumentation(input.query || ""));
      case "gcp_kb_retrieve":
        return ok(id, await queryGCPDocumentation(input.query || ""));
      case "write_file":
        return ok(id, handleWriteFile(input, ctx));
      case "read_file":
        return ok(id, handleReadFile(input, ctx));
      case "propose_patch":
        ctx.proposedPatch = input;
        return ok(id, "Patch recorded. The orchestrator will classify SAFE/RISKY and apply or ask the user.");
      default:
        return err(id, `Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(id, `Tool error in ${name}: ${e.message}`);
  }
}

function ok(id, content) {
  return { tool_use_id: id, content: typeof content === "string" ? content : JSON.stringify(content) };
}
function err(id, msg) {
  return { tool_use_id: id, content: msg, is_error: true };
}

// =============================================================================
// File tool handlers
// =============================================================================

function handleWriteFile(input, ctx) {
  const rel = input.path;
  const filePath = safeJoin(ctx.outputDir, rel);
  const body = String(input.content ?? "");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
  if (!ctx.generatedFiles.includes(rel)) ctx.generatedFiles.push(rel);
  return `Written: ${rel} (${body.length} bytes)`;
}

function handleReadFile(input, ctx) {
  const filePath = safeJoin(ctx.outputDir, input.path);
  if (!fs.existsSync(filePath)) return `File not found: ${input.path}`;
  return fs.readFileSync(filePath, "utf8");
}

function safeJoin(base, rel) {
  const baseAbs = path.resolve(base);
  const target  = path.resolve(base, rel);
  if (target !== baseAbs && !target.startsWith(baseAbs + path.sep))
    throw new Error(`Path escapes project directory: ${rel}`);
  return target;
}

// =============================================================================
// Patch risk classification
// =============================================================================

export function classifyPatch(files = []) {
  const RISKY_PATTERNS = [
    // AWS IAM
    /aws_iam_policy/i, /assume_role_policy/i, /Effect.*Allow/,
    // Azure RBAC
    /azurerm_role_assignment/i, /azurerm_role_definition/i,
    // GCP IAM
    /google_.*iam_binding/i, /google_.*iam_member/i, /google_.*iam_policy/i,
    // Network security
    /security_group_rule/i, /network_security_rule/i, /google_compute_firewall/i,
    // Removal/lifecycle
    /prevent_destroy\s*=\s*true/i, /retention_policy/i,
    // Public exposure
    /allow_blob_public_access\s*=\s*true/i, /block_public/i,
  ];
  const combined = files.map(f => f.newContent || "").join("\n");
  return RISKY_PATTERNS.some(p => p.test(combined)) ? "RISKY" : "SAFE";
}

// =============================================================================
// Deployment helpers (re-exported for iac-pipeline)
// =============================================================================

export function tail(text, maxBytes) {
  if (!text) return "";
  if (text.length <= maxBytes) return text;
  return "...(truncated)\n" + text.slice(-maxBytes);
}

export async function getRecentTFFailureEvents(tfDir, maxLines = 50) {
  // Terraform doesn't have a separate events API like CloudFormation.
  // Read the last N lines of the most recent log transcript if present.
  const logDir = path.join(tfDir, ".infra-agent");
  if (!fs.existsSync(logDir)) return "";
  const logs = fs.readdirSync(logDir).filter(f => f.endsWith(".log")).sort();
  if (!logs.length) return "";
  const last = fs.readFileSync(path.join(logDir, logs[logs.length - 1]), "utf8");
  return last.split("\n").slice(-maxLines).join("\n");
}

// =============================================================================
// AWS Terraform documentation (built-in snippets)
// =============================================================================

async function queryAWSDocumentation(query) {
  console.log(`   📚 Querying AWS Terraform docs: "${query}"`);
  const q = query.toLowerCase();
  const docs = {
    lambda: `
Terraform AWS Lambda Function (aws_lambda_function):

resource "aws_lambda_function" "my_function" {
  function_name = "my-function"
  runtime       = "nodejs20.x"   # nodejs20.x | python3.12 | java21 | go1.x
  handler       = "index.handler"
  filename      = "lambda.zip"   # or use s3_bucket + s3_key
  memory_size   = 512
  timeout       = 29             # max 900s; set <= API Gateway timeout if behind APIGW

  environment {
    variables = { KEY = "value" }
  }

  tracing_config { mode = "Active" }

  role = aws_iam_role.lambda_role.arn
}

# Execution role (always required)
resource "aws_iam_role" "lambda_role" {
  name = "lambda-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })
}
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
`,
    dynamodb: `
Terraform AWS DynamoDB (aws_dynamodb_table):

resource "aws_dynamodb_table" "my_table" {
  name         = "my-table"
  billing_mode = "PAY_PER_REQUEST"  # or PROVISIONED
  hash_key     = "pk"
  range_key    = "sk"               # optional sort key

  attribute { name = "pk"; type = "S" }
  attribute { name = "sk"; type = "S" }

  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }

  lifecycle { prevent_destroy = false }
}

# Grant Lambda read/write
resource "aws_iam_role_policy" "lambda_dynamo" {
  name = "lambda-dynamo-policy"
  role = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
      Resource = aws_dynamodb_table.my_table.arn
    }]
  })
}
`,
    apigateway: `
Terraform AWS API Gateway v2 (aws_apigatewayv2_api):

resource "aws_apigatewayv2_api" "my_api" {
  name          = "my-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.my_api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.my_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.my_function.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.my_api.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.my_function.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.my_api.execution_arn}/*/*"
}
`,
    s3: `
Terraform AWS S3 (aws_s3_bucket + companions):

resource "aws_s3_bucket" "my_bucket" {
  bucket        = "my-unique-bucket-name"
  force_destroy = false
}
resource "aws_s3_bucket_versioning" "my_bucket" {
  bucket = aws_s3_bucket.my_bucket.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "my_bucket" {
  bucket = aws_s3_bucket.my_bucket.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } }
}
resource "aws_s3_bucket_public_access_block" "my_bucket" {
  bucket                  = aws_s3_bucket.my_bucket.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
`,
    sqs: `
Terraform AWS SQS (aws_sqs_queue):

resource "aws_sqs_queue" "my_queue" {
  name                       = "my-queue"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 345600   # 4 days
  receive_wait_time_seconds  = 0
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.my_dlq.arn
    maxReceiveCount     = 3
  })
}
resource "aws_sqs_queue" "my_dlq" {
  name                    = "my-queue-dlq"
  sqs_managed_sse_enabled = true
}
# Lambda event source
resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn = aws_sqs_queue.my_queue.arn
  function_name    = aws_lambda_function.my_function.arn
  batch_size       = 10
}
`,
    rds: `
Terraform AWS RDS (aws_db_instance):

resource "aws_db_instance" "my_db" {
  identifier        = "my-db"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  db_name           = "appdb"
  username          = "dbadmin"
  password          = random_password.db_password.result

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_encrypted     = true
  multi_az              = false
  deletion_protection   = false
  skip_final_snapshot   = true
  publicly_accessible   = false

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
}
resource "random_password" "db_password" {
  length  = 32
  special = false
}
`,
  };

  // Match query against known topics
  for (const [key, snippet] of Object.entries(docs)) {
    if (q.includes(key)) return snippet;
  }
  return `No built-in snippet found for "${query}". Use official Terraform AWS provider docs at registry.terraform.io/providers/hashicorp/aws/latest/docs. Common patterns: resource blocks, data sources, provider config, IAM roles + policies.`;
}

// =============================================================================
// Azure Terraform documentation (built-in snippets)
// =============================================================================

async function queryAzureDocumentation(query) {
  console.log(`   📚 Querying Azure Terraform docs: "${query}"`);
  const q = query.toLowerCase();
  const docs = {
    function: `
Terraform Azure Functions (azurerm_linux_function_app):

resource "azurerm_resource_group" "main" {
  name     = "my-rg"
  location = "East US"
}
resource "azurerm_storage_account" "func" {
  name                     = "funcstorageacct"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
resource "azurerm_service_plan" "func" {
  name                = "func-plan"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "Y1"  # Consumption (serverless); use "P1v2" for premium
}
resource "azurerm_linux_function_app" "my_func" {
  name                       = "my-function-app"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  storage_account_name       = azurerm_storage_account.func.name
  storage_account_access_key = azurerm_storage_account.func.primary_access_key
  service_plan_id            = azurerm_service_plan.func.id

  identity { type = "SystemAssigned" }

  site_config {
    application_stack { node_version = "20" }
  }
}
# Role assignment (RBAC)
resource "azurerm_role_assignment" "func_cosmos" {
  scope                = azurerm_cosmosdb_account.my_cosmos.id
  role_definition_name = "Cosmos DB Built-in Data Contributor"
  principal_id         = azurerm_linux_function_app.my_func.identity[0].principal_id
}
`,
    cosmosdb: `
Terraform Azure Cosmos DB (azurerm_cosmosdb_account):

resource "azurerm_cosmosdb_account" "my_cosmos" {
  name                = "my-cosmos-account"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"  # or MongoDB, Cassandra, Table, Gremlin

  consistency_policy {
    consistency_level       = "Session"  # Eventual | ConsistentPrefix | Session | BoundedStaleness | Strong
    max_interval_in_seconds = 5
    max_staleness_prefix    = 100
  }

  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }

  capabilities { name = "EnableServerless" }  # optional for serverless
}
resource "azurerm_cosmosdb_sql_database" "main" {
  name                = "appdb"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.my_cosmos.name
}
resource "azurerm_cosmosdb_sql_container" "main" {
  name                = "items"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.my_cosmos.name
  database_name       = azurerm_cosmosdb_sql_database.main.name
  partition_key_path  = "/id"
  throughput          = null  # null = serverless
}
`,
    blob: `
Terraform Azure Blob Storage (azurerm_storage_account):

resource "azurerm_storage_account" "my_storage" {
  name                     = "mystorageaccount"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"  # LRS | GRS | RAGRS | ZRS
  min_tls_version          = "TLS1_2"
  allow_nested_items_to_be_public = false

  blob_properties {
    versioning_enabled = true
    delete_retention_policy { days = 7 }
  }
}
resource "azurerm_storage_container" "main" {
  name                  = "data"
  storage_account_name  = azurerm_storage_account.my_storage.name
  container_access_type = "private"
}
`,
    servicebus: `
Terraform Azure Service Bus (azurerm_servicebus_namespace):

resource "azurerm_servicebus_namespace" "my_sb" {
  name                = "my-servicebus-ns"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Standard"  # Basic | Standard | Premium
}
resource "azurerm_servicebus_queue" "my_queue" {
  name         = "my-queue"
  namespace_id = azurerm_servicebus_namespace.my_sb.id

  enable_partitioning               = false
  max_size_in_megabytes             = 1024
  default_message_ttl               = "P14D"  # ISO 8601 duration
  lock_duration                     = "PT1M"
  max_delivery_count                = 10
  dead_lettering_on_message_expiration = true
}
`,
    keyvault: `
Terraform Azure Key Vault (azurerm_key_vault):

data "azurerm_client_config" "current" {}
resource "azurerm_key_vault" "my_kv" {
  name                = "my-key-vault"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  soft_delete_retention_days = 7
  purge_protection_enabled   = false

  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = azurerm_linux_function_app.my_func.identity[0].principal_id
    secret_permissions      = ["Get", "List"]
    key_permissions         = []
    certificate_permissions = []
  }
}
`,
  };

  for (const [key, snippet] of Object.entries(docs)) {
    if (q.includes(key)) return snippet;
  }
  return `No built-in snippet found for "${query}". Use official Terraform AzureRM provider docs at registry.terraform.io/providers/hashicorp/azurerm/latest/docs. Note: most Azure resources require a resource group (azurerm_resource_group) and system-assigned managed identity for RBAC.`;
}

// =============================================================================
// GCP Terraform documentation (built-in snippets)
// =============================================================================

async function queryGCPDocumentation(query) {
  console.log(`   📚 Querying GCP Terraform docs: "${query}"`);
  const q = query.toLowerCase();
  const docs = {
    "cloud run": `
Terraform GCP Cloud Run v2 (google_cloud_run_v2_service):

resource "google_cloud_run_v2_service" "my_service" {
  name     = "my-cloud-run-service"
  location = "us-central1"

  template {
    containers {
      image = "gcr.io/cloudrun/hello"

      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }

      env {
        name  = "ENV_VAR"
        value = "value"
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    service_account = google_service_account.run_sa.email
  }
}
# Allow public access (remove for private)
resource "google_cloud_run_v2_service_iam_member" "public" {
  location = google_cloud_run_v2_service.my_service.location
  name     = google_cloud_run_v2_service.my_service.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
# Service account
resource "google_service_account" "run_sa" {
  account_id   = "cloud-run-sa"
  display_name = "Cloud Run Service Account"
}
# Grant Firestore access
resource "google_project_iam_member" "run_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:\${google_service_account.run_sa.email}"
}
`,
    firestore: `
Terraform GCP Firestore (google_firestore_database):

resource "google_firestore_database" "my_db" {
  project     = var.project_id
  name        = "my-firestore-db"   # "(default)" for the default database
  location_id = "us-east1"
  type        = "FIRESTORE_NATIVE"  # FIRESTORE_NATIVE or DATASTORE_MODE

  delete_protection_state = "DELETE_PROTECTION_DISABLED"
  deletion_policy         = "DELETE"

  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
}
# Grant service account access
resource "google_project_iam_member" "firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:\${google_service_account.run_sa.email}"
}
`,
    pubsub: `
Terraform GCP Pub/Sub (google_pubsub_topic + subscription):

resource "google_pubsub_topic" "my_topic" {
  name    = "my-topic"
  project = var.project_id

  message_retention_duration = "86400s"  # 1 day

  schema_settings {
    schema   = "projects/\${var.project_id}/schemas/my-schema"
    encoding = "JSON"
  }
}
resource "google_pubsub_subscription" "my_sub" {
  name    = "my-subscription"
  topic   = google_pubsub_topic.my_topic.id
  project = var.project_id

  ack_deadline_seconds = 30

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  # Push to Cloud Run
  push_config {
    push_endpoint = "\${google_cloud_run_v2_service.my_service.uri}/push"
    oidc_token {
      service_account_email = google_service_account.run_sa.email
    }
  }
}
`,
    "cloud storage": `
Terraform GCP Cloud Storage (google_storage_bucket):

resource "google_storage_bucket" "my_bucket" {
  name          = "my-unique-bucket-name"
  location      = "US"
  storage_class = "STANDARD"
  project       = var.project_id

  force_destroy = false

  versioning { enabled = true }

  uniform_bucket_level_access = true

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 365 }
  }
}
# Grant access
resource "google_storage_bucket_iam_member" "viewer" {
  bucket = google_storage_bucket.my_bucket.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:\${google_service_account.run_sa.email}"
}
`,
    "cloud sql": `
Terraform GCP Cloud SQL (google_sql_database_instance):

resource "google_sql_database_instance" "my_db" {
  name             = "my-db-instance"
  database_version = "POSTGRES_15"
  region           = var.gcp_region
  project          = var.project_id

  settings {
    tier = "db-f1-micro"

    backup_configuration {
      enabled    = true
      start_time = "03:00"
      point_in_time_recovery_enabled = true
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.my_vpc.id
    }

    disk_autoresize = true
  }

  deletion_protection = false
}
resource "google_sql_database" "appdb" {
  name     = "appdb"
  instance = google_sql_database_instance.my_db.name
  project  = var.project_id
}
resource "google_sql_user" "dbuser" {
  name     = "dbadmin"
  instance = google_sql_database_instance.my_db.name
  password = random_password.db_pass.result
  project  = var.project_id
}
resource "random_password" "db_pass" {
  length  = 32
  special = false
}
`,
  };

  for (const [key, snippet] of Object.entries(docs)) {
    if (q.includes(key)) return snippet;
  }
  return `No built-in snippet found for "${query}". Use official Terraform Google provider docs at registry.terraform.io/providers/hashicorp/google/latest/docs. Key patterns: google_service_account for identity, google_project_iam_member for RBAC, var.project_id for project references.`;
}
