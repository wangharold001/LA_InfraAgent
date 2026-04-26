################################################################################
# aws.tf
# All AWS resources for the UberEats-style delivery platform:
#   • S3 Static Assets Bucket (+ OAC)
#   • WAFv2 Web ACL (CLOUDFRONT scope, us-east-1)
#   • CloudFront Distribution
#   • Cognito User Pool + App Clients (customer / driver / restaurant)
#   • API Gateway v2 (HTTP) + Cognito JWT Authorizer + Stage
#   • Supporting IAM roles / policies
################################################################################

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

################################################################################
# 1. S3 — Static Assets Bucket
################################################################################

resource "aws_s3_bucket" "static_assets_bucket" {
  bucket        = "${local.name_prefix}-static-assets-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.s3_force_destroy

  tags = {
    Name = "${local.name_prefix}-static-assets"
  }

  # In prod-like environments prevent accidental deletion of persistent data.
  lifecycle {
    prevent_destroy = false # flip to true for staging/prod
  }
}

# Block all public access — assets are served only via CloudFront OAC
resource "aws_s3_bucket_public_access_block" "static_assets_bucket" {
  bucket = aws_s3_bucket.static_assets_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable versioning so rollbacks of static-asset deployments are possible
resource "aws_s3_bucket_versioning" "static_assets_bucket" {
  bucket = aws_s3_bucket.static_assets_bucket.id

  versioning_configuration {
    status = var.s3_versioning_enabled ? "Enabled" : "Suspended"
  }
}

# Server-side encryption at rest using S3-managed keys (AES-256)
resource "aws_s3_bucket_server_side_encryption_configuration" "static_assets_bucket" {
  bucket = aws_s3_bucket.static_assets_bucket.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Website configuration — SPA with index.html as root
resource "aws_s3_bucket_website_configuration" "static_assets_bucket" {
  bucket = aws_s3_bucket.static_assets_bucket.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html" # SPA: return index.html for all 404s so React Router works
  }
}

# Bucket ownership controls — required when OAC is used (ACLs disabled)
resource "aws_s3_bucket_ownership_controls" "static_assets_bucket" {
  bucket = aws_s3_bucket.static_assets_bucket.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# S3 bucket policy — allow CloudFront OAC to GetObject
resource "aws_s3_bucket_policy" "static_assets_bucket" {
  bucket = aws_s3_bucket.static_assets_bucket.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAC"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.static_assets_bucket.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.cf_distribution.arn
          }
        }
      }
    ]
  })

  # The distribution must exist before we can reference its ARN
  depends_on = [aws_cloudfront_distribution.cf_distribution]
}

################################################################################
# 2. CloudFront Origin Access Control (OAC)
################################################################################

resource "aws_cloudfront_origin_access_control" "static_assets_oac" {
  name                              = "${local.name_prefix}-static-assets-oac"
  description                       = "OAC for ${local.name_prefix} static assets bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

################################################################################
# 3. WAFv2 Web ACL — CLOUDFRONT scope (must be in us-east-1)
################################################################################

resource "aws_wafv2_web_acl" "api_waf" {
  provider = aws.us_east_1

  name        = "${local.name_prefix}-cf-waf"
  description = "WAF ACL protecting CloudFront for ${local.name_prefix}. Blocks SQLi, XSS, and known bad inputs."
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # ── Rule 1: AWS Common Rule Set ─────────────────────────────────────────────
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10

    override_action {
      none {} # honour the managed-rule group's own actions
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = var.waf_enable_cloudwatch_metrics
      metric_name                = "${local.name_prefix}-CommonRuleSet"
      sampled_requests_enabled   = var.waf_sampled_requests_enabled
    }
  }

  # ── Rule 2: Known Bad Inputs ─────────────────────────────────────────────────
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = var.waf_enable_cloudwatch_metrics
      metric_name                = "${local.name_prefix}-KnownBadInputs"
      sampled_requests_enabled   = var.waf_sampled_requests_enabled
    }
  }

  # ── Rule 3: SQL Injection ────────────────────────────────────────────────────
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 30

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = var.waf_enable_cloudwatch_metrics
      metric_name                = "${local.name_prefix}-SQLiRuleSet"
      sampled_requests_enabled   = var.waf_sampled_requests_enabled
    }
  }

  # ── Top-level visibility ─────────────────────────────────────────────────────
  visibility_config {
    cloudwatch_metrics_enabled = var.waf_enable_cloudwatch_metrics
    metric_name                = "${local.name_prefix}-WAF"
    sampled_requests_enabled   = var.waf_sampled_requests_enabled
  }

  tags = {
    Name = "${local.name_prefix}-cf-waf"
  }
}

