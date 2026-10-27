# The Azure platform for one product environment (IPB-01 §01.4.9, §01.4.12; PL6 plan §7). It is
# validated and tested with mock providers in CI and never applied from this repository.

locals {
  name       = "infrabyx-${var.product}-${var.env}"
  secrets    = "secrets-${var.env}"
  tags       = { product = var.product, env = var.env, managed_by = "opentofu", standard = "IPB-01" }
  regions_ok = var.region_adr != "" || (var.region_primary == "centralindia" && var.region_dr == "southindia")
}

resource "terraform_data" "region_check" {
  input = var.region_primary
  lifecycle {
    precondition {
      condition     = local.regions_ok
      error_message = "IPB-01-36: production runs in centralindia with DR in southindia; other regions need region_adr (an ADR with the IPB-02 residency review)."
    }
  }
}

resource "azurerm_resource_group" "this" {
  name     = local.name
  location = var.region_primary
  tags     = local.tags
}

module "network" {
  source              = "../network"
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  location            = var.region_primary
  tags                = local.tags
}

module "kms" {
  source              = "../kms"
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  location            = var.region_primary
  location_dr         = var.region_dr
  allowed_subnet_ids  = [module.network.nodes_subnet_id]
  admin_cidrs         = var.admin_cidrs
  tags                = local.tags
}

module "secrets" {
  source              = "../secrets"
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  location            = var.region_primary
  path_prefix         = local.secrets
  allowed_subnet_ids  = [module.network.nodes_subnet_id]
  admin_cidrs         = var.admin_cidrs
  tags                = local.tags
}

module "kubernetes" {
  source              = "../kubernetes"
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  location            = var.region_primary
  subnet_id           = module.network.nodes_subnet_id
  zones               = var.azs
  tenant_id           = module.kms.tenant_id
  admin_cidrs         = var.admin_cidrs
  secrets_path_prefix = local.secrets
  tags                = local.tags
}

module "postgres" {
  source              = "../postgres"
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  location            = var.region_primary
  db_name             = var.product
  vnet_id             = module.network.vnet_id
  subnet_id           = module.network.postgres_subnet_id
  zones               = var.azs
  key_id              = module.kms.platform_key_id
  dr_key_id           = module.kms.dr_key_id
  cmk_identity_id     = module.kms.cmk_identity_id
  tenant_id           = module.kms.tenant_id
  high_availability   = contains(["prod", "dr", "pre-prod", "staging"], var.env)
  secrets_path_prefix = local.secrets
  tags                = local.tags
}

module "redis" {
  source              = "../redis"
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  location            = var.region_primary
  vnet_id             = module.network.vnet_id
  subnet_id           = module.network.endpoints_subnet_id
  zones               = var.azs
  secrets_path_prefix = local.secrets
  tags                = local.tags
}

module "object_storage" {
  source              = "../object_storage"
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  location            = var.region_primary
  key_id              = module.kms.platform_key_id
  cmk_identity_id     = module.kms.cmk_identity_id
  allowed_subnet_ids  = [module.network.nodes_subnet_id]
  admin_cidrs         = var.admin_cidrs
  retention_years     = { REGULATED = var.regulated_retention_years }
  immutability_locked = var.immutability_locked
  tags                = local.tags
}

module "dns_cdn_edge" {
  source              = "../dns_cdn_edge"
  resource_group_name = azurerm_resource_group.this.name
  domain              = var.domain
  tags                = local.tags
}

module "observability_backend" {
  source              = "../observability_backend"
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  location            = var.region_primary
  key_id              = module.kms.platform_key_id
  cmk_identity_id     = module.kms.cmk_identity_id
  allowed_subnet_ids  = [module.network.nodes_subnet_id]
  admin_cidrs         = var.admin_cidrs
  immutability_locked = var.immutability_locked
  tags                = local.tags
}

module "registry" {
  source                 = "../registry"
  name                   = local.name
  resource_group_name    = azurerm_resource_group.this.name
  location               = var.region_primary
  location_dr            = var.region_dr
  key_id                 = module.kms.platform_key_id
  cmk_identity_id        = module.kms.cmk_identity_id
  cmk_identity_client_id = module.kms.cmk_identity_client_id
  pull_principal_ids     = { kubelet = module.kubernetes.kubelet_object_id }
  tags                   = local.tags
}

module "iam_workload_identity" {
  source              = "../iam_workload_identity"
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  location            = var.region_primary
  oidc_issuer         = module.kubernetes.oidc_issuer
  secrets_vault_id    = module.secrets.key_vault_id
  role_scope          = azurerm_resource_group.this.id
  workloads           = var.workloads
  tags                = local.tags
}

module "bastion_breakglass" {
  source     = "../bastion_breakglass"
  name       = local.name
  cluster_id = module.kubernetes.cluster_id
}
