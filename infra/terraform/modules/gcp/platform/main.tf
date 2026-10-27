# The GCP platform for one product environment (IPB-01 §01.4.9, §01.4.12; PL6 plan §7), in the
# project of the provider configuration. It is validated and tested with a mock provider in CI and
# never applied from this repository.

locals {
  name    = "infrabyx-${var.product}-${var.env}"
  secrets = "secrets-${var.env}"
  # GCP label values are lower case.
  tags       = { product = var.product, env = var.env, managed_by = "opentofu", standard = "ipb-01" }
  regions_ok = var.region_adr != "" || (var.region_primary == "asia-south1" && var.region_dr == "asia-south2")
}

resource "terraform_data" "region_check" {
  input = var.region_primary
  lifecycle {
    precondition {
      condition     = local.regions_ok
      error_message = "IPB-01-36: production runs in asia-south1 with DR in asia-south2; other regions need region_adr (an ADR with the IPB-02 residency review)."
    }
  }
}

module "network" {
  source = "../network"
  name   = local.name
  region = var.region_primary
  tags   = local.tags
}

module "kms" {
  source       = "../kms"
  name         = local.name
  region       = var.region_primary
  region_dr    = var.region_dr
  multi_region = var.multi_region
  tags         = local.tags
}

module "secrets" {
  source      = "../secrets"
  name        = local.name
  region      = var.region_primary
  region_dr   = var.region_dr
  path_prefix = local.secrets
  key_id      = module.kms.platform_key_id
  dr_key_id   = module.kms.dr_key_id
  tags        = local.tags
  depends_on  = [module.kms]
}

module "kubernetes" {
  source              = "../kubernetes"
  name                = local.name
  region              = var.region_primary
  zones               = var.azs
  network_id          = module.network.network_id
  subnet_id           = module.network.nodes_subnet_id
  key_id              = module.kms.platform_key_id
  admin_cidrs         = var.admin_cidrs
  secrets_path_prefix = local.secrets
  tags                = local.tags
  depends_on          = [module.kms]
}

module "postgres" {
  source              = "../postgres"
  name                = local.name
  region              = var.region_primary
  region_dr           = var.region_dr
  db_name             = var.product
  network_id          = module.network.network_id
  key_id              = module.kms.platform_key_id
  high_availability   = contains(["prod", "dr", "pre-prod", "staging"], var.env)
  secrets_path_prefix = local.secrets
  tags                = local.tags
  depends_on          = [module.network, module.kms]
}

module "redis" {
  source              = "../redis"
  name                = local.name
  region              = var.region_primary
  zones               = var.azs
  network_id          = module.network.network_id
  key_id              = module.kms.platform_key_id
  secrets_path_prefix = local.secrets
  tags                = local.tags
  depends_on          = [module.network, module.kms]
}

module "object_storage" {
  source              = "../object_storage"
  name                = local.name
  region              = var.region_primary
  region_dr           = var.region_dr
  multi_region        = var.multi_region
  key_id              = module.kms.platform_key_id
  multi_region_key_id = module.kms.multi_region_key_id
  retention_years     = { REGULATED = var.regulated_retention_years }
  tags                = local.tags
  depends_on          = [module.kms]
}

module "dns_cdn_edge" {
  source = "../dns_cdn_edge"
  name   = local.name
  domain = var.domain
  tags   = local.tags
}

module "observability_backend" {
  source     = "../observability_backend"
  name       = local.name
  region     = var.region_primary
  key_id     = module.kms.platform_key_id
  tags       = local.tags
  depends_on = [module.kms]
}

module "registry" {
  source     = "../registry"
  name       = local.name
  region     = var.region_primary
  key_id     = module.kms.platform_key_id
  tags       = local.tags
  depends_on = [module.kms]
}

module "iam_workload_identity" {
  source              = "../iam_workload_identity"
  name                = local.name
  workload_pool       = module.kubernetes.workload_pool
  secrets_path_prefix = local.secrets
  workloads           = var.workloads
  tags                = local.tags
}

module "bastion_breakglass" {
  source = "../bastion_breakglass"
  name   = local.name
}
