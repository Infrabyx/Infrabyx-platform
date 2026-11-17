# The platform key (IPB-01 §01.4.9.1, IPB-02): an HSM-backed key in a premium vault in the primary
# region and one in the DR region (geo-redundant PostgreSQL backups need a key there), rotated
# yearly, behind purge protection and a deny-by-default firewall. Storage, PostgreSQL and the
# registry reach it through one user-assigned identity.
data "azurerm_client_config" "current" {}

locals {
  short  = replace(var.name, "infrabyx-", "ibx-")
  vaults = { primary = var.location, dr = var.location_dr }
}

resource "azurerm_key_vault" "this" {
  for_each                      = local.vaults
  name                          = each.key == "primary" ? "${local.short}-kv" : "${local.short}-kvdr"
  location                      = each.value
  resource_group_name           = var.resource_group_name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "premium"
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  rbac_authorization_enabled    = true
  public_network_access_enabled = true
  network_acls {
    default_action             = "Deny"
    bypass                     = "AzureServices"
    virtual_network_subnet_ids = each.key == "primary" ? var.allowed_subnet_ids : []
    ip_rules                   = var.admin_cidrs
  }
  tags = var.tags
}

# The deployment runner creates and rotates the keys; nothing else holds key management rights.
resource "azurerm_role_assignment" "officer" {
  for_each             = local.vaults
  scope                = azurerm_key_vault.this[each.key].id
  role_definition_name = "Key Vault Crypto Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_key_vault_key" "platform" {
  for_each     = local.vaults
  name         = "platform"
  key_vault_id = azurerm_key_vault.this[each.key].id
  key_type     = "RSA-HSM"
  key_size     = 3072
  key_opts     = ["wrapKey", "unwrapKey"]
  rotation_policy {
    automatic {
      time_after_creation = "P1Y"
    }
    expire_after         = "P2Y"
    notify_before_expiry = "P30D"
  }
  tags       = var.tags
  depends_on = [azurerm_role_assignment.officer]
}

resource "azurerm_user_assigned_identity" "cmk" {
  name                = "${var.name}-cmk"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_role_assignment" "cmk" {
  for_each             = local.vaults
  scope                = azurerm_key_vault.this[each.key].id
  role_definition_name = "Key Vault Crypto Service Encryption User"
  principal_id         = azurerm_user_assigned_identity.cmk.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_management_lock" "vault" {
  for_each   = local.vaults
  name       = "${azurerm_key_vault.this[each.key].name}-lock"
  scope      = azurerm_key_vault.this[each.key].id
  lock_level = "CanNotDelete"
  notes      = "Deletion protection (IPB-01 §01.4.9.1); covers the keys"
}

# PR-LDC-60 (R1-D-158): one key per storage compartment location, the same kind as the platform
# key (RSA-HSM 3072, rotated yearly) and never shared with it or with another compartment. Only in
# the primary vault: a storage account uses one key, and Key Vault replicates the vault to the
# paired region itself, read-only after a failover ("Reliability in Azure Key Vault",
# learn.microsoft.com/en-us/azure/reliability/reliability-key-vault, read 17 Nov 2026 [VERIFY]:
# read through a search index, the page itself not reachable from the build container). The DR
# vault exists for the geo-redundant PostgreSQL backups. The CMK
# identity reaches the keys through its existing vault-scoped role (encryption user: get, wrap
# and unwrap only); nothing else is granted. Off by default.
locals {
  cmp_abbrev = { REGULATED = "reg", CONFIDENTIAL = "conf", BOARD_CONFIDENTIAL = "board", SEALED = "sealed" }
  cmp_keys   = { for s in var.compartments : s => join("-", [for x in split(".", s) : local.cmp_abbrev[x]]) }
}

resource "azurerm_key_vault_key" "compartment" {
  for_each     = local.cmp_keys
  name         = each.value
  key_vault_id = azurerm_key_vault.this["primary"].id
  key_type     = "RSA-HSM"
  key_size     = 3072
  key_opts     = ["wrapKey", "unwrapKey"]
  rotation_policy {
    automatic {
      time_after_creation = "P1Y"
    }
    expire_after         = "P2Y"
    notify_before_expiry = "P30D"
  }
  tags       = merge(var.tags, { compartment = each.key })
  depends_on = [azurerm_role_assignment.officer]
}
