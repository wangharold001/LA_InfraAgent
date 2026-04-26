/**
 * Single source of truth for diagram node types, Terraform resource mappings,
 * palette layout, and defaults. Used by diagram.js (CLI agent), renderer
 * (injected into browser HTML), and buildPaletteHtml().
 *
 * provider field drives palette grouping and node border color in the UI.
 */

function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** @type {Record<string, { label: string, short: string, color: string, provider: "aws"|"azure"|"gcp"|"generic" }>} */
export const SERVICE_META = {
  // ── AWS ────────────────────────────────────────────────────────────────────
  lambda:         { label: "Lambda",         short: "λ",    color: "#EF9F27", provider: "aws" },
  ec2:            { label: "EC2",            short: "EC2",  color: "#EF9F27", provider: "aws" },
  fargate:        { label: "Fargate",        short: "Farg", color: "#EF9F27", provider: "aws" },
  rds:            { label: "RDS",            short: "RDS",  color: "#378add", provider: "aws" },
  dynamodb:       { label: "DynamoDB",       short: "DDB",  color: "#378add", provider: "aws" },
  s3:             { label: "S3",             short: "S3",   color: "#1d9e75", provider: "aws" },
  elasticache:    { label: "ElastiCache",    short: "EC",   color: "#378add", provider: "aws" },
  opensearch:     { label: "OpenSearch",     short: "OS",   color: "#378add", provider: "aws" },
  documentdb:     { label: "DocumentDB",     short: "Doc",  color: "#378add", provider: "aws" },
  redshift:       { label: "Redshift",       short: "RS",   color: "#378add", provider: "aws" },
  efs:            { label: "EFS",            short: "EFS",  color: "#1d9e75", provider: "aws" },
  athena:         { label: "Athena",         short: "Ath",  color: "#9467bd", provider: "aws" },
  glue:           { label: "Glue",           short: "Glue", color: "#9467bd", provider: "aws" },
  sqs:            { label: "SQS",            short: "SQS",  color: "#d85a30", provider: "aws" },
  sns:            { label: "SNS",            short: "SNS",  color: "#d85a30", provider: "aws" },
  kinesis:        { label: "Kinesis",        short: "Kin",  color: "#d85a30", provider: "aws" },
  eventbridge:    { label: "EventBridge",    short: "EvB",  color: "#d85a30", provider: "aws" },
  stepfunctions:  { label: "Step Functions", short: "SFn",  color: "#d85a30", provider: "aws" },
  scheduler:      { label: "Scheduler",      short: "Sch",  color: "#d85a30", provider: "aws" },
  appsync:        { label: "AppSync",        short: "AppS", color: "#d85a30", provider: "aws" },
  apigateway:     { label: "API Gateway",    short: "API",  color: "#d85a30", provider: "aws" },
  alb:            { label: "ALB",            short: "ALB",  color: "#d85a30", provider: "aws" },
  nlb:            { label: "NLB",            short: "NLB",  color: "#d85a30", provider: "aws" },
  vpc:            { label: "VPC",            short: "VPC",  color: "#888780", provider: "aws" },
  cloudfront:     { label: "CloudFront",     short: "CF",   color: "#888780", provider: "aws" },
  route53:        { label: "Route 53",       short: "R53",  color: "#888780", provider: "aws" },
  waf:            { label: "WAF",            short: "WAF",  color: "#888780", provider: "aws" },
  acm:            { label: "ACM",            short: "ACM",  color: "#888780", provider: "aws" },
  cognito:        { label: "Cognito",        short: "Cog",  color: "#c45c00", provider: "aws" },
  kms:            { label: "KMS",            short: "KMS",  color: "#c45c00", provider: "aws" },
  secretsmanager: { label: "Secrets Mgr",   short: "Sec",  color: "#c45c00", provider: "aws" },

  // ── Azure ──────────────────────────────────────────────────────────────────
  az_functions:      { label: "Functions",      short: "Func", color: "#0078D4", provider: "azure" },
  az_container_apps: { label: "Container Apps", short: "CA",   color: "#0078D4", provider: "azure" },
  az_aks:            { label: "AKS",            short: "AKS",  color: "#0078D4", provider: "azure" },
  az_cosmosdb:       { label: "Cosmos DB",      short: "Cos",  color: "#006EBF", provider: "azure" },
  az_sql:            { label: "Azure SQL",      short: "SQL",  color: "#006EBF", provider: "azure" },
  az_blob:           { label: "Blob Storage",   short: "Blob", color: "#006EBF", provider: "azure" },
  az_redis:          { label: "Azure Redis",    short: "Rds",  color: "#006EBF", provider: "azure" },
  az_servicebus:     { label: "Service Bus",    short: "SB",   color: "#5C2D91", provider: "azure" },
  az_apim:           { label: "API Management", short: "APIM", color: "#0091DA", provider: "azure" },
  az_vnet:           { label: "Virtual Network",short: "VNet", color: "#0091DA", provider: "azure" },
  az_cdn:            { label: "Azure CDN",      short: "CDN",  color: "#0091DA", provider: "azure" },
  az_keyvault:       { label: "Key Vault",      short: "KV",   color: "#107C10", provider: "azure" },

  // ── GCP ────────────────────────────────────────────────────────────────────
  gcp_cloud_run:       { label: "Cloud Run",      short: "CR",  color: "#1a73e8", provider: "gcp" },
  gcp_cloud_functions: { label: "Cloud Functions",short: "CF",  color: "#1a73e8", provider: "gcp" },
  gcp_gke:             { label: "GKE",            short: "GKE", color: "#1a73e8", provider: "gcp" },
  gcp_firestore:       { label: "Firestore",      short: "FS",  color: "#188038", provider: "gcp" },
  gcp_cloud_sql:       { label: "Cloud SQL",      short: "SQL", color: "#188038", provider: "gcp" },
  gcp_gcs:             { label: "Cloud Storage",  short: "GCS", color: "#188038", provider: "gcp" },
  gcp_memorystore:     { label: "Memorystore",    short: "Mem", color: "#188038", provider: "gcp" },
  gcp_bigquery:        { label: "BigQuery",       short: "BQ",  color: "#188038", provider: "gcp" },
  gcp_pubsub:          { label: "Pub/Sub",        short: "PS",  color: "#E37400", provider: "gcp" },
  gcp_apigw:           { label: "API Gateway",    short: "API", color: "#c5221f", provider: "gcp" },
  gcp_vpc:             { label: "VPC Network",    short: "VPC", color: "#c5221f", provider: "gcp" },
  gcp_secret_manager:  { label: "Secret Manager", short: "SM",  color: "#7B1FA2", provider: "gcp" },

  // ── Generic ────────────────────────────────────────────────────────────────
  external: { label: "External",  short: "Ext", color: "#6b6b64", provider: "generic" },
  user:     { label: "User",      short: "Usr", color: "#6b6b64", provider: "generic" },
};

