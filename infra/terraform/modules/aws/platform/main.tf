# The AWS platform for one product environment (IPB-01 §01.4.9, §01.4.12; PL6 plan §7). It is
# validated and tested with mock providers in CI and never applied from this repository.

locals {
  name        = "infrabyx-${var.product}-${var.env}"
  secrets     = "secrets/${var.env}"
  tags        = { product = var.product, env = var.env, managed_by = "opentofu", standard = "IPB-01" }
  regions_ok  = var.region_adr != "" || (var.region_primary == "ap-south-1" && var.region_dr == "ap-south-2")
  cluster_net = module.network.cidr
}

resource "terraform_data" "region_check" {
  input = var.region_primary
  lifecycle {
    precondition {
      condition     = local.regions_ok
      error_message = "IPB-01-36: production runs in ap-south-1 with DR in ap-south-2; other regions need region_adr (an ADR with the IPB-02 residency review)."
    }
  }
}

module "kms" {
  source    = "../kms"
  providers = { aws = aws, aws.dr = aws.dr }
  name      = local.name
  tags      = local.tags
}

module "network" {
  source      = "../network"
  name        = local.name
  azs         = var.azs
  kms_key_arn = module.kms.platform_key_arn
  tags        = local.tags
}

module "secrets" {
  source      = "../secrets"
  name        = local.name
  path_prefix = local.secrets
  kms_key_arn = module.kms.platform_key_arn
  tags        = local.tags
}

module "kubernetes" {
  source              = "../kubernetes"
  name                = local.name
  subnet_ids          = module.network.private_subnet_ids
  kms_key_arn         = module.kms.platform_key_arn
  secrets_path_prefix = local.secrets
  admin_cidrs         = var.admin_cidrs
  tags                = local.tags
}

module "postgres" {
  source              = "../postgres"
  name                = local.name
  db_name             = var.product
  vpc_id              = module.network.vpc_id
  subnet_ids          = module.network.private_subnet_ids
  allowed_cidrs       = [local.cluster_net]
  kms_key_arn         = module.kms.platform_key_arn
  multi_az            = contains(["prod", "dr", "pre-prod", "staging"], var.env)
  secrets_path_prefix = local.secrets
  tags                = local.tags
}

module "redis" {
  source              = "../redis"
  name                = local.name
  vpc_id              = module.network.vpc_id
  subnet_ids          = module.network.private_subnet_ids
  allowed_cidrs       = [local.cluster_net]
  kms_key_arn         = module.kms.platform_key_arn
  secrets_path_prefix = local.secrets
  tags                = local.tags
}

module "object_storage" {
  source          = "../object_storage"
  providers       = { aws = aws, aws.dr = aws.dr }
  name            = local.name
  kms_key_arn     = module.kms.platform_key_arn
  dr_kms_key_arn  = module.kms.dr_key_arn
  retention_years = { REGULATED = var.regulated_retention_years }
  tags            = local.tags
}

module "dns_cdn_edge" {
  source = "../dns_cdn_edge"
  name   = local.name
  domain = var.domain
  tags   = local.tags
}

module "observability_backend" {
  source      = "../observability_backend"
  name        = local.name
  kms_key_arn = module.kms.platform_key_arn
  tags        = local.tags
}

module "registry" {
  source      = "../registry"
  name        = local.name
  kms_key_arn = module.kms.platform_key_arn
  tags        = local.tags
}

module "iam_workload_identity" {
  source            = "../iam_workload_identity"
  name              = local.name
  oidc_provider_arn = module.kubernetes.oidc_provider_arn
  oidc_issuer       = module.kubernetes.oidc_issuer
  workloads         = { for sa, extra in var.workloads : sa => concat([module.secrets.read_policy_arn], extra) }
  tags              = local.tags
}

module "bastion_breakglass" {
  source = "../bastion_breakglass"
  name   = local.name
  tags   = local.tags
}