################################################################################
# 4. CloudFront Distribution
################################################################################

resource "aws_cloudfront_distribution" "cf_distribution" {
  enabled             = true
  is_ipv6_enabled     = var.cf_enable_ipv6
  comment             = "UberEats CDN — ${var.environment}"
  default_root_object = var.cf_default_root_object
  price_class         = var.cf_price_class
  http_version        = "http2and3"

  # Attach the WAF Web ACL (must reference the WAF in us-east-1)
  web_acl_id = aws_wafv2_web_acl.api_waf.arn

  # ── Origin 1: S3 static assets via OAC ──────────────────────────────────────
  origin {
    origin_id                = "s3-static-assets"
    domain_name              = aws_s3_bucket.static_assets_bucket.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.static_assets_oac.id
  }

  # ── Origin 2: API Gateway (HTTP API) ────────────────────────────────────────
  origin {
    origin_id   = "apigw-main"
    domain_name = replace(aws_apigatewayv2_api.main_api_gateway.api_endpoint, "https://", "")

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # ── Default cache behaviour → S3 static assets ─────────────────────────────
  default_cache_behavior {
    target_origin_id       = "s3-static-assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400   # 1 day
    max_ttl     = 31536000 # 1 year
  }

  # ── Ordered cache behaviour → API calls (/api/*) ────────────────────────────
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "apigw-main"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Origin", "Accept", "Content-Type"]
      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 0  # Do not cache API responses by default
    max_ttl     = 0
  }

  # ── Geo restriction — none (global delivery) ─────────────────────────────────
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # ── TLS / viewer certificate ─────────────────────────────────────────────────
  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = var.cf_minimum_tls_version
    ssl_support_method             = "sni-only"
  }

  # ── Custom error responses — SPA fallback ────────────────────────────────────
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  tags = {
    Name = "${local.name_prefix}-cf"
  }

  depends_on = [aws_wafv2_web_acl.api_waf]
}

################################################################################
# 5. Cognito User Pool
################################################################################

resource "aws_cognito_user_pool" "cognito_user_pool" {
  name = "${local.name_prefix}-users"

  # Allow users to sign in with their email address
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Allow users to sign themselves up
  admin_create_user_config {
    allow_admin_create_user_only = !var.cognito_allow_self_signup
  }

  # Password policy
  password_policy {
    minimum_length                   = var.cognito_password_min_length
    require_uppercase                = true
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # MFA configuration
  mfa_configuration = var.cognito_mfa_configuration

  software_token_mfa_configuration {
    enabled = true # TOTP / OTP support
  }

  # Account recovery via email + phone
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
    recovery_mechanism {
      name     = "verified_phone_number"
      priority = 2
    }
  }

  # Schema attributes
  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 3
      max_length = 254
    }
  }

  schema {
    name                     = "phone_number"
    attribute_data_type      = "String"
    required                 = false
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 0
      max_length = 20
    }
  }

  # Custom attribute: user role (customer | driver | restaurant)
  schema {
    name                     = "user_role"
    attribute_data_type      = "String"
    required                 = false
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 0
      max_length = 20
    }
  }

  # Email verification message
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your ${var.project_name} verification code"
    email_message        = "Your verification code is {####}"
  }

  user_pool_add_ons {
    advanced_security_mode = "AUDIT"
  }

  tags = {
    Name = "${local.name_prefix}-cognito-user-pool"
  }
}

# ── App Client: Customer App ──────────────────────────────────────────────────
resource "aws_cognito_user_pool_client" "customer_app_client" {
  name         = "${local.name_prefix}-customer-app-client"
  user_pool_id = aws_cognito_user_pool.cognito_user_pool.id

  generate_secret = false # Public SPA/mobile client

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  access_token_validity  = 1   # hours
  id_token_validity      = 1   # hours
  refresh_token_validity = 30  # days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"

  supported_identity_providers = ["COGNITO"]
}

# ── App Client: Driver App ────────────────────────────────────────────────────
resource "aws_cognito_user_pool_client" "driver_app_client" {
  name         = "${local.name_prefix}-driver-app-client"
  user_pool_id = aws_cognito_user_pool.cognito_user_pool.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"

  supported_identity_providers = ["COGNITO"]
}