/** Maps service type → primary Terraform resource type for the generator's reference. */
export const TF_META = {
  // AWS
  lambda:         { resource: "aws_lambda_function",                    provider: "hashicorp/aws" },
  ec2:            { resource: "aws_instance",                           provider: "hashicorp/aws" },
  fargate:        { resource: "aws_ecs_service",                        provider: "hashicorp/aws" },
  rds:            { resource: "aws_db_instance",                        provider: "hashicorp/aws" },
  dynamodb:       { resource: "aws_dynamodb_table",                     provider: "hashicorp/aws" },
  s3:             { resource: "aws_s3_bucket",                          provider: "hashicorp/aws" },
  elasticache:    { resource: "aws_elasticache_replication_group",      provider: "hashicorp/aws" },
  opensearch:     { resource: "aws_opensearch_domain",                  provider: "hashicorp/aws" },
  documentdb:     { resource: "aws_docdb_cluster",                      provider: "hashicorp/aws" },
  redshift:       { resource: "aws_redshift_cluster",                   provider: "hashicorp/aws" },
  efs:            { resource: "aws_efs_file_system",                    provider: "hashicorp/aws" },
  athena:         { resource: "aws_athena_workgroup",                   provider: "hashicorp/aws" },
  glue:           { resource: "aws_glue_catalog_database",              provider: "hashicorp/aws" },
  sqs:            { resource: "aws_sqs_queue",                          provider: "hashicorp/aws" },
  sns:            { resource: "aws_sns_topic",                          provider: "hashicorp/aws" },
  kinesis:        { resource: "aws_kinesis_stream",                     provider: "hashicorp/aws" },
  eventbridge:    { resource: "aws_cloudwatch_event_bus",               provider: "hashicorp/aws" },
  stepfunctions:  { resource: "aws_sfn_state_machine",                  provider: "hashicorp/aws" },
  scheduler:      { resource: "aws_scheduler_schedule",                 provider: "hashicorp/aws" },
  appsync:        { resource: "aws_appsync_graphql_api",                provider: "hashicorp/aws" },
  apigateway:     { resource: "aws_apigatewayv2_api",                   provider: "hashicorp/aws" },
  alb:            { resource: "aws_lb",                                 provider: "hashicorp/aws" },
  nlb:            { resource: "aws_lb",                                 provider: "hashicorp/aws" },
  vpc:            { resource: "aws_vpc",                                provider: "hashicorp/aws" },
  cloudfront:     { resource: "aws_cloudfront_distribution",            provider: "hashicorp/aws" },
  route53:        { resource: "aws_route53_zone",                       provider: "hashicorp/aws" },
  waf:            { resource: "aws_wafv2_web_acl",                      provider: "hashicorp/aws" },
  acm:            { resource: "aws_acm_certificate",                    provider: "hashicorp/aws" },
  cognito:        { resource: "aws_cognito_user_pool",                  provider: "hashicorp/aws" },
  kms:            { resource: "aws_kms_key",                            provider: "hashicorp/aws" },
  secretsmanager: { resource: "aws_secretsmanager_secret",              provider: "hashicorp/aws" },
  // Azure
  az_functions:      { resource: "azurerm_linux_function_app",          provider: "hashicorp/azurerm" },
  az_container_apps: { resource: "azurerm_container_app",               provider: "hashicorp/azurerm" },
  az_aks:            { resource: "azurerm_kubernetes_cluster",           provider: "hashicorp/azurerm" },
  az_cosmosdb:       { resource: "azurerm_cosmosdb_account",            provider: "hashicorp/azurerm" },
  az_sql:            { resource: "azurerm_mssql_server",                provider: "hashicorp/azurerm" },
  az_blob:           { resource: "azurerm_storage_account",             provider: "hashicorp/azurerm" },
  az_redis:          { resource: "azurerm_redis_cache",                 provider: "hashicorp/azurerm" },
  az_servicebus:     { resource: "azurerm_servicebus_namespace",        provider: "hashicorp/azurerm" },
  az_apim:           { resource: "azurerm_api_management",              provider: "hashicorp/azurerm" },
  az_vnet:           { resource: "azurerm_virtual_network",             provider: "hashicorp/azurerm" },
  az_cdn:            { resource: "azurerm_cdn_profile",                 provider: "hashicorp/azurerm" },
  az_keyvault:       { resource: "azurerm_key_vault",                   provider: "hashicorp/azurerm" },
  // GCP
  gcp_cloud_run:       { resource: "google_cloud_run_v2_service",       provider: "hashicorp/google" },
  gcp_cloud_functions: { resource: "google_cloudfunctions2_function",   provider: "hashicorp/google" },
  gcp_gke:             { resource: "google_container_cluster",          provider: "hashicorp/google" },
  gcp_firestore:       { resource: "google_firestore_database",         provider: "hashicorp/google" },
  gcp_cloud_sql:       { resource: "google_sql_database_instance",      provider: "hashicorp/google" },
  gcp_gcs:             { resource: "google_storage_bucket",             provider: "hashicorp/google" },
  gcp_memorystore:     { resource: "google_redis_instance",             provider: "hashicorp/google" },
  gcp_bigquery:        { resource: "google_bigquery_dataset",           provider: "hashicorp/google" },
  gcp_pubsub:          { resource: "google_pubsub_topic",               provider: "hashicorp/google" },
  gcp_apigw:           { resource: "google_api_gateway_api",            provider: "hashicorp/google" },
  gcp_vpc:             { resource: "google_compute_network",            provider: "hashicorp/google" },
  gcp_secret_manager:  { resource: "google_secret_manager_secret",      provider: "hashicorp/google" },
  // Generic
  external: { resource: null, provider: null },
  user:     { resource: null, provider: null },
};

