# The output contract on AWS (@IPB-01-AT-14, IPB-01-34; PL6 plan §7.3): the platform applies
# against mock providers (no credentials, no resources) and returns every contract key with the
# declared type, the five bucket classes and the reference regions; other regions need an ADR
# (IPB-01-36).

mock_provider "aws" {
  mock_resource "aws_eks_cluster" {
    defaults = {
      identity = [{ oidc = [{ issuer = "https://oidc.eks.ap-south-1.amazonaws.com/id/EXAMPLE" }] }]
    }
  }
  # The mock provider fills computed attributes with random strings; the provider still validates
  # the ARNs one resource passes to another, so those resources get well-formed ones.
  mock_resource "aws_kms_key" {
    defaults = {
      arn    = "arn:aws:kms:ap-south-1:111122223333:key/mrk-00000000000000000000000000000000"
      key_id = "mrk-00000000000000000000000000000000"
    }
  }
  mock_resource "aws_kms_replica_key" {
    defaults = { arn = "arn:aws:kms:ap-south-1:111122223333:key/mrk-00000000000000000000000000000000" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::111122223333:policy/mock" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::111122223333:oidc-provider/oidc.eks.ap-south-1.amazonaws.com/id/EXAMPLE" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-south-1:111122223333:log-group:mock" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::mock" }
  }
}

mock_provider "aws" {
  alias = "dr"
  mock_resource "aws_kms_key" {
    defaults = {
      arn    = "arn:aws:kms:ap-south-2:111122223333:key/mrk-00000000000000000000000000000000"
      key_id = "mrk-00000000000000000000000000000000"
    }
  }
  mock_resource "aws_kms_replica_key" {
    defaults = { arn = "arn:aws:kms:ap-south-2:111122223333:key/mrk-00000000000000000000000000000000" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::111122223333:policy/mock" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::111122223333:oidc-provider/oidc.eks.ap-south-2.amazonaws.com/id/EXAMPLE" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-south-2:111122223333:log-group:mock" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::mock" }
  }
}

variables {
  product                   = "fbx"
  env                       = "prod"
  domain                    = "app.example.test"
  regulated_retention_years = 8
}

run "output_contract" {
  command = apply

  assert {
    condition     = output.kubeconfig_ref == "secrets/prod/k8s/kubeconfig"
    error_message = "kubeconfig_ref is the secrets path of the kubeconfig"
  }
  assert {
    condition     = alltrue([for k in ["host", "port", "db", "ssl_mode", "credentials_secret_path"] : can(tostring(output.postgres[k]))])
    error_message = "postgres has host, port, db, ssl_mode and credentials_secret_path as strings"
  }
  assert {
    condition     = output.postgres.ssl_mode == "verify-full" && output.postgres.db == "fbx" && output.postgres.credentials_secret_path == "secrets/prod/db/app_rw"
    error_message = "postgres uses verify-full, the product database and the app_rw secret path"
  }
  assert {
    condition     = output.redis.url_secret_path == "secrets/prod/redis/url"
    error_message = "redis.url_secret_path is a secrets path"
  }
  assert {
    condition     = toset(keys(output.storage.buckets)) == toset(["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"])
    error_message = "storage.buckets maps every bucket class"
  }
  assert {
    condition     = alltrue([for v in values(output.storage.buckets) : can(regex("^infrabyx-fbx-prod-", v))]) && output.storage.lock_mode == "compliance"
    error_message = "bucket names carry the name prefix and the lock mode is compliance"
  }
  assert {
    condition     = can(tostring(output.kms.platform_key_id)) && output.kms.platform_key_id != ""
    error_message = "kms.platform_key_id is a string"
  }
  assert {
    condition     = output.secrets.provider == "aws-secrets-manager" && output.secrets.path_prefix == "secrets/prod"
    error_message = "secrets names the provider and the path prefix"
  }
  assert {
    condition     = can(tostring(output.edge.zone_id)) && output.edge.origin_hostname == "origin.app.example.test"
    error_message = "edge has the zone id and the origin hostname"
  }
  assert {
    condition     = can(regex("^https?://", output.observability.otlp_endpoint))
    error_message = "observability.otlp_endpoint is a URL"
  }
  assert {
    condition     = can(tostring(output.registry.url)) && output.registry.url != ""
    error_message = "registry.url is a string"
  }
  assert {
    condition     = output.region.primary == "ap-south-1" && output.region.dr == "ap-south-2"
    error_message = "the reference regions are ap-south-1 and ap-south-2"
  }
}

run "other_regions_need_an_adr" {
  command = plan
  variables {
    region_primary = "us-east-1"
    region_dr      = "us-west-2"
    azs            = ["us-east-1a", "us-east-1b", "us-east-1c"]
  }
  expect_failures = [terraform_data.region_check]
}

run "other_regions_with_an_adr" {
  command = plan
  variables {
    region_primary = "eu-west-1"
    region_dr      = "eu-central-1"
    region_adr     = "ADR-0009"
    azs            = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
  }
}

run "unknown_product_refused" {
  command = plan
  variables {
    product = "acme"
  }
  expect_failures = [var.product]
}
