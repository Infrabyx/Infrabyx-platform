# One storage account per bucket class (IPB-01 §01.4.7), each with one private container,
# `objects`. AUDIT, REGULATED and CONFIDENTIAL are geo-zone-redundant (their copies sit in the
# paired DR region) with an account-level immutability policy, which once locked is the
# equivalent of Object Lock in compliance mode (Azure creates it unlocked; immutability_locked
# locks it in the next apply); GENERAL and PUBLIC_ASSETS are zone-redundant without one. Every account
# is private, versioned, HTTPS and TLS 1.2 only, Entra ID only (no shared keys), and encrypted
# with the platform key.
locals {
  classes = ["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"]
  abbrev  = { AUDIT = "audit", REGULATED = "reg", CONFIDENTIAL = "conf", GENERAL = "gen", PUBLIC_ASSETS = "pub" }
  locked  = { for c in ["AUDIT", "REGULATED", "CONFIDENTIAL"] : c => var.retention_years[c] }
  # Account names are 3 to 24 lower-case letters and digits.
  compact = replace(replace(var.name, "infrabyx-", "ibx"), "-", "")
  names   = { for c in local.classes : c => "${local.compact}${local.abbrev[c]}" }
}

resource "azurerm_storage_account" "this" {
  for_each                          = local.names
  name                              = each.value
  resource_group_name               = var.resource_group_name
  location                          = var.location
  account_kind                      = "StorageV2"
  account_tier                      = "Standard"
  account_replication_type          = contains(keys(local.locked), each.key) ? "GZRS" : "ZRS"
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
    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
  }
  dynamic "immutability_policy" {
    for_each = contains(keys(local.locked), each.key) ? [local.locked[each.key]] : []
    content {
      state                         = var.immutability_locked ? "Locked" : "Unlocked"
      period_since_creation_in_days = immutability_policy.value * 365
      allow_protected_append_writes = false
    }
  }
  tags = merge(var.tags, { bucket_class = each.key })
}

resource "azurerm_storage_container" "objects" {
  for_each              = local.names
  name                  = "objects"
  storage_account_id    = azurerm_storage_account.this[each.key].id
  container_access_type = "private"
}