/** Default props per service type — Terraform-idiomatic field names used by the generator. */
export const NODE_TF_DEFAULTS = {
  // ── AWS ──────────────────────────────────────────────────────────────────
  lambda: {
    runtime: "nodejs20.x",
    handler: "index.handler",
    filename: "lambda.zip",
    memory_size: 512,
    timeout: 29,
    environment_variables: {},
    tracing_mode: "Active",
    reserved_concurrent_executions: -1,
    removal_policy: "destroy",
  },
  ec2: {
    instance_type: "t3.micro",
    ami: "amazon-linux-2023",
    associate_public_ip_address: false,
    key_name: null,
    removal_policy: "destroy",
  },
  fargate: {
    cpu: 256,
    memory: 512,
    image: "amazon/amazon-ecs-sample",
    container_port: 80,
    desired_count: 1,
    assign_public_ip: false,
    removal_policy: "destroy",
  },
  rds: {
    engine: "postgres",
    engine_version: "15.4",
    instance_class: "db.t3.micro",
    db_name: "appdb",
    multi_az: false,
    storage_encrypted: true,
    allocated_storage: 20,
    deletion_protection: false,
    removal_policy: "snapshot",
  },
  dynamodb: {
    hash_key: "pk",
    hash_key_type: "S",
    billing_mode: "PAY_PER_REQUEST",
    point_in_time_recovery: true,
    server_side_encryption: true,
    removal_policy: "retain",
  },
  s3: {
    versioning: false,
    block_public_acls: true,
    block_public_policy: true,
    server_side_encryption: "AES256",
    force_destroy: false,
    removal_policy: "retain",
  },
  elasticache: {
    engine: "redis",
    node_type: "cache.t3.micro",
    num_cache_clusters: 1,
    at_rest_encryption_enabled: true,
    transit_encryption_enabled: true,
    removal_policy: "destroy",
  },
  sqs: {
    fifo_queue: false,
    visibility_timeout_seconds: 30,
    message_retention_seconds: 345600,
    receive_wait_time_seconds: 0,
    max_receive_count: 3,
    kms_master_key_id: "alias/aws/sqs",
    removal_policy: "destroy",
  },
  sns: {
    fifo_topic: false,
    content_based_deduplication: false,
    kms_master_key_id: null,
    removal_policy: "destroy",
  },
  kinesis: {
    shard_count: 1,
    retention_period: 24,
    stream_mode: "PROVISIONED",
    encryption_type: "MANAGED",
    removal_policy: "destroy",
  },
  apigateway: {
    protocol_type: "HTTP",
    cors_allow_origins: ["*"],
    cors_allow_methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    removal_policy: "destroy",
  },
  alb: {
    internal: false,
    load_balancer_type: "application",
    enable_deletion_protection: false,
    removal_policy: "destroy",
  },
  nlb: {
    internal: false,
    load_balancer_type: "network",
    enable_cross_zone_load_balancing: true,
    removal_policy: "destroy",
  },
  vpc: {
    cidr_block: "10.0.0.0/16",
    enable_dns_hostnames: true,
    enable_dns_support: true,
    removal_policy: "destroy",
  },
  cloudfront: {
    price_class: "PriceClass_100",
    default_root_object: "index.html",
    http_version: "http2",
    removal_policy: "destroy",
  },
  cognito: {
    self_signup_enabled: true,
    username_attributes: ["email"],
    mfa_configuration: "OPTIONAL",
    removal_policy: "destroy",
  },
  kms: {
    enable_key_rotation: true,
    deletion_window_in_days: 10,
    removal_policy: "destroy",
  },
  secretsmanager: {
    recovery_window_in_days: 7,
    removal_policy: "destroy",
  },
  eventbridge: { removal_policy: "destroy" },
  stepfunctions: { type: "STANDARD", tracing_enabled: true, removal_policy: "destroy" },
  opensearch: {
    engine_version: "OpenSearch_2.11",
    instance_type: "t3.small.search",
    instance_count: 1,
    removal_policy: "destroy",
  },
  route53: { comment: "", private_zone: false, removal_policy: "destroy" },
  waf: { scope: "REGIONAL", default_action: "allow", removal_policy: "destroy" },
  acm: { domain_name: "example.com", validation_method: "DNS", removal_policy: "destroy" },
  efs: { encrypted: true, performance_mode: "generalPurpose", removal_policy: "destroy" },
  external: { endpoint: "", auth_type: "NONE" },
  user:     { auth_type: "cognito" },

  // ── Azure ─────────────────────────────────────────────────────────────────
  az_functions: {
    os_type: "Linux",
    runtime_name: "node",
    runtime_version: "20",
    sku_name: "Y1",
    always_on: false,
  },
  az_container_apps: {
    image: "mcr.microsoft.com/azuredocs/containerapps-helloworld",
    cpu: 0.25,
    memory: "0.5Gi",
    min_replicas: 0,
    max_replicas: 10,
  },
  az_aks: {
    kubernetes_version: "1.29",
    node_count: 1,
    vm_size: "Standard_D2_v2",
    os_disk_size_gb: 30,
    network_plugin: "azure",
  },
  az_cosmosdb: {
    kind: "GlobalDocumentDB",
    offer_type: "Standard",
    consistency_level: "Session",
    geo_redundant: false,
  },
  az_sql: {
    version: "12.0",
    sku_name: "GP_S_Gen5_1",
    max_size_gb: 32,
    zone_redundant: false,
  },
  az_blob: {
    account_tier: "Standard",
    account_replication_type: "LRS",
    allow_blob_public_access: false,
    min_tls_version: "TLS1_2",
  },
  az_redis: {
    capacity: 1,
    family: "C",
    sku_name: "Standard",
    enable_non_ssl_port: false,
    minimum_tls_version: "1.2",
  },
  az_servicebus: {
    sku: "Standard",
    capacity: 0,
  },
  az_apim: {
    sku_name: "Consumption_0",
    publisher_email: "admin@example.com",
    publisher_name: "Admin",
  },
  az_vnet: {
    address_space: ["10.0.0.0/16"],
    dns_servers: [],
  },
  az_cdn: {
    sku: "Standard_Microsoft",
  },
  az_keyvault: {
    sku_name: "standard",
    soft_delete_retention_days: 7,
    purge_protection_enabled: false,
    enabled_for_disk_encryption: false,
  },

  // ── GCP ───────────────────────────────────────────────────────────────────
  gcp_cloud_run: {
    location: "us-central1",
    image: "gcr.io/cloudrun/hello",
    cpu: "1",
    memory: "512Mi",
    max_instance_count: 10,
    min_instance_count: 0,
    allow_unauthenticated: true,
  },
  gcp_cloud_functions: {
    location: "us-central1",
    runtime: "nodejs20",
    entry_point: "helloWorld",
    available_memory: "256M",
    timeout_seconds: 60,
  },
  gcp_gke: {
    location: "us-central1",
    node_count: 1,
    machine_type: "e2-medium",
    disk_size_gb: 100,
    autopilot: false,
  },
  gcp_firestore: {
    location_id: "us-east1",
    type: "FIRESTORE_NATIVE",
    deletion_policy: "DELETE",
  },
  gcp_cloud_sql: {
    database_version: "POSTGRES_15",
    tier: "db-f1-micro",
    disk_autoresize: true,
    deletion_protection: false,
  },
  gcp_gcs: {
    location: "US",
    storage_class: "STANDARD",
    force_destroy: false,
    versioning_enabled: false,
    uniform_bucket_level_access: true,
  },
  gcp_memorystore: {
    tier: "BASIC",
    memory_size_gb: 1,
    redis_version: "REDIS_7_0",
  },
  gcp_bigquery: {
    location: "US",
    delete_contents_on_destroy: false,
  },
  gcp_pubsub: {
    message_retention_duration: "86400s",
    ack_deadline_seconds: 30,
  },
  gcp_apigw: {
    display_name: "My API",
  },
  gcp_vpc: {
    auto_create_subnetworks: false,
    routing_mode: "REGIONAL",
  },
  gcp_secret_manager: {
    replication_automatic: true,
  },
};

