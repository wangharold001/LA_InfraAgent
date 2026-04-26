# UberEats-Style Delivery Platform — Terraform Infrastructure

A production-ready AWS infrastructure stack for a multi-persona food-delivery platform (customers, drivers, restaurant staff). Managed entirely with Terraform using the AWS provider v5.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Clients: Customer App │ Driver App │ Restaurant Dashboard (HTTPS)       │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │  AWS WAFv2 Web ACL       │
                         │  (CLOUDFRONT scope)      │
                         │  • CommonRuleSet          │
                         │  • KnownBadInputs         │
                         │  • SQLiRuleSet            │
                         └────────────┬─────────────┘
                                      │ attached
                         ┌────────────▼────────────┐
                         │  CloudFront CDN          │
                         │  • http2and3             │
                         │  • TLSv1.2_2021 minimum  │
                         │  • IPv6 enabled           │
                         └────┬───────────────┬─────┘
                              │               │
               /api/*         │               │  /* (default)
         ┌────────────────────▼─┐       ┌─────▼──────────────────┐
         │  API Gateway v2      │       │  S3 Static Assets       │
         │  (HTTP API)          │       │  Bucket (private)       │
         │  • Cognito JWT Auth  │       │  • AES-256 encryption   │
         │  • CORS configured   │       │  • Versioning enabled   │
         │  • Access logging    │       │  • Block all public     │
         │  • Throttling        │       │    access               │
         └────────────┬─────────┘       │  • OAC-only access      │
                      │                 └─────────────────────────┘
         ┌────────────▼─────────┐
         │  Cognito User Pool   │
         │  • email sign-in     │
         │  • OPTIONAL MFA      │
         │  • 3 App Clients:    │
         │    · customer        │
         │    · driver          │
         │    · restaurant      │
         │  • 3 User Groups     │
         └──────────────────────┘
```

---

## File Structure

```
.
├── providers.tf       # Terraform + provider version pins, default tags
├── variables.tf       # All input variables with descriptions and validation
├── aws.tf             # All AWS resources (S3, CloudFront, WAF, Cognito, APIGW)
├── outputs.tf         # Useful output values (URLs, IDs, ARNs)
├── example.tfvars     # Template — copy to terraform.tfvars
└── README.md          # This file
```

---

## Prerequisites

| Tool | Minimum Version |
|------|----------------|
| [Terraform CLI](https://developer.hashicorp.com/terraform/downloads) | 1.5+ |
| [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) | 2.x |
| AWS credentials with sufficient IAM permissions | — |

### Required IAM permissions (deploying user/role)

The principal running `terraform apply` must be able to manage:
- `cloudfront:*`
- `wafv2:*`
- `s3:*`
- `cognito-idp:*`
- `apigateway:*`
- `logs:*`
- `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PassRole`

---

## Quick Start

### 1 — Clone & configure

```bash
# Clone the repo / copy these files into your project
cp example.tfvars terraform.tfvars
# Edit terraform.tfvars with your values
```

### 2 — Authenticate with AWS

```bash
# Option A: named profile
export AWS_PROFILE=my-profile

# Option B: environment variables
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1

# Verify
aws sts get-caller-identity
```

### 3 — Initialise Terraform

```bash
terraform init
```

### 4 — Preview the plan

```bash
terraform plan -var-file=terraform.tfvars
```

### 5 — Apply

```bash
terraform apply -var-file=terraform.tfvars
```

After a successful apply, Terraform prints all outputs. Key ones:

| Output | Description |
|--------|-------------|
| `frontend_url` | CloudFront HTTPS URL — serve this to users |
| `api_base_url` | API Gateway invoke URL prefix for all /api/* calls |
| `static_assets_bucket_name` | S3 bucket — target for `aws s3 sync` in CI/CD |
| `cloudfront_distribution_id` | Used for `aws cloudfront create-invalidation` |
| `cognito_user_pool_id` | Configure Amplify / SDK with this |
| `cognito_customer_client_id` | App Client ID for the customer app |
| `cognito_driver_client_id` | App Client ID for the driver app |
| `cognito_restaurant_client_id` | App Client ID for the restaurant dashboard |

---

## Deploying the React Front-End

```bash
# Build
npm run build     # or yarn build

# Sync to S3 (long-lived assets with hash in filename get long cache)
aws s3 sync ./build s3://$(terraform output -raw static_assets_bucket_name) \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

# Upload index.html with short TTL so new deploys propagate quickly
aws s3 cp ./build/index.html \
  s3://$(terraform output -raw static_assets_bucket_name)/index.html \
  --cache-control "no-cache"

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id $(terraform output -raw cloudfront_distribution_id) \
  --paths "/*"
```

---

## Wiring Lambda Microservices to API Gateway

The API Gateway and Cognito JWT authorizer are deployed and ready. To add a Lambda route:

```hcl
# Example: /api/orders route protected by Cognito JWT
resource "aws_lambda_function" "orders" { ... }

resource "aws_apigatewayv2_integration" "orders" {
  api_id                 = aws_apigatewayv2_api.main_api_gateway.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.orders.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "orders" {
  api_id             = aws_apigatewayv2_api.main_api_gateway.id
  route_key          = "ANY /api/orders/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.orders.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id
  authorization_type = "JWT"
}

resource "aws_lambda_permission" "orders_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.orders.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main_api_gateway.execution_arn}/*/*/api/orders/*"
}
```

---

## Environment Promotion

Use Terraform workspaces or separate variable files:

```bash
# Staging
terraform workspace new staging
terraform apply -var-file=staging.tfvars

# Production (with stronger settings)
terraform workspace new prod
terraform apply -var-file=prod.tfvars
```

Recommended prod overrides (`prod.tfvars`):
```hcl
environment                = "prod"
cf_price_class             = "PriceClass_All"
s3_force_destroy           = false
cognito_mfa_configuration  = "ON"
api_cors_allow_origins     = ["https://yourdomain.com"]
api_throttle_burst_limit   = 10000
api_throttle_rate_limit    = 5000
```

To enable destroy protection on stateful resources in prod, change `prevent_destroy = false` to `true` in `aws.tf` on the `aws_s3_bucket.static_assets_bucket` resource.

---

## Security Notes

| Area | Control |
|------|---------|
| S3 bucket | All public access blocked; OAC-only via CloudFront |
| CloudFront | TLSv1.2_2021 minimum; WAF attached at edge |
| WAF | CommonRuleSet + KnownBadInputs + SQLi rules active |
| API | JWT authorizer validates Cognito tokens on every request |
| Secrets | No passwords or keys hardcoded; Cognito restaurant client secret is Terraform sensitive output |
| IAM | Least-privilege: API Gateway only has `PushToCloudWatchLogs`; no wildcard `*` resource policies |

---

## Tear Down

```bash
terraform destroy -var-file=terraform.tfvars
```

> **Warning:** If you flip `prevent_destroy = true` in `aws.tf` (recommended for prod), Terraform will refuse to destroy the S3 bucket. Remove the lifecycle block or set it to `false` first.

---

## Troubleshooting

### WAF must be in us-east-1
The `aws_wafv2_web_acl` with `scope = "CLOUDFRONT"` **must** be created in `us-east-1`. This project uses an aliased provider (`aws.us_east_1`) for that resource automatically.

### CloudFront takes 15-20 minutes to deploy
`terraform apply` will wait for the distribution to reach `Deployed` state. This is normal.

### S3 bucket policy `depends_on` cycle
The bucket policy references `aws_cloudfront_distribution.cf_distribution.arn`. Terraform resolves this correctly via the explicit `depends_on` in `aws_s3_bucket_policy.static_assets_bucket`.

### Cognito `logging_level` on HTTP API stage
`logging_level` for HTTP APIs requires `detailed_metrics_enabled = true` and the account-level CloudWatch role (`aws_api_gateway_account`) to be set. Both are configured in this project.
