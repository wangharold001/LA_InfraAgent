################################################################################
# providers.tf
# Terraform + provider version pins for the UberEats-style multi-service platform
################################################################################

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Uncomment and configure for remote state in real deployments:
  # backend "s3" {
  #   bucket         = "my-tf-state-bucket"
  #   key            = "ubereats/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "tf-state-lock"
  #   encrypt        = true
  # }
}

# Primary region provider (us-east-1 is required for CLOUDFRONT-scoped WAFv2)
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ubereats-platform"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# CloudFront-scoped WAFv2 Web ACLs MUST be created in us-east-1.
# This alias provider is used only for the WAF resource.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "ubereats-platform"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
