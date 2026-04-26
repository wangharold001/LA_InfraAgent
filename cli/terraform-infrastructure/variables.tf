################################################################################
# variables.tf
# All input variables for the UberEats-style platform
################################################################################

variable "aws_region" {
  description = "Primary AWS region for all non-global resources."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (dev | staging | prod). Used as a name suffix/prefix to isolate resources."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "project_name" {
  description = "Short project identifier included in all resource names."
  type        = string
  default     = "ubereats"
}

# ── CloudFront ────────────────────────────────────────────────────────────────

variable "cf_price_class" {
  description = "CloudFront price class. PriceClass_100 = US/EU/Canada edges only (cheapest)."
  type        = string
  default     = "PriceClass_All"

  validation {
    condition = contains(
      ["PriceClass_100", "PriceClass_200", "PriceClass_All"],
      var.cf_price_class
    )
    error_message = "cf_price_class must be PriceClass_100, PriceClass_200, or PriceClass_All."
  }
}

variable "cf_default_root_object" {
  description = "Default root object served by CloudFront (e.g. index.html for SPAs)."
  type        = string
  default     = "index.html"
}

variable "cf_enable_ipv6" {
  description = "Whether to enable IPv6 on the CloudFront distribution."
  type        = bool
  default     = true
}

variable "cf_minimum_tls_version" {
  description = "Minimum TLS protocol version for CloudFront viewer connections."
  type        = string
  default     = "TLSv1.2_2021"
}

# ── S3 ────────────────────────────────────────────────────────────────────────

variable "s3_force_destroy" {
  description = "Allow Terraform to destroy the S3 bucket even when it contains objects. Set false in prod."
  type        = bool
  default     = false
}

variable "s3_versioning_enabled" {
  description = "Enable S3 object versioning on the static assets bucket."
  type        = bool
  default     = true
}

# ── Cognito ───────────────────────────────────────────────────────────────────

variable "cognito_mfa_configuration" {
  description = "MFA setting for the Cognito User Pool. OFF | OPTIONAL | ON."
  type        = string
  default     = "OPTIONAL"

  validation {
    condition     = contains(["OFF", "OPTIONAL", "ON"], var.cognito_mfa_configuration)
    error_message = "cognito_mfa_configuration must be OFF, OPTIONAL, or ON."
  }
}

variable "cognito_password_min_length" {
  description = "Minimum password length enforced by Cognito."
  type        = number
  default     = 8
}

variable "cognito_allow_self_signup" {
  description = "Whether end-users can sign themselves up (vs admin-only creation)."
  type        = bool
  default     = true
}

# ── API Gateway ───────────────────────────────────────────────────────────────

variable "api_cors_allow_origins" {
  description = "List of allowed CORS origins for API Gateway."
  type        = list(string)
  default     = ["*"]
}

variable "api_throttle_burst_limit" {
  description = "API Gateway default route throttle burst limit."
  type        = number
  default     = 5000
}

variable "api_throttle_rate_limit" {
  description = "API Gateway default route throttle rate limit (requests/second)."
  type        = number
  default     = 2000
}

# ── WAF ───────────────────────────────────────────────────────────────────────

variable "waf_enable_cloudwatch_metrics" {
  description = "Send WAF sampled requests / metrics to CloudWatch."
  type        = bool
  default     = true
}

variable "waf_sampled_requests_enabled" {
  description = "Enable WAF sampled-request logging."
  type        = bool
  default     = true
}
