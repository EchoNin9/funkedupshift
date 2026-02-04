terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    bucket         = "fus-aws-s3-terraform-state"
    key            = "funkedupshift/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "fus-terraform-state-lock"
    encrypt        = true
  }
}
