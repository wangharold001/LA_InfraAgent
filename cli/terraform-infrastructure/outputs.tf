################################################################################
# outputs.tf
# All useful connection strings, URLs, and identifiers emitted after apply.
################################################################################

# ── CloudFront ────────────────────────────────────────────────────────────────

output "cloudfront_distribution_id" {
  description = "CloudFront Distribution ID — required for cache invalidation CI/CD steps."
  value       = aws_cloudfront_distribution.cf_distribution.id
}

output "cloudfront_distribution_arn" {
  description = "ARN of the CloudFront distribution."
  value       = aws_cloudfront_distribution.cf_distribution.arn
}

output "cloudfront_domain_name" {
  description = "Public HTTPS URL served by CloudFront. Point your DNS CNAME here."
  value       = "https://${aws_cloudfront_distribution.cf_distribution.domain_name}"
}

output "cloudfront_hosted_zone_id" {
  description = "CloudFront hosted zone ID — for Route 53 alias records."
  value       = aws_cloudfront_distribution.cf_distribution.hosted_zone_id
}

# ── WAFv2 ─────────────────────────────────────────────────────────────────────

output "waf_web_acl_id" {
  description = "WAFv2 Web ACL ID."
  value       = aws_wafv2_web_acl.api_waf.id
}

output "waf_web_acl_arn" {
  description = "WAFv2 Web ACL ARN — attach to additional CloudFront distributions or ALBs."
  value       = aws_wafv2_web_acl.api_waf.arn
}

# ── S3 ────────────────────────────────────────────────────────────────────────

output "static_assets_bucket_name" {
  description = "S3 bucket name for static assets. Use with 'aws s3 sync' in your CI/CD pipeline."
  value       = aws_s3_bucket.static_assets_bucket.bucket
}

output "static_assets_bucket_arn" {
  description = "ARN of the static assets S3 bucket."
  value       = aws_s3_bucket.static_assets_bucket.arn
}

output "static_assets_bucket_regional_domain" {
  description = "Regional domain name used by CloudFront OAC."
  value       = aws_s3_bucket.static_assets_bucket.bucket_regional_domain_name
}

# ── Cognito ───────────────────────────────────────────────────────────────────

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID — required by Amplify / SDK configuration."
  value       = aws_cognito_user_pool.cognito_user_pool.id
}

output "cognito_user_pool_arn" {
  description = "ARN of the Cognito User Pool."
  value       = aws_cognito_user_pool.cognito_user_pool.arn
}

output "cognito_user_pool_endpoint" {
  description = "Cognito issuer URL used for JWT validation."
  value       = "https://${aws_cognito_user_pool.cognito_user_pool.endpoint}"
}

output "cognito_user_pool_domain" {
  description = "Cognito hosted-UI domain prefix."
  value       = aws_cognito_user_pool_domain.cognito_domain.domain
}

output "cognito_customer_client_id" {
  description = "Cognito App Client ID for the customer mobile/web app."
  value       = aws_cognito_user_pool_client.customer_app_client.id
}

output "cognito_driver_client_id" {
  description = "Cognito App Client ID for the driver mobile app."
  value       = aws_cognito_user_pool_client.driver_app_client.id
}

output "cognito_restaurant_client_id" {
  description = "Cognito App Client ID for the restaurant management dashboard."
  value       = aws_cognito_user_pool_client.restaurant_app_client.id
}

output "cognito_restaurant_client_secret" {
  description = "Cognito App Client secret for the restaurant confidential client."
  value       = aws_cognito_user_pool_client.restaurant_app_client.client_secret
  sensitive   = true
}

# ── API Gateway ───────────────────────────────────────────────────────────────

output "api_gateway_id" {
  description = "API Gateway v2 HTTP API ID."
  value       = aws_apigatewayv2_api.main_api_gateway.id
}

output "api_gateway_endpoint" {
  description = "Base invoke URL for the API Gateway (without trailing slash). Use as REACT_APP_API_BASE_URL."
  value       = aws_apigatewayv2_api.main_api_gateway.api_endpoint
}

output "api_gateway_stage_invoke_url" {
  description = "Full invoke URL including the $default stage — primary API endpoint."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "api_gateway_cognito_authorizer_id" {
  description = "ID of the Cognito JWT authorizer — reference when creating route integrations."
  value       = aws_apigatewayv2_authorizer.cognito_jwt.id
}

output "api_gateway_execution_arn" {
  description = "Execution ARN prefix — append /*/*/<route> for Lambda permission resource_based_policy."
  value       = aws_apigatewayv2_api.main_api_gateway.execution_arn
}

# ── CloudWatch ────────────────────────────────────────────────────────────────

output "api_gateway_log_group_name" {
  description = "CloudWatch Log Group name for API Gateway access logs."
  value       = aws_cloudwatch_log_group.api_gateway_logs.name
}

# ── Convenience summary ───────────────────────────────────────────────────────

output "frontend_url" {
  description = "Primary HTTPS URL for the React front-end served via CloudFront."
  value       = "https://${aws_cloudfront_distribution.cf_distribution.domain_name}"
}

output "api_base_url" {
  description = "Base URL for all API calls — set this as REACT_APP_API_BASE_URL / API_BASE_URL env var."
  value       = "${aws_apigatewayv2_stage.default.invoke_url}/api"
}

output "aws_account_id" {
  description = "AWS account ID — useful for constructing ARNs in downstream modules."
  value       = data.aws_caller_identity.current.account_id
}

output "aws_region" {
  description = "Deployed AWS region."
  value       = data.aws_region.current.name
}
