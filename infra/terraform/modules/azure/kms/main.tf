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