# ── App Client: Restaurant Dashboard ─────────────────────────────────────────
resource "aws_cognito_user_pool_client" "restaurant_app_client" {
  name         = "${local.name_prefix}-restaurant-app-client"
  user_pool_id = aws_cognito_user_pool.cognito_user_pool.id

  generate_secret = true # Server-side / confidential client

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_CUSTOM_AUTH",
  ]

  access_token_validity  = 8   # longer session for restaurant staff shifts
  id_token_validity      = 8
  refresh_token_validity = 60

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"

  supported_identity_providers = ["COGNITO"]
}

# ── Cognito User Pool Domain ──────────────────────────────────────────────────
resource "aws_cognito_user_pool_domain" "cognito_domain" {
  domain       = "${local.name_prefix}-auth"
  user_pool_id = aws_cognito_user_pool.cognito_user_pool.id
}

# ── User Groups ───────────────────────────────────────────────────────────────
resource "aws_cognito_user_group" "customers" {
  name         = "customers"
  user_pool_id = aws_cognito_user_pool.cognito_user_pool.id
  description  = "End-customers browsing menus and placing orders"
  precedence   = 3
}

resource "aws_cognito_user_group" "drivers" {
  name         = "drivers"
  user_pool_id = aws_cognito_user_pool.cognito_user_pool.id
  description  = "Delivery drivers accepting and completing deliveries"
  precedence   = 2
}

resource "aws_cognito_user_group" "restaurants" {
  name         = "restaurants"
  user_pool_id = aws_cognito_user_pool.cognito_user_pool.id
  description  = "Restaurant staff managing menus and orders"
  precedence   = 1
}

################################################################################
# 6. API Gateway v2 (HTTP API)
################################################################################

resource "aws_apigatewayv2_api" "main_api_gateway" {
  name          = "${local.name_prefix}-api"
  protocol_type = "HTTP"
  description   = "Central REST API for the ${var.project_name} platform (${var.environment})"

  cors_configuration {
    allow_origins  = var.api_cors_allow_origins
    allow_methods  = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
    allow_headers  = ["Content-Type", "Authorization", "X-Amz-Date", "X-Api-Key", "X-Amz-Security-Token"]
    expose_headers = ["X-Request-Id"]
    max_age        = 3600
  }

  tags = {
    Name = "${local.name_prefix}-api"
  }
}

# ── JWT Authorizer backed by Cognito ─────────────────────────────────────────
resource "aws_apigatewayv2_authorizer" "cognito_jwt" {
  api_id           = aws_apigatewayv2_api.main_api_gateway.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.name_prefix}-cognito-authorizer"

  jwt_configuration {
    audience = [
      aws_cognito_user_pool_client.customer_app_client.id,
      aws_cognito_user_pool_client.driver_app_client.id,
      aws_cognito_user_pool_client.restaurant_app_client.id,
    ]
    issuer = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.cognito_user_pool.id}"
  }
}

# ── API Stage with access logging and throttling ──────────────────────────────
resource "aws_cloudwatch_log_group" "api_gateway_logs" {
  name              = "/aws/apigateway/${local.name_prefix}-api"
  retention_in_days = 30

  tags = {
    Name = "${local.name_prefix}-apigw-logs"
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main_api_gateway.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.api_throttle_burst_limit
    throttling_rate_limit  = var.api_throttle_rate_limit
    detailed_metrics_enabled = true
    logging_level            = "INFO" # ERROR | INFO | OFF
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway_logs.arn
  }

  tags = {
    Name = "${local.name_prefix}-apigw-default-stage"
  }
}

# ── IAM: allow API Gateway to write to CloudWatch Logs ───────────────────────
resource "aws_iam_role" "apigw_cloudwatch_role" {
  name = "${local.name_prefix}-apigw-cw-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "APIGatewayAssume"
        Effect = "Allow"
        Principal = {
          Service = "apigateway.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-apigw-cw-role"
  }
}

resource "aws_iam_role_policy_attachment" "apigw_cloudwatch" {
  role       = aws_iam_role.apigw_cloudwatch_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

# API Gateway account-level CloudWatch role (one per account/region)
resource "aws_api_gateway_account" "main" {
  cloudwatch_role_arn = aws_iam_role.apigw_cloudwatch_role.arn
}

################################################################################
# 7. Data sources
################################################################################

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