export const EDGE_RELATIONSHIPS = [
  "iam-grant",
  "role-assignment",
  "iam-binding",
  "event-source-mapping",
  "subscription",
  "api-integration",
  "origin",
  "trigger",
  "invoke",
  "stream-consumer",
  "read",
  "write",
  "read-write",
  "peering",
];

/** Palette sections grouped by cloud then function */
export const PALETTE_GROUPS = [
  // AWS
  { title: "Compute",     provider: "aws",     types: ["lambda", "ec2", "fargate"] },
  { title: "Data",        provider: "aws",     types: ["rds", "dynamodb", "s3", "elasticache", "opensearch", "documentdb", "redshift", "efs", "athena", "glue"] },
  { title: "Integration", provider: "aws",     types: ["sqs", "sns", "kinesis", "eventbridge", "stepfunctions", "scheduler", "appsync"] },
  { title: "Network",     provider: "aws",     types: ["vpc", "cloudfront", "apigateway", "alb", "nlb", "route53", "waf", "acm"] },
  { title: "Identity",    provider: "aws",     types: ["cognito", "kms", "secretsmanager"] },
  // Azure
  { title: "Compute",     provider: "azure",   types: ["az_functions", "az_container_apps", "az_aks"] },
  { title: "Data",        provider: "azure",   types: ["az_cosmosdb", "az_sql", "az_blob", "az_redis"] },
  { title: "Network",     provider: "azure",   types: ["az_apim", "az_vnet", "az_cdn", "az_servicebus"] },
  { title: "Security",    provider: "azure",   types: ["az_keyvault"] },
  // GCP
  { title: "Compute",     provider: "gcp",     types: ["gcp_cloud_run", "gcp_cloud_functions", "gcp_gke"] },
  { title: "Data",        provider: "gcp",     types: ["gcp_firestore", "gcp_cloud_sql", "gcp_gcs", "gcp_memorystore", "gcp_bigquery"] },
  { title: "Network",     provider: "gcp",     types: ["gcp_pubsub", "gcp_apigw", "gcp_vpc"] },
  { title: "Security",    provider: "gcp",     types: ["gcp_secret_manager"] },
  // Generic
  { title: "Other",       provider: "generic", types: ["external", "user"] },
];

