# Storage for the in-cluster Loki and Tempo (IPB-01 §01.4.12): one account with the containers
# `logs` and `traces`, a 180-day immutability policy (locked with immutability_locked), encrypted with the platform key and
# private like the bucket classes. The apps send OTLP to the in-cluster collector only.
resource "azurerm_storage_account" "telemetry" {
  name                              = "${replace(replace(var.name, "infrabyx-", "ibx"), "-", "")}tel"
  resource_group_name               = var.resource_group_name
  location                          = var.location
  account_kind                      = "StorageV2"
  account_tier                      = "Standard"
  account_replication_type          = "ZRS"
  min_tls_version                   = "TLS1_2"
  https_traffic_only_enabled        = true
  allow_nested_items_to_be_public   = false
  shared_access_key_enabled         = false
  default_to_oauth_authentication   = true
  cross_tenant_replication_enabled  = false
  infrastructure_encryption_enabled = true
  public_network_access             = "Enabled"
  identity {
    type         = "UserAssigned"
    identity_ids = [var.cmk_identity_id]
  }
  customer_managed_key {
    key_vault_key_id          = var.key_id
    user_assigned_identity_id = var.cmk_identity_id
  }
  network_rules {
    default_action             = "Deny"
    bypass                     = ["AzureServices"]
    virtual_network_subnet_ids = var.allowed_subnet_ids
    ip_rules                   = var.admin_cidrs
  }
  blob_properties {
    versioning_enabled = true
  }
  immutability_policy {
    state                         = var.immutability_locked ? "Locked" : "Unlocked"
    period_since_creation_in_days = var.log_retention_days
    allow_protected_append_writes = true
  }
  tags = merge(var.tags, { bucket_class = "CONFIDENTIAL", role = "telemetry" })
}

resource "azurerm_storage_container" "this" {
  for_each              = toset(["logs", "traces"])
  name                  = each.key
  storage_account_id    = azurerm_storage_account.telemetry.id
  container_access_type = "private"
}

resource "azurerm_management_lock" "telemetry" {
  name       = "${azurerm_storage_account.telemetry.name}-lock"
  scope      = azurerm_storage_account.telemetry.id
  lock_level = "CanNotDelete"
  notes      = "Deletion protection (IPB-01 §01.4.9.1); covers the containers"
}
