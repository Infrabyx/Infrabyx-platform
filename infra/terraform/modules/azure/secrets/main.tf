# The environment's secrets vault (IPB-02-28). OpenTofu creates the vault, never a secret: Key
# Vault cannot hold a secret without a value, and no value belongs in state. The bootstrap writes
# <path_prefix>-db-app-rw, -redis-url and -k8s-kubeconfig; the chart's SecretProviderClass reads
# them through the workload identities, which hold Key Vault Secrets User on this vault only.
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "this" {
  name                          = "${replace(var.name, "infrabyx-", "ibx-")}-sv"
  location                      = var.location
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
    virtual_network_subnet_ids = var.allowed_subnet_ids
    ip_rules                   = var.admin_cidrs
  }
  tags = var.tags
}