export function buildPaletteHtml() {
  const groups = PALETTE_GROUPS.filter((g) => Array.isArray(g.types) && g.types.length);
  const CLOUDS = ["aws", "azure", "gcp"];
  // First group visible by default is the first AWS group
  const firstGroup = groups.find(g => g.provider === "aws") || groups[0];
  const firstKey = `${firstGroup.provider}:${firstGroup.title}`;

  let html = `<div class="palette-shell">`;
  html += `<div class="palette-left-col">`;

  // Cloud toggle bar
  html += `<div class="palette-cloud-toggles">`;
  for (const cloud of CLOUDS) {
    const label = cloud === "aws" ? "AWS" : cloud === "azure" ? "Azure" : "GCP";
    const active = cloud === "aws" ? " active" : "";
    html += `<button class="palette-cloud-btn${active}" data-cloud="${cloud}">${label}</button>`;
  }
  html += `</div>`;

  // Category tabs + panels
  html += `<div class="palette-cats" role="tablist" aria-label="Service categories">`;
  html += `<div class="palette-head"><span class="palette-head-title">Services</span></div>`;
  for (const g of groups) {
    const key = escapeHtmlAttr(`${g.provider}:${g.title}`);
    const isActive = key === firstKey;
    const isVisible = g.provider === "aws";
    html += `<button class="palette-cat${isActive ? " active" : ""}" data-group="${key}" data-provider="${g.provider}" role="tab" aria-selected="${isActive ? "true" : "false"}" style="${isVisible ? "" : "display:none"}">${escapeHtmlAttr(g.title)}</button>`;
  }
  html += `</div>`;
  html += `</div>`; // .palette-left-col

  html += `<div class="palette-services" id="paletteServices">`;
  for (const g of groups) {
    const key = escapeHtmlAttr(`${g.provider}:${g.title}`);
    const isActive = key === firstKey;
    html += `<div class="palette-group-panel${isActive ? " active" : ""}" data-group="${key}" data-provider="${g.provider}" role="tabpanel">`;
    html += `<div class="palette-grid">`;
    for (const t of g.types) {
      const m = SERVICE_META[t];
      if (!m) continue;
      const title = escapeHtmlAttr(m.label);
      const short = escapeHtmlAttr(m.short);
      html += `<div class="palette-item" draggable="true" data-type="${t}" title="${title}"><span class="palette-swatch" style="background:${escapeHtmlAttr(m.color)}"></span><span class="palette-label-short">${short}</span><span class="palette-label-full">${title}</span></div>`;
    }
    html += `</div></div>`;
  }
  html += `</div></div>`;
  return html;
}

export function getDiagramServicePack() {
  return { SERVICE_META, TF_META, NODE_TF_DEFAULTS, EDGE_RELATIONSHIPS };
}

export const VALID_NODE_TYPES_PROMPT = Object.keys(SERVICE_META).sort().join(", ");
